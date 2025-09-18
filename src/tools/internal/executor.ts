import { ToolPlan, Tool } from './orchestrator.js';
import { getToolRegistry } from './tool-registry.js';
import { logger } from '../../lib/logger.js';

export interface ToolResult {
  tool: string;
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
}

export interface ToolConfig {
  clerkUserId?: string;
  [key: string]: any;
}

export class Executor {
  async executeTools(plan: ToolPlan, clerkUserId?: string): Promise<ToolResult[]> {
    const { tools, strategy } = plan;
    const toolRegistry = getToolRegistry();
    
    logger.info(`🔧 Executing ${tools.length} tools (${strategy})`);
    
    if (strategy === 'parallel') {
      return this.executeParallel(tools, toolRegistry, clerkUserId);
    } else {
      return this.executeSequential(tools, toolRegistry, clerkUserId);
    }
  }
  
  private async executeParallel(tools: Tool[], toolRegistry: any, clerkUserId?: string): Promise<ToolResult[]> {
    const promises = tools.map(async (toolConfig) => {
      const startTime = Date.now();
      const tool = toolRegistry.getTool(toolConfig.name);
      
      if (!tool) {
        return {
          tool: toolConfig.name,
          success: false,
          error: `Tool not found: ${toolConfig.name}`,
          executionTime: Date.now() - startTime
        };
      }
      
      try {
        const config: ToolConfig = {
          ...toolConfig.params,
          clerkUserId,
          name: toolConfig.name,
          priority: toolConfig.priority,
          reason: toolConfig.reason,
          depth: toolConfig.params.depth || 'medium',
          focus: toolConfig.params.focus || []
        };
        
        const result = await tool.execute(toolConfig.params.query || '', config);
        
        return {
          tool: toolConfig.name,
          success: result.success,
          data: result.data,
          error: result.error,
          executionTime: Date.now() - startTime
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          tool: toolConfig.name,
          success: false,
          error: errorMessage,
          executionTime: Date.now() - startTime
        };
      }
    });
    
    return await Promise.all(promises);
  }
  
  private async executeSequential(tools: Tool[], toolRegistry: any, clerkUserId?: string): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    
    for (const toolConfig of tools) {
      const startTime = Date.now();
      const tool = toolRegistry.getTool(toolConfig.name);
      
      if (!tool) {
        results.push({
          tool: toolConfig.name,
          success: false,
          error: `Tool not found: ${toolConfig.name}`,
          executionTime: Date.now() - startTime
        });
        continue;
      }
      
      try {
        const config: ToolConfig = {
          ...toolConfig.params,
          clerkUserId,
          name: toolConfig.name,
          priority: toolConfig.priority,
          reason: toolConfig.reason,
          depth: toolConfig.params.depth || 'medium',
          focus: toolConfig.params.focus || []
        };
        
        const result = await tool.execute(toolConfig.params.query || '', config);
        
        results.push({
          tool: toolConfig.name,
          success: result.success,
          data: result.data,
          error: result.error,
          executionTime: Date.now() - startTime
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({
          tool: toolConfig.name,
          success: false,
          error: errorMessage,
          executionTime: Date.now() - startTime
        });
      }
    }
    
    return results;
  }
}
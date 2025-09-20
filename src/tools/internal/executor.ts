import { getToolRegistry } from './tool-registry.js';
import { logger } from '../../lib/logger.js';

// Move interfaces here since we no longer import from orchestrator
export interface Tool {
  name: string;
  params: any;
  priority: number;
  reason: string;
}

export interface ToolPlan {
  tools: Tool[];
  strategy: 'parallel' | 'sequential';
}

export interface ToolResult {
  tool: string;
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
}

export class Executor {
  async executeTools(plan: ToolPlan, clerkUserId?: string): Promise<ToolResult[]> {
    const { tools } = plan;
    const toolRegistry = getToolRegistry();
    
    // Since we only have one tool now, simplify the logic
    logger.info(`🔧 Executing database_query tool`);
    
    const toolConfig = tools[0]; // We know there's only one tool
    const startTime = Date.now();
    const tool = toolRegistry.getTool(toolConfig.name);
    
    if (!tool) {
      return [{
        tool: toolConfig.name,
        success: false,
        error: `Tool not found: ${toolConfig.name}`,
        executionTime: Date.now() - startTime
      }];
    }
    
    try {
      // Create config object that matches what base-tool expects
      const config = {
        clerkUserId,
        name: toolConfig.name,
        priority: toolConfig.priority,
        reason: toolConfig.reason,
        depth: 'medium',
        focus: []
      };
      
      const result = await tool.execute(toolConfig.params.query || '', config);
      
      return [{
        tool: toolConfig.name,
        success: result.success,
        data: result.data,
        error: result.error,
        executionTime: Date.now() - startTime
      }];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return [{
        tool: toolConfig.name,
        success: false,
        error: errorMessage,
        executionTime: Date.now() - startTime
      }];
    }
  }
}
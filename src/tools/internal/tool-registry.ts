import { logger } from '../../lib/logger.js';
import { BaseTool, ToolInfo } from './base-tool.js';

// Import all tools
import WebSearchTool from './internal-tools/web-search.js';
import CalculatorTool from './internal-tools/calculator.js';
import WeatherTool from './internal-tools/weather.js';
import DatabaseQueryTool from './internal-tools/database-query.js';

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  
  constructor() {
    this.loadAllTools();
  }
  
  private loadAllTools(): void {
    logger.info('🔍 Loading internal tools...');
    
    // Register each tool
    const toolsToLoad = [
      new WebSearchTool(),
      new CalculatorTool(),
      new WeatherTool(),
      new DatabaseQueryTool()
      // Add new tools here
    ];
    
    toolsToLoad.forEach(tool => {
      this.tools.set(tool.name, tool);
      logger.info(`  📦 Loaded tool: ${tool.name}`);
    });
    
    logger.info(`✅ Loaded ${this.tools.size} tools: ${Array.from(this.tools.keys()).join(', ')}`);
  }
  
  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }
  
  getAllTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }
  
  getToolInfos(): ToolInfo[] {
    return Array.from(this.tools.values()).map(tool => tool.getInfo());
  }
  
  getToolDescriptions(): string {
    return this.getAllTools()
      .map(tool => `
${tool.name}:
  Description: ${tool.description}
  Good for: ${tool.good_for.join(', ')}`)
      .join('\n');
  }
  
  async executeTool(name: string, params: any): Promise<any> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    
    // Convert params to ToolConfig format
    const config = {
      name: name,
      priority: params.priority || 1,
      depth: params.depth || 'medium',
      focus: params.focus || [],
      reason: params.reason || '',
      ...params
    };
    
    const result = await tool.execute(params.query || '', config);
    return result.data;
  }
}

// Singleton
let toolRegistry: ToolRegistry;

export function getToolRegistry(): ToolRegistry {
  if (!toolRegistry) {
    toolRegistry = new ToolRegistry();
  }
  return toolRegistry;
}
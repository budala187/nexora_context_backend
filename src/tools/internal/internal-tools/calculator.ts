import { BaseTool, ToolConfig, ToolResponse } from '../base-tool.js';
import { logger } from '../../../lib/logger.js';

export class CalculatorTool extends BaseTool {
  name = 'calculator';
  description = 'Perform mathematical calculations and expressions';
  good_for = ['math', 'calculations', 'arithmetic', 'statistics', 'percentages'];
  
  async execute(query: string, config: ToolConfig): Promise<ToolResponse> {
    try {
      logger.info(`🧮 Calculating: ${query}`);
      
      // Extract expression from query or use query directly
      const expression = config.expression || query;
      
      // TODO: Use mathjs or similar library for safe evaluation
      // For now, basic implementation (replace with mathjs)
      const result = this.evaluateExpression(expression);
      
      return {
        success: true,
        data: {
          expression: expression,
          result: result
        }
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  private evaluateExpression(expr: string): number {
    // TODO: Replace with mathjs
    // This is just for demo - DO NOT use eval in production
    try {
      // Basic safety check
      if (!/^[\d+\-*/().\s]+$/.test(expr)) {
        throw new Error('Invalid expression');
      }
      return Function('"use strict"; return (' + expr + ')')();
    } catch {
      throw new Error('Invalid mathematical expression');
    }
  }
}

export default CalculatorTool;
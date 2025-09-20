import OpenAI from 'openai';
import { ToolResult } from './executor.js';
import { logger } from '../../lib/logger.js';

// Model configuration
const OPENAI_MODEL_REFINER = process.env.OPENAI_MODEL_REFINER!;

export interface RefinedResponse {
  content: string;
  confidence: number;
}

export class Refiner {
  private openai: OpenAI;
  
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  
  async refineResults(query: string, results: ToolResult[]): Promise<RefinedResponse> {
    const successful = results.filter(r => r.success);
    
    // ADD THIS: Log raw input data
    logger.info('=== REFINER INPUT DEBUG ===');
    logger.info(`Query: "${query}"`);
    logger.info(`Total tool results: ${results.length}`);
    logger.info(`Successful tool results: ${successful.length}`);
    
    successful.forEach((result, index) => {
      logger.info(`--- Tool ${index + 1}: ${result.tool} ---`);
      logger.info('Raw data:', JSON.stringify(result.data, null, 2));
      
      // Show source breakdown if it's the database tool
      if (result.data && result.data.sources) {
        logger.info('Source breakdown:', result.data.sources);
      }
    });
    logger.info('=== END REFINER INPUT ===');
    
    if (successful.length === 0) {
      logger.warn('No successful tool executions');
      return {
        content: "I couldn't find the information needed to answer your query. Please try rephrasing.",
        confidence: 0
      };
    }
    
    const prompt = `Create a comprehensive answer based on tool results.

ORIGINAL QUERY: "${query}"

TOOL RESULTS:
${successful.map(r => `
Tool: ${r.tool}
Data: ${JSON.stringify(r.data, null, 2)}
`).join('\n---\n')}

Instructions:
1. Answer the query directly
2. Combine all information coherently
3. Remove duplicates
4. Be conversational and helpful
5. Do NOT mention the tools used

Provide the answer:`;

    const response = await this.openai.chat.completions.create({
      model: OPENAI_MODEL_REFINER,
      messages: [{ role: 'system', content: prompt }],
      max_completion_tokens: 2000
    });
    
    const content = response.choices[0]?.message?.content || 'Unable to generate response';
    const confidence = this.calculateConfidence(results);
    
    logger.info('=== REFINER OUTPUT DEBUG ===');
    logger.info('Refined content:', content);
    logger.info(`Confidence: ${confidence}%`);
    logger.info('=== END REFINER OUTPUT ===');
    
    return {
      content,
      confidence
    };
  }
  
  private calculateConfidence(results: ToolResult[]): number {
    const successful = results.filter(r => r.success).length;
    const total = results.length;
    
    if (total === 0) return 0;
    const successRate = (successful / total) * 100;
    
    if (successful >= 3) return Math.min(95, successRate);
    if (successful === 2) return Math.min(85, successRate);
    if (successful === 1) return Math.min(70, successRate);
    
    return successRate;
  }
}
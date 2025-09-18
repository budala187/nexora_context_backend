import OpenAI from 'openai';
import { getToolRegistry } from './tool-registry.js';
import { logger } from '../../lib/logger.js';

// Model configuration
const OPENAI_MODEL_ORCHESTRATOR = process.env.OPENAI_MODEL_ORCHESTRATOR!;

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

export class Orchestrator {
  private openai: OpenAI;
  
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  
  async selectTools(query: string, context?: any): Promise<ToolPlan> {
    const toolRegistry = getToolRegistry();
    const availableTools = toolRegistry.getToolDescriptions();
    
    // Always start with database_query as mandatory first tool
    const mandatoryTools: Tool[] = [
      {
        name: 'database_query',
        params: { 
          query: query
        },
        priority: 1,
        reason: 'Search user private data and uploaded documents'
      }
    ];
    
    const prompt = `You are a tool selector. Select additional tools to complement the database search.

AVAILABLE TOOLS (excluding database_query which is already selected):
${availableTools.replace(/database_query[^\n]*\n?/g, '')}

USER QUERY: "${query}"
${context ? `CONTEXT: ${JSON.stringify(context)}` : ''}

The database_query tool is already selected as the first tool.
Select any additional tools that would help answer this query.

Return ONLY valid JSON:
{
  "additional_tools": [
    {
      "name": "tool_name",
      "params": { 
        "query": "query for this tool",
        "any_other": "parameters needed"
      },
      "priority": 2,
      "reason": "why this tool is needed"
    }
  ],
  "strategy": "parallel"
}

If no additional tools are needed, return: {"additional_tools": [], "strategy": "parallel"}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: OPENAI_MODEL_ORCHESTRATOR,
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      });
      
      const aiResponse = JSON.parse(response.choices[0]?.message?.content || '{}');
      const additionalTools = aiResponse.additional_tools || [];
      const strategy = aiResponse.strategy || 'parallel';
      
      // Combine mandatory tools with AI-selected additional tools
      const allTools = [...mandatoryTools, ...additionalTools];
      
      logger.info(`📋 Selected ${allTools.length} tools: ${allTools.map((t: Tool) => t.name).join(', ')}`);
      logger.info(`📋 Mandatory: database_query, Additional: ${additionalTools.map((t: Tool) => t.name).join(', ') || 'none'}`);
      
      return {
        tools: allTools,
        strategy
      } as ToolPlan;
      
    } catch (error) {
      logger.error('Orchestrator failed, falling back to database_query only:', error);
      
      // Fallback: if orchestrator fails, at least run database_query
      return {
        tools: mandatoryTools,
        strategy: 'parallel'
      } as ToolPlan;
    }
  }
}
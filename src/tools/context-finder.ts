import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { TOOLS } from './index.js';
import { checkUsageLimit, trackUsage, decrementUsage } from '../lib/usage.js';
import { Executor } from './internal/executor.js';
import { Refiner } from './internal/refiner.js';

export function registerContextFinderTool(server: McpServer) {
  console.log('Registering context_finder tool...');
  
  const tool = server.tool(
    'context_finder',
    'Processes any query by automatically selecting and using the best available internal tools to provide comprehensive answers.',
    {
      query: z.string().min(1, 'Query is required'),
      context: z.record(z.any()).optional().describe('Optional context'),
    },
    async (params) => {
      const startTime = Date.now();
      const { query, context } = params;
      
      logger.info(`Context Finder received: "${query}"`);
      logger.info('Context received:', JSON.stringify(context, null, 2));
      
      try {
        // Extract user info from context - middleware injects it as context.clerkUserId
        const clerkUserId = context?.clerkUserId;
        const usageStrategy = context?.usageStrategy;
        
        if (!clerkUserId) {
          logger.error('No user ID found in context');
          logger.error('Available context keys:', Object.keys(context || {}));
          return {
            content: [{
              type: 'text',
              text: 'Error: User authentication required. Please ensure you are properly authenticated.'
            }],
          };
        }
        
        logger.info(`Processing query for user: ${clerkUserId}`);
        
        // Step 0: Check usage limits before processing
        logger.info('Checking usage limits...');
        const usageCheck = await checkUsageLimit(clerkUserId);
        
        if (!usageCheck.canProceed) {
          logger.warn(`Usage limit exceeded for user: ${clerkUserId}`, {
            availableToday: usageCheck.availableToday,
            availableMonth: usageCheck.availableMonth,
            heroPoints: usageCheck.heroPoints
          });
          
          return {
            content: [{
              type: 'text',
              text: usageCheck.message || 'Usage limit exceeded. Please try again later.'
            }],
          };
        }
        
        logger.info('Usage check passed', {
          availableToday: usageCheck.availableToday,
          availableMonth: usageCheck.availableMonth,
          heroPoints: usageCheck.heroPoints
        });
        
        // Initialize the two remaining components
        const executor = new Executor();
        const refiner = new Refiner();
        
        // Step 1: Create a fixed tool plan with only database_query
        const toolPlan = {
          tools: [{
            name: 'database_query',
            params: { 
              query: query
            },
            priority: 1,
            reason: 'Search user private data and uploaded documents'
          }],
          strategy: 'parallel' as const
        };
        
        logger.info('📋 Using database_query tool');
        
        // Step 2: Executor - Execute the database_query tool
        logger.info('🔧 Starting execution...');
        const toolResults = await executor.executeTools(toolPlan, clerkUserId);
        
        // Step 3: Refiner - Process and refine the results
        logger.info('✨ Starting refinement...');
        const refinedResponse = await refiner.refineResults(query, toolResults);
        
        const executionTime = Date.now() - startTime;
        
        // Track usage with refined response data
        const estimatedTokenUsage = {
          prompt_tokens: Math.floor(query.length / 4) + 200, // Rough estimation
          completion_tokens: Math.floor(refinedResponse.content.length / 4),
          total_tokens: Math.floor((query.length + refinedResponse.content.length) / 4) + 200
        };
        
        try {
          await trackUsage(clerkUserId, 'context_finder', {
            inputTokens: estimatedTokenUsage.prompt_tokens,
            outputTokens: estimatedTokenUsage.completion_tokens,
            totalTokens: estimatedTokenUsage.total_tokens,
            cost: (estimatedTokenUsage.prompt_tokens * 0.00003 + estimatedTokenUsage.completion_tokens * 0.00006) / 1000,
            processingTime: executionTime,
            toolsUsed: ['database_query'],
            confidence: refinedResponse.confidence
          });
          
          // Decrement usage
          await decrementUsage(clerkUserId, usageStrategy?.useHeroPoints || false);
        } catch (usageError) {
          logger.error('Usage tracking failed:', usageError);
          // Don't fail the request due to usage tracking error
        }
        
        logger.info(`🎯 Context finding completed in ${executionTime}ms with ${refinedResponse.confidence}% confidence`);
        
        return {
          content: [{
            type: 'text',
            text: refinedResponse.content
          }],
        };
        
      } catch (error) {
        logger.error('Context finder failed:', error);
        
        // Sanitize error messages - never expose internal errors to users
        let userMessage = 'Something went wrong. Please try again later.';
        
        // Check for specific error patterns we want to handle
        const errorString = error instanceof Error ? error.message : String(error);
        
        // Rate limit or quota errors
        if (errorString.includes('429') || 
            errorString.includes('rate limit') || 
            errorString.includes('quota') ||
            errorString.includes('Request too large') ||
            errorString.includes('tokens per min')) {
          userMessage = 'Our AI service is currently busy. Please try again in a few minutes.';
        }
        
        // Authentication/permission errors
        else if (errorString.includes('401') || 
                 errorString.includes('403') || 
                 errorString.includes('unauthorized')) {
          userMessage = 'Something went wrong. Please try again later.';
        }
        
        // Network/connection errors
        else if (errorString.includes('ECONNREFUSED') || 
                 errorString.includes('network') || 
                 errorString.includes('timeout')) {
          userMessage = 'Connection issue detected. Please try again later.';
        }
        
        // For all other errors, use generic message
        // (This includes database errors, validation errors, etc.)
        
        return {
          content: [{
            type: 'text',
            text: userMessage
          }],
        };
      }
    }
  );
  
  // Store the registered tool
  TOOLS.context_finder.registeredTool = tool;
  console.log('Successfully registered context_finder tool');
}
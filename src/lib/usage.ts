import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  processingTime: number;
  toolsUsed: string[];
  confidence?: number;
}

export interface UsageCheck {
  canProceed: boolean;
  message?: string;
  availableToday: number;
  availableMonth: number;
  heroPoints: number;
}

export async function checkUsageLimit(clerkUserId: string): Promise<UsageCheck> {
  try {
    // Direct table query instead of function
    const { data, error } = await supabase
      .from('users')
      .select('available_requests_today, available_requests_month, hero_points')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (error) {
      logger.error('Usage check error:', error);
      return {
        canProceed: false,
        message: 'Unable to verify your usage limits. Please try again.',
        availableToday: 0,
        availableMonth: 0,
        heroPoints: 0
      };
    }

    if (!data) {
      logger.warn('User not found in database:', clerkUserId);
      return {
        canProceed: false,
        message: 'User account not found. Please contact support.',
        availableToday: 0,
        availableMonth: 0,
        heroPoints: 0
      };
    }

    const availableToday = data.available_requests_today || 0;
    const availableMonth = data.available_requests_month || 0;
    const heroPoints = data.hero_points || 0;

    logger.info('Usage check:', { 
      clerkUserId, 
      availableToday, 
      availableMonth, 
      heroPoints,
      rawData: data
    });

    // Check if user has any requests available
    if (availableToday > 0 || heroPoints > 0) {
      return {
        canProceed: true,
        availableToday,
        availableMonth,
        heroPoints
      };
    }

    // No daily requests but has monthly requests
    if (availableToday === 0 && availableMonth > 0) {
      return {
        canProceed: false,
        message: 'You have used all your requests for today. Your daily limit will reset tomorrow, or you can use Hero Points if available.',
        availableToday,
        availableMonth,
        heroPoints
      };
    }

    // No monthly requests left
    if (availableMonth === 0) {
      return {
        canProceed: false,
        message: 'You have used your monthly request limit. Please upgrade your plan for more requests or wait until next month.',
        availableToday,
        availableMonth,
        heroPoints
      };
    }

    // Fallback
    return {
      canProceed: false,
      message: 'Unable to process your request. Please contact support.',
      availableToday,
      availableMonth,
      heroPoints
    };

  } catch (error) {
    logger.error('Usage check failed:', error);
    return {
      canProceed: false,
      message: 'Unable to verify your usage limits. Please try again.',
      availableToday: 0,
      availableMonth: 0,
      heroPoints: 0
    };
  }
}

export async function trackUsage(clerkUserId: string, endpoint: string, usage: UsageData): Promise<void> {
  try {
    const costCents = Math.round(usage.cost * 100);

    await supabase
      .from('requests')
      .insert({
        clerk_user_id: clerkUserId,
        endpoint,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        cost_cents: costCents,
        tools_used: usage.toolsUsed,
        processing_time_ms: usage.processingTime,
        confidence: usage.confidence,
        is_error: false
      });

    logger.info('Usage tracked', { clerkUserId, endpoint });

  } catch (error) {
    logger.error('Track usage error', error);
  }
}

export async function decrementUsage(clerkUserId: string, useHeroPoints: boolean = false): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .rpc('decrement_usage', {
        p_clerk_user_id: clerkUserId,
        p_use_hero_points: useHeroPoints
      });

    if (error || !data || data.length === 0) {
      logger.error('Decrement usage error', error);
      return false;
    }

    logger.info('Usage decremented', { clerkUserId, useHeroPoints });
    return true;

  } catch (error) {
    logger.error('Decrement usage error', error);
    return false;
  }
}
import { Scalekit, TokenValidationOptions } from '@scalekit-sdk/node';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config/config.js';
import { logger } from './logger.js';

const scalekit = new Scalekit(config.skEnvUrl, config.skClientId, config.skClientSecret);
const EXPECTED_AUDIENCE = config.expectedAudience;
export const WWWHeader = {HeaderKey: 'WWW-Authenticate',HeaderValue: `Bearer realm="OAuth", resource_metadata="https://server.nexoraai.ch/.well-known/oauth-protected-resource"`}

// Extend Request type to include user info
declare global {
    namespace Express {
        interface Request {
            clerkUserId?: string;
        }
    }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        // Allow public access to well-known endpoints
        if (req.path.includes('.well-known')) {
            return next();
        }

        // Apply authentication to all MCP requests
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ')? authHeader.split('Bearer ')[1]?.trim(): null;

        if (!token) {
            logger.warn('Missing Bearer token', {path: req.path,method: req.method,body: req.body});
            throw new Error('Missing or invalid Bearer token');
        }

        logger.info('Access token received', { token });

        // Validate token without scope requirements
        const validateTokenOptions: TokenValidationOptions = { audience: [EXPECTED_AUDIENCE] };
        await scalekit.validateToken(token, validateTokenOptions);
        
        // Extract Clerk user ID from the token
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        const clerkUserId = payload.sub; // This is the Clerk user ID
        
        // Attach user ID to request for use in tools
        req.clerkUserId = clerkUserId;
        
        // If this is a tool call, inject the clerkUserId into the context
        if (req.body?.method === 'tools/call') {
            if (!req.body.params) {
                req.body.params = {};
            }
            if (!req.body.params.arguments) {
                req.body.params.arguments = {};
            }
            if (!req.body.params.arguments.context) {
                req.body.params.arguments.context = {};
            }
            
            // Inject the clerkUserId into the tool arguments
            req.body.params.arguments.context.clerkUserId = clerkUserId;
            
            logger.info(`Injected clerkUserId into tool context: ${clerkUserId}`);
        }
        
        logger.info('Authentication successful', { clerkUserId });
        next();
    } catch (err) {
        logger.warn('Unauthorized request', { error: err instanceof Error ? err.message : String(err) });
        return res.status(401).set(WWWHeader.HeaderKey, WWWHeader.HeaderValue).end();
    }
}
import { Scalekit, TokenValidationOptions } from '@scalekit-sdk/node';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config/config.js';
import { TOOLS } from '../tools/index.js';
import { logger } from './logger.js';

const scalekit = new Scalekit(config.skEnvUrl, config.skClientId, config.skClientSecret);
const EXPECTED_AUDIENCE = config.expectedAudience;
export const WWWHeader = {HeaderKey: 'WWW-Authenticate',HeaderValue: `Bearer realm="OAuth", resource_metadata="https://mcp.nexoraai.ch/.well-known/oauth-protected-resource"`}

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

        // DEBUG: Log the token to see what the client is sending
        console.log('=== DEBUG: Token received from client ===');
        console.log('Token:', token);
        console.log('Token length:', token.length);
        // Decode the JWT payload (middle part) to see what's inside
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            console.log('Decoded token payload:', JSON.stringify(payload, null, 2));
        } catch (e) {
            console.log('Could not decode token payload:', e);
        }
        console.log('=== END DEBUG ===');

         // For tool calls, add scopes to be validated
         let validateTokenOptions: TokenValidationOptions = { audience: [EXPECTED_AUDIENCE] };
         const isToolCall = req.body?.method === 'tools/call';
         if (isToolCall) {
             const toolName = req.body?.params?.name as keyof typeof TOOLS;
             if (toolName && (toolName in TOOLS)) {
                 validateTokenOptions.requiredScopes = TOOLS[toolName].requiredScopes;
             }
             logger.info(`Verifying scopes for tool call: ${toolName}`, { requiredScopes: validateTokenOptions.requiredScopes });
         }
 
         const validationResult = await scalekit.validateToken(token, validateTokenOptions);
         
         // Extract Clerk user ID from the token
         const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
         const clerkUserId = payload.sub; // This is the Clerk user ID
         
         // You can now use clerkUserId in your application
         console.log('Clerk User ID:', clerkUserId);
         
         logger.info('Authentication successful');
         next();
     } catch (err) {
         logger.warn('Unauthorized request', { error: err instanceof Error ? err.message : String(err) });
         return res.status(401).set(WWWHeader.HeaderKey, WWWHeader.HeaderValue).end();
     }
 }
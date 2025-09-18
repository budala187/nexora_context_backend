import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { logger } from './logger.js';

export const setupTransportRoutes = (
  app: express.Express,
  server: McpServer
) => {
  app.post('/', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      
      // Connect the server to the transport
      await server.connect(transport);
      
      // Handle the request
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Transport error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: req.body?.id || null,
          error: {
            code: -32000,
            message: 'Internal server error',
            data: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  });
};
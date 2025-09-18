import { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContextFinderTool } from './context-finder.js';

const toolsList = {
  context_finder: {
    name: 'context_finder',
    description: 'Processes any query by automatically selecting and using the best available internal tools to provide comprehensive answers.',
    requiredScopes: [],
  },
} as const;

export type ToolKey = keyof typeof toolsList;

export type ToolDefinition = {
  name: ToolKey;
  description: string;
  registeredTool?: RegisteredTool;
  requiredScopes: string[];
};

export const TOOLS: { [K in ToolKey]: ToolDefinition & { name: K } } = Object.fromEntries(
  Object.entries(toolsList).map(([key, val]) => [
    key,
    { ...val, name: key, requiredScopes: [...val.requiredScopes] } as ToolDefinition & { name: typeof key },
  ])
) as any;

export function registerTools(server: McpServer) {
  console.log('Starting registerTools function...');
  console.log('Available tools:', Object.keys(TOOLS));
  registerContextFinderTool(server);
  console.log('Finished registerTools function');
}
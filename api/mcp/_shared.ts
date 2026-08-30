import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Vercel-function wrapper for the stateless MCP servers in mcp/*.
 * Same request lifecycle as their local Express routes: a fresh server and
 * transport per request (the SDK transport is not safe to share across
 * concurrent stateless requests), conversational state lives in the harness.
 * Vercel has already JSON-parsed the body, so it is passed through to
 * handleRequest exactly like express.json() would have.
 */
export function mcpHandler(build: () => McpServer) {
  return async function handler(
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse,
  ): Promise<void> {
    if (req.method !== 'POST') {
      // Stateless mode has nothing to resume or terminate, but clients probe
      // GET/DELETE — answer like the local servers do instead of 404ing.
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'stateless server: use POST' }));
      return;
    }
    const server = build();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
  };
}

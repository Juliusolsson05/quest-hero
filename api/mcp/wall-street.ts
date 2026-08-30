import { buildServer } from '../../mcp/wall-street/src/server.js';
import { mcpHandler } from './_shared.js';

export default mcpHandler(buildServer);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { CANNED_TAUNTS, QUESTIONS } from './sources';
import { judge, nextQuestion, questionById } from './judge';

/**
 * Mark the startup enemy, as tools. Three of them, all read-only (annotated so
 * TrueForge's approval gates never pause the fight): draw a question, judge an
 * answer, fetch gloating material. The answer key never leaves judge.ts — the
 * model is told WHETHER the player was right, not what the answer was until
 * after it has judged.
 *
 * Besides MCP, a tiny REST mirror (/question, /judge) serves the hub's
 * keyless fallback: when TrueForge has no model configured, the game still
 * gets deterministic questions and verdicts — just with canned trash talk.
 */

const PORT = Number(process.env.MARK_PORT ?? 8813);

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

function buildServer(): McpServer {
  const server = new McpServer({ name: 'mark', version: '0.1.0' });

  server.registerTool(
    'mark_next_question',
    {
      title: 'Draw the next SF trivia question',
      description:
        'Draw one San Francisco trivia question the player has not seen this fight. ' +
        'Call this EVERY time you ask a question — never invent one from memory. ' +
        'Ask the returned question text verbatim; it states its own tolerance. ' +
        'Do NOT reveal or hint at the answer.',
      inputSchema: {
        seen_ids: z
          .array(z.string())
          .describe('Question ids already asked this fight, so the player never gets a repeat.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ seen_ids }) => {
      try {
        const q = nextQuestion(seen_ids ?? []);
        return ok({ id: q.id, category: q.category, difficulty: q.difficulty, question: q.question });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'mark_judge_answer',
    {
      title: 'Judge the player’s answer',
      description:
        'Judge the player’s answer to a question you asked. Call this EVERY time — ' +
        'never decide correctness from memory. Years and numbers are matched within ' +
        'the question’s stated tolerance; names accept common aliases. React to the ' +
        'verdict in character, and use the returned fact to gloat.',
      inputSchema: {
        question_id: z.string().describe('The id returned by mark_next_question.'),
        answer: z.string().describe('The player’s answer, verbatim.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ question_id, answer }) => {
      try {
        const v = judge(question_id, answer);
        if (!v) return fail(new Error(`unknown question_id: ${question_id}`));
        return ok(v);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'mark_taunt_material',
    {
      title: 'Fetch grounded taunt material',
      description:
        'A few true San Francisco facts to sharpen trash talk between rounds — so the ' +
        'banter stays specific instead of generic. Facts only; the delivery is yours.',
      inputSchema: {
        count: z.number().int().min(1).max(5).optional().describe('How many facts (default 3).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ count }) => {
      try {
        const n = count ?? 3;
        const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, n);
        return ok(shuffled.map((q) => q.fact));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

/**
 * A fresh server and transport per request. The SDK's transport is not designed
 * to be shared across concurrent stateless requests, and building one costs
 * nothing next to what a model turn costs.
 */
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// Stateless mode has nothing to resume or terminate, but clients probe these.
app.get('/mcp', (_req, res) => res.status(405).json({ error: 'stateless server: use POST' }));
app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'stateless server: use POST' }));

// ── the REST mirror: the hub's keyless fallback path ───────────────────────
app.get('/question', (req, res) => {
  const seen = String(req.query.seen ?? '').split(',').filter(Boolean);
  const q = nextQuestion(seen);
  res.json({ id: q.id, question: q.question, taunt: CANNED_TAUNTS[Math.floor(Math.random() * CANNED_TAUNTS.length)] });
});
app.post('/judge', (req, res) => {
  const { question_id, answer } = (req.body ?? {}) as { question_id?: string; answer?: string };
  if (!question_id || typeof answer !== 'string') {
    res.status(400).json({ error: 'question_id and answer required' });
    return;
  }
  const v = judge(question_id, answer);
  if (!v) { res.status(404).json({ error: `unknown question_id: ${question_id}` }); return; }
  res.json(v);
});
app.get('/question/:id', (req, res) => {
  const q = questionById(req.params.id);
  if (!q) { res.status(404).json({ error: 'unknown id' }); return; }
  res.json({ id: q.id, question: q.question });
});

app.get('/health', (_req, res) => res.json({ ok: true, tools: 3, questions: QUESTIONS.length, keys_required: 0 }));

app.listen(PORT, () => {
  console.log(`mark MCP on http://localhost:${PORT}/mcp  (3 tools, ${QUESTIONS.length} questions, no API keys)`);
});

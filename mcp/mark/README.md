# quest-hero-mark-mcp

Mark the startup enemy's brain-stem: San Francisco trivia with **deterministic
judging**, plus taunt material. The boss fight's question rounds hang real
damage off these verdicts, so correctness is decided by code — the model
recites and gloats, it never grades.

## The tools

| Tool | What it does |
|---|---|
| `mark_next_question` | Draw an unseen question from the bank (`seen_ids` dedupes per fight) |
| `mark_judge_answer` | Grade an answer by the question's own rule — years/numbers within tolerance, names by alias |
| `mark_taunt_material` | True SF facts to sharpen the trash talk |

All three are annotated read-only, so TrueForge's approval gates never pause
the fight. The answer key lives in `src/sources.ts` and nowhere else — never
in agent instructions (the agent library is not private).

## Run it

```bash
npm install --include=dev   # NODE_ENV=production silently skips devDeps otherwise
npm run dev                 # http://localhost:8813/mcp   (MARK_PORT to change)
npm run smoke               # bank integrity + judging rules, exits non-zero on failure
```

## Register with TrueForge (once)

```bash
curl -X PUT http://localhost:8790/api/v1/settings/mcp-servers \
  -H 'content-type: application/json' \
  -d '{"manifest":{"type":"remote","name":"mark","url":"http://localhost:8813/mcp","description":"Mark the startup enemy — SF trivia, deterministic judging, taunt material."}}'
curl localhost:8790/api/v1/mcp-servers/mark/tools   # confirm the three tools listed
```

The hub attaches it to Mark's session as `connectors: ['mark']`
(`hub/src/boss.ts`) with `preload: true` — the server is tiny and every round
calls a tool, so deferred discovery would only add latency.

## The keyless fallback (REST mirror)

When TrueForge has no model configured, the hub calls the same logic over
plain HTTP and the fight works identically — canned trash talk instead of the
model's:

```bash
curl 'localhost:8813/question?seen=golden-gate-year'
curl -X POST localhost:8813/judge -H 'content-type: application/json' \
  -d '{"question_id":"golden-gate-year","answer":"opened in 1930 I think"}'
# → {"correct":true,"expected":"1937 (±10 years accepted)","detail":"1930 is 7 off 1937 (tolerance 10)",…}
```

## Layout

- `src/sources.ts` — the question bank (id, rule, gloat fact) + canned taunts
- `src/judge.ts` — rule evaluation: first-integer extraction, alias matching
- `src/server.ts` — MCP wiring (streamable HTTP, stateless) + the REST mirror
- `src/smoke.ts` — live checks, `npm run smoke`

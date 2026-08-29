# TrueForge documentation (vendored)

A local mirror of the [TrueForge](https://trueforge.dev) documentation, so the
harness reference is available offline and greppable while we build.

- **Source:** https://trueforge.dev (page list from `llms.txt`)
- **Upstream project:** https://github.com/truefoundry/trueforge
- **License:** MIT, © 2024–2026 TrueFoundry — see `LICENSE.upstream`
- **Fetched:** 2026-08-29
- **Pages:** 81, plus `llms.txt` (index) and `llms-full.txt` (everything in one file)

This is a **copy, not a fork.** Nothing here is ours and nothing here should be
edited — upstream is authoritative, and local edits would be silently clobbered
on the next sync. To refresh:

```bash
./scripts/sync-trueforge-docs.sh
```

## Where to look

| Need | Page |
| --- | --- |
| Mental model: Agent → Session → Turn → Event → Delta | `api/overview.md` |
| Streaming, approvals, questions, reconnects — the recipe book | `api/use-agent.md` |
| First working turn | `api/quickstart.md` |
| Every agent option, and the API for what the UI omits | `create-agent/overview.md` |
| Connecting our own MCP servers | `mcp-servers.md` |
| Approval gates and human checkpoints | `key-features/overview.md` |
| Delegating without polluting context | `key-features/subagents.md` |
| Keeping big MCP responses out of the context window | `key-features/large-tool-responses.md` |
| Sandboxed execution | `sandbox.md` |
| Embedding the chat UI in React | `ui-sdk/` |
| Raw HTTP endpoints | `api-reference/` |

`llms-full.txt` is the whole corpus in one file — the fastest thing to hand to
an agent that needs the entire harness surface at once.

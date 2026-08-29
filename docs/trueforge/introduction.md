> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# TrueForge

> TrueForge is an open-source agent harness — the runtime layer that turns an LLM into a working agent, with MCP tools, skills, sandboxing, approvals, and subagents built in.

## What is an agent harness?

An agent harness is the runtime layer around an LLM that turns it into a reliable, long-running agent. Instead of only generating text, the harness runs the full execution loop — planning, tool routing and execution, context management for long tasks, security boundaries like sandboxing and human-in-the-loop approvals, and session state that survives reconnects and restarts.

<Frame caption="The harness orchestrates the agent run, connecting the model, tools, sandbox, and approvals to deliver a safe, reliable result">
  <img src="https://mintcdn.com/trueforge/yAtU429u9xye0nsl/images/agent-harness-definition.png?fit=max&auto=format&n=yAtU429u9xye0nsl&q=85&s=dec73748c20dc41e3682a18e73177ee9" alt="Diagram of the agent harness sitting between a user goal and the final response: the harness orchestrates the run, routes between model, tools and MCP servers, sandbox, and approval gates, and records every step" width="1536" height="1024" data-path="images/agent-harness-definition.png" />
</Frame>

## What is TrueForge?

TrueForge is an **open-source agent harness** with three parts: a **core server** that runs the agent loop, an **HTTP API** (with a TypeScript SDK) to drive it from code, and a **chat UI** (with a React UI SDK) to drive it from the browser.

<GitHub.Repo repo="truefoundry/trueforge" />

<Frame caption="The bundled chat UI — a streaming response with the agent-steps panel expanded to show reasoning, tool calls, and a subagent.">
  <img src="https://mintcdn.com/trueforge/Lovqxp1isk6wjJ_Y/images/chat-ui.png?fit=max&auto=format&n=Lovqxp1isk6wjJ_Y&q=85&s=c2479987194cf2a052d827e1e70672dc" alt="The TrueForge chat UI showing an agent response with the agent-steps panel expanded — reasoning, Exa tool calls, and a subagent" width="3022" height="1722" data-path="images/chat-ui.png" />
</Frame>

### Key Components

<Frame caption="Chat UI and SDK connect to the TrueForge server HTTP API and agent loop, which talks to SQLite or Postgres and bring-your-own models, MCP servers, and sandbox">
  <img className="block dark:hidden" src="https://mintcdn.com/trueforge/5ux2HTzjhlaBi4qF/assets/architecture-light.svg?fit=max&auto=format&n=5ux2HTzjhlaBi4qF&q=85&s=1ea4181d4577019e6dd798fbe29224ef" alt="TrueForge architecture: Chat UI and SDK connect to the TrueForge server HTTP API and agent loop, which talks to SQLite or Postgres and bring-your-own models, MCP servers, and sandbox" width="920" height="360" data-path="assets/architecture-light.svg" />

  <img className="hidden dark:block" src="https://mintcdn.com/trueforge/YOJZrE2N-t91d-yl/assets/architecture-dark.svg?fit=max&auto=format&n=YOJZrE2N-t91d-yl&q=85&s=2eecc7fa1d797dea834431193c466259" alt="TrueForge architecture: Chat UI and SDK connect to the TrueForge server HTTP API and agent loop, which talks to SQLite or Postgres and bring-your-own models, MCP servers, and sandbox" width="920" height="360" data-path="assets/architecture-dark.svg" />
</Frame>

### TrueForge server

Runs the agent loop. When a user sends a message, the server:

* Plans the turn, calls the model, and executes tools — streaming every step back
* Pauses for [human approval](/create-agent/overview#whats-in-an-agent) on sensitive actions
* Keeps context lean on long tasks with [harness capabilities](/key-features/overview) like subagents and compaction
* Persists sessions, so conversations survive reconnects and restarts

The services the loop talks to — [model providers](/models), [MCP servers](/mcp-servers), the [sandbox provider](/sandbox) — are **bring your own**: you configure them, TrueForge orchestrates them.

<Note>
  Many harnesses run the agent *inside* a sandbox. TrueForge treats the **sandbox as a tool**: one is provisioned only
  when the agent actually needs to execute code. That's why one server can run many agents concurrently, and why turns
  that don't need code execution are cheaper and faster.
</Note>

### HTTP API + TypeScript SDK

Everything the server does is exposed as an API, so anything you see in the UI you can automate:

* REST + Server-Sent Events, with an OpenAPI spec and interactive docs at `/api/v1/docs`
* A TypeScript SDK (`@truefoundry/trueforge-core`) to create and call agents from your own code

See the [SDK Quickstart](/api/quickstart).

### Chat UI + UI SDK

A ready-made interface for the agents you create:

* Browse your agents, chat with them, and manage models, MCP servers, skills, and sandbox settings
* Bundled with the server and served on the same port — nothing extra to deploy
* Also published as a customizable [UI SDK](/chat-ui) (`@truefoundry/trueforge-ui`): theme it to your organization and launch your own Claude Desktop-like interface, backed by your TrueForge server

## Two ways to run it

The agent features are identical in both modes — only the backend around the server changes. The [Quickstart](/quickstart) has run instructions for each.

|                 | Local                                                           | Hosted                                                                                                                     |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Best for**    | Personal use — one process on your machine, like Claude Desktop | A shared deployment for your team, like Claude's managed agents                                                            |
| **How to run**  | `npx @truefoundry/trueforge`                                    | Docker Compose or Helm                                                                                                     |
| **Storage**     | SQLite                                                          | Postgres, shared by all replicas                                                                                           |
| **Extra infra** | None                                                            | Postgres + Redis                                                                                                           |
| **Replicas**    | Single process                                                  | Multiple replicas behind a load balancer. Redis peers them so streams and cancellations follow the client across replicas. |

<Warning>
  Local (standalone) mode is meant for personal use on your own machine. It is not hardened for production or shared
  internet access — there is no login by default, and your data lives in a local SQLite file. Please keep it on
  localhost. We cannot take responsibility for data loss or unauthorized access if local mode is used beyond that. For a
  team or production deployment, use hosted mode with Postgres, Redis, and [login](/authentication/overview) enabled.
</Warning>

## Start building

<CardGroup cols={3}>
  <Card title="Quickstart" icon="rocket" href="/quickstart">
    Run TrueForge with one command, configure a model provider, and start chatting.
  </Card>

  <Card title="Initial Setup" icon="sliders" href="/harness/initial-setup">
    Configure models, MCP servers, skills, and sandbox — and customize the shipped catalogs.
  </Card>

  <Card title="Create an Agent" icon="robot" href="/create-agent/overview">
    Select a model, attach connectors and skills, then save to the Agents Library.
  </Card>

  <Card title="Harness Capabilities" icon="layer-group" href="/key-features/overview">
    Sandbox-as-tool, subagents, deferred tools, code mode, compaction, and human checkpoints.
  </Card>

  <Card title="Setup Login" icon="lock" href="/authentication/overview">
    Optional OIDC for shared deployments — admin vs user, with a local no-auth default.
  </Card>

  <Card title="SDK" icon="code" href="/api/quickstart">
    HTTP API and TypeScript SDK to create sessions, stream turns, and automate agents.
  </Card>

  <Card title="Chat UI" icon="palette" href="/chat-ui">
    Bundled chat experience, or embed `@truefoundry/trueforge-ui` in your React app.
  </Card>
</CardGroup>

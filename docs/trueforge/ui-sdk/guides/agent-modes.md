> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Agent modes

> Choose from four agent modes: fixed agent, agent library, agent composer, or library + composer.

This can be configured by using the `agentConfig` object.

```ts theme={null}
type AgentConfig =
  | { mode: "SingleAgent"; name: string } //name is agent name
  | { mode: "AgentLibrary" }
  | { mode: "AgentComposer" } //Composer is agent creation flow
  | { mode: "AgentLibraryWithComposer" }; //Default mode
```

| Mode                                 | Library | Composer | New chat |
| ------------------------------------ | ------- | -------- | -------- |
| `SingleAgent`                        | —       | —        | Yes      |
| `AgentLibrary`                       | Yes     | —        | No       |
| `AgentComposer`                      | —       | Yes      | Yes      |
| `AgentLibraryWithComposer (Default)` | Yes     | Yes      | Yes      |

## Single Agent

All conversations use a single named agent configured through the name parameter. Agent selection controls are hidden, so users cannot switch agents or open the agent composer.

<Frame>
  <img src="https://mintcdn.com/trueforge/DltWzCvOR-m4zoP6/images/single-agent-1.png?fit=max&auto=format&n=DltWzCvOR-m4zoP6&q=85&s=19737277cd8aee1c5e680f0d42069a58" alt="Single Agent 1" width="2048" height="1011" data-path="images/single-agent-1.png" />
</Frame>

## AgentComposer

Users can create a new agent by selecting a model, skills, and MCP servers, then save the configured agent to the library for future use.

<Frame>
  <img src="https://mintcdn.com/trueforge/DltWzCvOR-m4zoP6/images/agent-composer-1.png?fit=max&auto=format&n=DltWzCvOR-m4zoP6&q=85&s=6bd9db10551f4bc18ce6ef672e8b69ca" alt="Agent Composer 1" width="2048" height="1011" data-path="images/agent-composer-1.png" />
</Frame>

## AgentLibrary

Users can chat with agents already saved in the library but cannot create new agents. The “New Chat” option is disabled in this mode, making it ideal for restricting agent creation while still allowing users to use existing agents.

<Frame>
  <img src="https://mintcdn.com/trueforge/DltWzCvOR-m4zoP6/images/agent-library-1.png?fit=max&auto=format&n=DltWzCvOR-m4zoP6&q=85&s=4be73f365235598c762271bf4e973de5" alt="Agent Library 1" width="2048" height="1011" data-path="images/agent-library-1.png" />
</Frame>

## AgentLibraryWithComposer

Users can choose an existing agent from the library or create a new agent using the composer.

<Frame>
  <img src="https://mintcdn.com/trueforge/DltWzCvOR-m4zoP6/images/agent-library-with-composer-1.png?fit=max&auto=format&n=DltWzCvOR-m4zoP6&q=85&s=ca5d63124159ac9455ad929c273c4266" alt="Agent Library With Composer 1" width="2048" height="1011" data-path="images/agent-library-with-composer-1.png" />
</Frame>

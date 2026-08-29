> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Agents Library

> Browse, edit, and try saved agents from one place.

The **Agents Library** is where saved agents live. Open it from the chat UI to search agents, edit their configuration, or start a conversation with **Try**.

<Frame caption="Agents Library — search, edit, and try saved agents.">
  <img src="https://mintcdn.com/trueforge/Lovqxp1isk6wjJ_Y/images/agents-library.png?fit=max&auto=format&n=Lovqxp1isk6wjJ_Y&q=85&s=a9991ee25a97b6d65fddfb2a493ce588" alt="Agents Library modal listing saved agents with Edit and Try actions" width="3022" height="1722" data-path="images/agents-library.png" />
</Frame>

From the library you can:

* **Search** agents by name
* **Edit** an agent's model, connectors, skills, and instructions
* **Try** an agent to open a chat session with it

## Visibility and access (hosted mode)

In **hosted mode** with [login](/authentication/overview) enabled, TrueForge does **not** yet scope the agent library per user or team.

<Warning>
  Agents created by anyone are visible to everyone who can use the deployment. Treat the library as a shared catalog
  for the whole instance — avoid putting secrets in agent instructions, and assume colleagues can open and try any
  saved agent.
</Warning>

Session history remains owner-scoped (each user sees their own chats). Settings (models, connectors, skills, sandbox) remain **admin-only** when OIDC is enabled. The agent library itself is currently open to all authenticated users on that host.

In **local mode** (single shared identity), there is one user, so the same shared-library model applies by definition.

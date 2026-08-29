> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart

> Render a working agent chat UI against a TrueForge server

## Installation

<CodeGroup>
  ```shellscript npm theme={null}
  npm install @truefoundry/trueforge-ui @truefoundry/trueforge-sdk
  ```

  ```text pnpm theme={null}
  pnpm add @truefoundry/trueforge-ui @truefoundry/trueforge-sdk
  ```

  ```text yarn theme={null}
  yarn add @truefoundry/trueforge-ui @truefoundry/trueforge-sdk
  ```
</CodeGroup>

`react` and `react-dom` are required peer dependencies (version 18 or 19).

## Render the UI

Point `TrueForgeUI` at your TrueForge server:

```tsx App.tsx theme={null}
import { TrueForgeUI } from "@truefoundry/trueforge-ui";

export default function App() {
  return (
    <div style={{ height: "100dvh" }}>
      <TrueForgeUI
        server={{
          type: "trueforge",
          baseUrl: "http://localhost:8790",
          // token: "<bearer token>", // only if the server has OIDC login enabled
        }}
        layout="sidebar"
      />
    </div>
  );
}
```

`baseUrl` is your harness API root (defaults to `/` for same-origin). Add `token` — a Bearer token for the SDK — only when the server has OIDC login enabled. That is enough to get a full agent chat with streaming, history, and tool calls.

<Frame caption="What `TrueForgeUI` renders — a full agent chat with streaming, history, and tool calls.">
  <img src="https://mintcdn.com/trueforge/fy_5ANL96yxe712v/images/agent-composer-with-library.png?fit=max&auto=format&n=fy_5ANL96yxe712v&q=85&s=66f2e33e458478b938c943dff99e1b31" alt="The TrueForgeUI component rendering an agent chat with an agent-steps panel and a streamed response" width="3016" height="1490" data-path="images/agent-composer-with-library.png" />
</Frame>

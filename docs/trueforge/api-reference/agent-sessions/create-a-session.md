> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a session

> Create a session with `agent` as either `{ name }` (named registry binding) or `{ spec: AgentSpec }` (inline). Named sessions snapshot the agent name at create and resolve the live agent on each turn. Responses use `{ type: "reference", name, id }` or `{ type: "inline", spec }`.



## OpenAPI

````yaml /openapi.json post /api/v1/sessions
openapi: 3.1.0
info:
  description: >-
    HTTP API for the TrueForge agent server (`/api/v1`). Interactive docs are
    served at `/api/v1/docs` (OpenAPI JSON at `/api/v1/openapi.json`).


    **Authentication:** Standalone deployments (no OIDC) accept requests without
    credentials — middleware stamps a local default user. When OIDC is
    configured, protected routes require a valid `id_token` cookie or
    `Authorization: Bearer` ID token. There is no built-in API-key scheme; pass
    custom headers only if your reverse proxy or IdP layer requires them.


    Covers DB-backed sessions, the agent registry, settings catalogs, and
    model/MCP/skill/sandbox providers.
  title: TrueForge API
  version: 0.2.0-rc.0
servers: []
security:
  - BearerAuth: []
tags:
  - name: Auth
  - name: Capabilities
  - name: Models
  - name: MCP Servers
  - name: Skills
  - name: Sandboxes
  - name: Agents
  - name: Schedules
  - name: Agent Sessions
paths:
  /api/v1/sessions:
    post:
      tags:
        - Agent Sessions
      summary: Create a session
      description: >-
        Create a session with `agent` as either `{ name }` (named registry
        binding) or `{ spec: AgentSpec }` (inline). Named sessions snapshot the
        agent name at create and resolve the live agent on each turn. Responses
        use `{ type: "reference", name, id }` or `{ type: "inline", spec }`.
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateSessionRequest'
        required: true
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetSessionResponse'
          description: Session created.
        '400':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Invalid request body.
        '404':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Named agent not found.
        '422':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: >-
            The agent spec is valid but references a resource this server does
            not provide (e.g. model, MCP server, skill, or sandbox).
components:
  schemas:
    CreateSessionRequest:
      additionalProperties: false
      properties:
        agent:
          $ref: '#/components/schemas/CreateSessionAgent'
      required:
        - agent
      type: object
    GetSessionResponse:
      properties:
        data:
          $ref: '#/components/schemas/Session'
      required:
        - data
      type: object
    RequestErrorResponse:
      properties:
        error:
          properties:
            code:
              description: Optional machine-readable error code; null when not applicable.
              type:
                - string
                - 'null'
            message:
              description: Human-readable explanation of the failure.
              type: string
            param:
              description: >-
                Optional request field that caused the error; null when not
                field-specific.
              type:
                - string
                - 'null'
            type:
              description: Optional error category (e.g. validation vs conflict).
              type: string
          required:
            - message
          type: object
      required:
        - error
      type: object
    CreateSessionAgent:
      anyOf:
        - $ref: '#/components/schemas/SessionAgentNameRef'
        - $ref: '#/components/schemas/SessionAgentSpecBody'
    Session:
      properties:
        agent:
          $ref: '#/components/schemas/SessionAgent'
        created_at:
          description: ISO 8601 creation timestamp.
          type: string
        created_by:
          description: Caller identity that created the session (immutable).
          type: string
        id:
          description: Unique session id.
          type: string
        title:
          description: Optional human-readable title; null until set.
          type:
            - string
            - 'null'
        updated_at:
          description: ISO 8601 last-update timestamp.
          type: string
      required:
        - id
        - agent
        - title
        - created_by
        - created_at
        - updated_at
      type: object
    SessionAgentNameRef:
      additionalProperties: false
      properties:
        name:
          $ref: '#/components/schemas/ResourceName'
      required:
        - name
      type: object
    SessionAgentSpecBody:
      additionalProperties: false
      properties:
        spec:
          $ref: '#/components/schemas/AgentSpec'
      required:
        - spec
      type: object
    SessionAgent:
      discriminator:
        mapping:
          inline:
            $ref: '#/components/schemas/SessionAgentInline'
          reference:
            $ref: '#/components/schemas/SessionAgentReference'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/SessionAgentReference'
        - $ref: '#/components/schemas/SessionAgentInline'
    ResourceName:
      maxLength: 64
      minLength: 2
      pattern: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$
      type: string
    AgentSpec:
      description: >-
        Complete agent definition used inline on a session or saved as a named
        agent.
      properties:
        config:
          $ref: '#/components/schemas/RuntimeConfig'
        instructions:
          description: >-
            Optional system prompt — the agent's role, behavior, and
            constraints.
          type: string
        mcp_servers:
          description: Optional MCP servers attached by configured name.
          items:
            $ref: '#/components/schemas/MCPServer'
          type: array
        messages:
          description: >-
            Optional initial user messages injected at the start of every
            session.
          items:
            $ref: '#/components/schemas/InitialUserMessage'
          type: array
        model:
          $ref: '#/components/schemas/Model'
        response_format:
          $ref: '#/components/schemas/ResponseFormat'
        skills:
          description: >-
            Optional name-only skill references. Requires
            `config.sandbox.enabled: true`.
          items:
            $ref: '#/components/schemas/Skill'
          type: array
      required:
        - model
      type: object
    SessionAgentInline:
      additionalProperties: false
      properties:
        spec:
          $ref: '#/components/schemas/AgentSpec'
        type:
          description: Bind the session to an inline AgentSpec (not a registry id).
          enum:
            - inline
          type: string
      required:
        - type
        - spec
      type: object
    SessionAgentReference:
      additionalProperties: false
      properties:
        id:
          description: Registry agent id.
          minLength: 1
          type: string
        name:
          description: >-
            Create-time snapshot of the registry agent name; null for legacy or
            orphan rows.
          type:
            - string
            - 'null'
        type:
          description: Bind the session to a named registry agent.
          enum:
            - reference
          type: string
      required:
        - type
        - id
        - name
      type: object
    RuntimeConfig:
      default:
        ask_user_questions:
          enabled: true
        context_management:
          compaction:
            enabled: true
          large_tool_response:
            enabled: true
        dynamic_sub_agents:
          enabled: true
        generative_ui:
          enabled: true
        iteration_limit: 100
        sandbox:
          enabled: false
          file_downloads: true
      properties:
        ask_user_questions:
          $ref: '#/components/schemas/AskUserQuestionsConfig'
        context_management:
          $ref: '#/components/schemas/ContextManagementConfig'
        dynamic_sub_agents:
          $ref: '#/components/schemas/DynamicSubAgentsConfig'
        generative_ui:
          $ref: '#/components/schemas/GenerativeUIConfig'
        iteration_limit:
          default: 100
          description: 'Max agent-loop iterations per turn (1–1024). Default: 100.'
          exclusiveMinimum: 0
          maximum: 1024
          type: integer
        sandbox:
          $ref: '#/components/schemas/SandboxConfig'
      type: object
    MCPServer:
      properties:
        disable_tools:
          default: []
          description: 'Tools subtracted from the enabled set. Default: none.'
          items:
            $ref: '#/components/schemas/MCPServerToolSelector'
          type: array
        enable_tools:
          default:
            - '@all'
          description: >-
            Tools exposed to the agent: `@all`, `@read-only`, or literal tool
            names. Default: `["@all"]`.
          items:
            $ref: '#/components/schemas/MCPServerToolSelector'
          type: array
        name:
          description: Name of a configured MCP server (Settings → Connectors).
          minLength: 1
          type: string
        preload:
          default: false
          description: >-
            When true, load all tool schemas upfront. Default: false (deferred
            discovery).
          type: boolean
        preload_tools:
          default: []
          description: >-
            Tools loaded eagerly into context while the rest stay deferred. A
            non-empty list implies `preload: false`.
          items:
            $ref: '#/components/schemas/MCPServerToolSelector'
          type: array
        require_approval_for_tools:
          default:
            - '@write'
            - '@destructive'
          description: >-
            Tools that pause for human approval: `@all`, `@write`,
            `@destructive`, or literal names. Default: `["@write",
            "@destructive"]`.
          items:
            $ref: '#/components/schemas/MCPServerApprovalToolSelector'
          type: array
      required:
        - name
      type: object
    InitialUserMessage:
      properties:
        content:
          description: Initial user message content injected at the start of every session.
          minLength: 1
          type: string
        type:
          description: Initial message type.
          enum:
            - user.message
          type: string
      required:
        - type
        - content
      type: object
    Model:
      properties:
        name:
          description: 'Model FQN: `provider/model`, e.g. `openai/gpt-5.2`.'
          minLength: 1
          type: string
        params:
          $ref: '#/components/schemas/ModelParams'
      required:
        - name
      type: object
    ResponseFormat:
      discriminator:
        mapping:
          json_object:
            $ref: '#/components/schemas/ResponseFormatJsonObject'
          json_schema:
            $ref: '#/components/schemas/ResponseFormatJsonSchema'
          text:
            $ref: '#/components/schemas/ResponseFormatText'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/ResponseFormatText'
        - $ref: '#/components/schemas/ResponseFormatJsonObject'
        - $ref: '#/components/schemas/ResponseFormatJsonSchema'
    Skill:
      additionalProperties: false
      properties:
        name:
          description: >-
            Name of a configured skill (also used as the skill directory name in
            the sandbox).
          maxLength: 64
          minLength: 1
          pattern: ^[A-Za-z0-9._-]+$
          type: string
      required:
        - name
      type: object
    AskUserQuestionsConfig:
      default:
        enabled: true
      properties:
        enabled:
          default: true
          description: 'Enable the `ask_user_question` tool. Default: true.'
          type: boolean
      type: object
    ContextManagementConfig:
      default:
        compaction:
          enabled: true
        large_tool_response:
          enabled: true
      properties:
        compaction:
          $ref: '#/components/schemas/CompactionConfig'
        large_tool_response:
          $ref: '#/components/schemas/LargeToolResponseConfig'
      type: object
    DynamicSubAgentsConfig:
      default:
        enabled: true
      properties:
        enabled:
          default: true
          description: 'Allow the agent to spawn dynamic subagents. Default: true.'
          type: boolean
      type: object
    GenerativeUIConfig:
      default:
        enabled: true
      properties:
        enabled:
          default: true
          description: 'Enable Generative UI (OpenUI blocks). Default: true.'
          type: boolean
      type: object
    SandboxConfig:
      default:
        enabled: false
        file_downloads: true
      properties:
        enabled:
          description: Give the agent a sandbox. Required for skills and Code Mode.
          type: boolean
        file_downloads:
          default: true
          description: >-
            Allow downloading agent-produced files via the turn download
            endpoint. Default: true.
          type: boolean
      required:
        - enabled
      type: object
    MCPServerToolSelector:
      anyOf:
        - enum:
            - '@all'
            - '@read-only'
          type: string
        - minLength: 1
          type: string
    MCPServerApprovalToolSelector:
      anyOf:
        - enum:
            - '@all'
            - '@write'
            - '@destructive'
          type: string
        - minLength: 1
          type: string
    ModelParams:
      additionalProperties: {}
      description: >-
        Model call parameters passed through to the provider. Known keys are
        documented; extra keys are allowed and forwarded as-is.
      properties:
        max_tokens:
          description: Maximum tokens to generate in the model response.
          type: number
        parallel_tool_calls:
          description: Whether the model may emit multiple tool calls in one response.
          type: boolean
        reasoning_effort:
          description: Provider-specific reasoning effort (e.g. low/medium/high).
          type: string
        temperature:
          description: Sampling temperature; higher values increase randomness.
          type: number
        top_k:
          description: Top-k sampling; keep only the k highest-probability tokens.
          type: number
        top_p:
          description: Nucleus sampling probability mass.
          type: number
      type: object
    ResponseFormatJsonObject:
      additionalProperties: {}
      description: JSON object response format. Extra provider fields are allowed.
      properties:
        type:
          description: Model must return a JSON object.
          enum:
            - json_object
          type: string
      required:
        - type
      type: object
    ResponseFormatJsonSchema:
      additionalProperties: {}
      description: JSON Schema response format. Extra provider fields are allowed.
      properties:
        json_schema:
          additionalProperties: {}
          description: JSON Schema payload. Extra provider fields are allowed.
          properties:
            description:
              description: Optional schema description for the model.
              type: string
            name:
              description: Schema name sent to the provider.
              type: string
            schema:
              additionalProperties: {}
              description: JSON Schema object for the response.
              type: object
            strict:
              description: When true, ask the provider to enforce the schema strictly.
              type:
                - boolean
                - 'null'
          required:
            - name
          type: object
        type:
          description: Model must return JSON matching a schema.
          enum:
            - json_schema
          type: string
      required:
        - type
        - json_schema
      type: object
    ResponseFormatText:
      additionalProperties: {}
      description: Default text response format. Extra provider fields are allowed.
      properties:
        type:
          description: Unconstrained text output.
          enum:
            - text
          type: string
      required:
        - type
      type: object
    CompactionConfig:
      additionalProperties: false
      default:
        enabled: true
      description: >-
        Uses 80% of the model context length when the explicit trigger is
        omitted, or 50000 tokens if unknown.
      properties:
        enabled:
          default: true
          description: 'Summarize older history when context grows too large. Default: true.'
          type: boolean
        trigger:
          $ref: '#/components/schemas/InputTokensCompactionTrigger'
      type: object
    LargeToolResponseConfig:
      default:
        enabled: true
      properties:
        enabled:
          default: true
          description: 'Offload oversized tool responses to a sandbox file. Default: true.'
          type: boolean
      type: object
    InputTokensCompactionTrigger:
      additionalProperties: false
      properties:
        type:
          description: Trigger compaction when the estimated input reaches a token limit.
          enum:
            - input_tokens
          type: string
        value:
          description: Estimated input-token count that triggers compaction.
          exclusiveMinimum: 0
          type: integer
      required:
        - type
        - value
      type: object
  securitySchemes:
    BearerAuth:
      bearerFormat: JWT
      description: >-
        ID token (`Authorization: Bearer <id_token>`). Required on protected
        routes. Browser sessions may use the HttpOnly `id_token` cookie instead.
      scheme: bearer
      type: http

````
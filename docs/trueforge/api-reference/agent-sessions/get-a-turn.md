> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get a turn

> Fetch a single turn by ID. Only the session creator (`created_by`) may fetch it.



## OpenAPI

````yaml /openapi.json get /api/v1/sessions/{session_id}/turns/{turn_id}
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
  /api/v1/sessions/{session_id}/turns/{turn_id}:
    get:
      tags:
        - Agent Sessions
      summary: Get a turn
      description: >-
        Fetch a single turn by ID. Only the session creator (`created_by`) may
        fetch it.
      parameters:
        - description: Session identifier.
          in: path
          name: session_id
          required: true
          schema:
            description: Session identifier.
            maxLength: 64
            minLength: 1
            type: string
        - description: Turn identifier.
          in: path
          name: turn_id
          required: true
          schema:
            description: Turn identifier.
            minLength: 1
            type: string
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetTurnResponse'
          description: Turn data.
        '403':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Caller is not the session creator.
        '404':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Session or turn not found.
components:
  schemas:
    GetTurnResponse:
      properties:
        data:
          $ref: '#/components/schemas/Turn'
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
    Turn:
      properties:
        created_at:
          description: ISO 8601 creation timestamp.
          type: string
        id:
          description: Unique turn id.
          type: string
        input:
          description: Input items supplied when the turn was created.
          items:
            $ref: '#/components/schemas/TurnInputItem'
          type: array
        previous_turn_id:
          description: Prior turn this turn chains from; null for a root turn.
          type:
            - string
            - 'null'
        session_id:
          description: Session that owns this turn.
          type: string
        state:
          $ref: '#/components/schemas/TurnState'
      required:
        - id
        - session_id
        - previous_turn_id
        - state
        - created_at
      type: object
    TurnInputItem:
      discriminator:
        mapping:
          user.message:
            $ref: '#/components/schemas/UserMessage'
          user.tool_approval:
            $ref: '#/components/schemas/UserToolApprovalEvent'
          user.tool_response:
            $ref: '#/components/schemas/UserToolResponseEvent'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/UserMessage'
        - $ref: '#/components/schemas/UserToolApprovalEvent'
        - $ref: '#/components/schemas/UserToolResponseEvent'
    TurnState:
      discriminator:
        mapping:
          cancelled:
            $ref: '#/components/schemas/TurnStateCancelled'
          done:
            $ref: '#/components/schemas/TurnStateDone'
          error:
            $ref: '#/components/schemas/TurnStateError'
          running:
            $ref: '#/components/schemas/TurnStateRunning'
        propertyName: status
      oneOf:
        - $ref: '#/components/schemas/TurnStateRunning'
        - $ref: '#/components/schemas/TurnStateDone'
        - $ref: '#/components/schemas/TurnStateCancelled'
        - $ref: '#/components/schemas/TurnStateError'
    UserMessage:
      properties:
        content:
          anyOf:
            - type: string
            - items:
                $ref: '#/components/schemas/UserMessageContentItem'
              type: array
          description: Plain string or structured text/file content parts.
        type:
          description: User message input item.
          enum:
            - user.message
          type: string
      required:
        - type
        - content
      type: object
    UserToolApprovalEvent:
      properties:
        approval:
          $ref: '#/components/schemas/ApprovalDecision'
        thread_id:
          description: Thread that owns the pending tool call.
          minLength: 1
          type: string
        tool_call_id:
          description: Tool call id being approved or denied.
          minLength: 1
          type: string
        type:
          description: Client resume after tool.approval_required.
          enum:
            - user.tool_approval
          type: string
      required:
        - type
        - thread_id
        - tool_call_id
        - approval
      type: object
    UserToolResponseEvent:
      properties:
        content:
          description: Client-side tool result content.
          minLength: 1
          type: string
        thread_id:
          description: Thread that owns the pending tool call.
          minLength: 1
          type: string
        tool_call_id:
          description: Tool call id receiving the client response.
          minLength: 1
          type: string
        type:
          description: Client resume after tool.response_required.
          enum:
            - user.tool_response
          type: string
      required:
        - type
        - thread_id
        - tool_call_id
        - content
      type: object
    TurnStateCancelled:
      properties:
        completed_at:
          description: ISO 8601 time when cancellation completed.
          type: string
        metrics:
          allOf:
            - $ref: '#/components/schemas/TurnMetrics'
            - description: Optional billable aggregate for work done before cancel.
        reason:
          $ref: '#/components/schemas/TurnStateCancelledReason'
        status:
          description: Turn was cancelled before completion.
          enum:
            - cancelled
          type: string
      required:
        - status
        - reason
        - completed_at
      type: object
    TurnStateDone:
      properties:
        completed_at:
          description: ISO 8601 time when the turn reached a terminal state.
          type: string
        metrics:
          $ref: '#/components/schemas/TurnMetrics'
        output:
          anyOf:
            - $ref: '#/components/schemas/ModelMessageEvent'
            - type: 'null'
          description: >-
            Final `model.message` for the turn, or null when the turn ended
            paused without a final message.
        required_actions:
          description: >-
            Pending actions (`tool.approval_required`, `tool.response_required`,
            `mcp.auth_required`); empty when none.
          items:
            $ref: '#/components/schemas/ActionRequiredEvent'
          type: array
        status:
          description: Turn finished (possibly paused for required actions).
          enum:
            - done
          type: string
      required:
        - status
        - output
        - required_actions
        - completed_at
      type: object
    TurnStateError:
      properties:
        completed_at:
          description: ISO 8601 time when the error state was recorded.
          type: string
        message:
          description: Human-readable error message.
          type: string
        metrics:
          allOf:
            - $ref: '#/components/schemas/TurnMetrics'
            - description: Optional billable aggregate for work done before the error.
        status:
          description: Turn ended with an error.
          enum:
            - error
          type: string
      required:
        - status
        - message
        - completed_at
      type: object
    TurnStateRunning:
      properties:
        status:
          description: Turn is still executing.
          enum:
            - running
          type: string
      required:
        - status
      type: object
    UserMessageContentItem:
      discriminator:
        mapping:
          file:
            $ref: '#/components/schemas/FileContent'
          text:
            $ref: '#/components/schemas/TextContent'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/TextContent'
        - $ref: '#/components/schemas/FileContent'
    ApprovalDecision:
      discriminator:
        mapping:
          allow:
            $ref: '#/components/schemas/ApprovalAllow'
          deny:
            $ref: '#/components/schemas/ApprovalDeny'
        propertyName: status
      oneOf:
        - $ref: '#/components/schemas/ApprovalAllow'
        - $ref: '#/components/schemas/ApprovalDeny'
    TurnMetrics:
      description: Optional billable aggregate for the whole turn.
      properties:
        total_cache_read_tokens:
          description: Total cache-read tokens across model calls in this turn.
          minimum: 0
          type: integer
        total_cache_write_tokens:
          description: Total cache-write tokens across model calls in this turn.
          minimum: 0
          type: integer
        total_cost_in_usd:
          description: Estimated total cost in USD for this turn.
          minimum: 0
          type: number
        total_input_tokens:
          description: Total input tokens across model calls in this turn.
          minimum: 0
          type: integer
        total_output_tokens:
          description: Total output tokens across model calls in this turn.
          minimum: 0
          type: integer
        total_reasoning_tokens:
          description: Total reasoning tokens across model calls in this turn.
          minimum: 0
          type: integer
        total_tokens:
          description: Total tokens (input + output) across model calls in this turn.
          minimum: 0
          type: integer
      type: object
    TurnStateCancelledReason:
      description: Reason for the cancellation.
      enum:
        - server-execution-timeout
        - client-cancelled
        - cancelled-for-next-turn
        - abandoned
      type: string
    ModelMessageEvent:
      properties:
        content:
          anyOf:
            - type: string
            - items:
                anyOf:
                  - $ref: '#/components/schemas/ChatCompletionContentPartText'
                  - $ref: '#/components/schemas/ChatCompletionContentPartRefusal'
              type: array
            - type: 'null'
          description: Assistant message content as text or content parts.
        created_at:
          description: ISO 8601 event timestamp.
          type: string
        finish_reason:
          anyOf:
            - $ref: '#/components/schemas/FinishReason'
            - type: 'null'
          description: Model finish reason; null when the provider omitted it.
        id:
          description: Unique identifier for the event (monotonic ULID).
          type: string
        name:
          description: Optional participant name.
          type: string
        reasoning_content:
          type: string
        refusal:
          description: Optional refusal text.
          type:
            - string
            - 'null'
        thread_id:
          description: Thread that emitted this message (`main` for the root agent).
          type: string
        tool_calls:
          items:
            $ref: '#/components/schemas/ToolCall'
          type: array
        type:
          description: Complete assistant model message.
          enum:
            - model.message
          type: string
        usage:
          $ref: '#/components/schemas/ModelMessageUsage'
      required:
        - type
        - id
        - thread_id
        - created_at
      type: object
    ActionRequiredEvent:
      discriminator:
        mapping:
          mcp.auth_required:
            $ref: '#/components/schemas/MCPAuthRequiredEvent'
          tool.approval_required:
            $ref: '#/components/schemas/ToolApprovalRequiredEvent'
          tool.response_required:
            $ref: '#/components/schemas/ToolResponseRequiredEvent'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/ToolApprovalRequiredEvent'
        - $ref: '#/components/schemas/ToolResponseRequiredEvent'
        - $ref: '#/components/schemas/MCPAuthRequiredEvent'
    FileContent:
      properties:
        data:
          description: >-
            Data URI: `data:<mime>;base64,<payload>`. MIME type is parsed from
            the URI.
          type: string
        name:
          description: Filename presented to the agent.
          type: string
        type:
          description: File attachment content part.
          enum:
            - file
          type: string
      required:
        - type
        - name
        - data
      type: object
    TextContent:
      properties:
        text:
          description: Plain-text content.
          type: string
        type:
          description: Text content part.
          enum:
            - text
          type: string
      required:
        - type
        - text
      type: object
    ApprovalAllow:
      properties:
        status:
          description: Allow the pending tool call(s).
          enum:
            - allow
          type: string
      required:
        - status
      type: object
    ApprovalDeny:
      properties:
        reason:
          description: Optional reason shown to the agent when denied.
          type: string
        status:
          description: Deny the pending tool call(s).
          enum:
            - deny
          type: string
      required:
        - status
      type: object
    ChatCompletionContentPartText:
      properties:
        text:
          description: Plain-text content.
          type: string
        type:
          description: Text content part.
          enum:
            - text
          type: string
      required:
        - type
        - text
      type: object
    ChatCompletionContentPartRefusal:
      properties:
        refusal:
          description: Refusal message text.
          type: string
        type:
          description: Model refusal content part.
          enum:
            - refusal
          type: string
      required:
        - type
        - refusal
      type: object
    FinishReason:
      description: Why the model stopped generating.
      enum:
        - stop
        - length
        - tool_calls
        - content_filter
        - function_call
      type: string
    ToolCall:
      allOf:
        - $ref: '#/components/schemas/RawToolCall'
        - properties:
            tool_info:
              $ref: '#/components/schemas/ToolInfo'
          required:
            - tool_info
          type: object
    ModelMessageUsage:
      properties:
        cache_read_tokens:
          description: Optional cache-read tokens.
          minimum: 0
          type: integer
        cache_write_tokens:
          description: Optional cache-write tokens.
          minimum: 0
          type: integer
        input_tokens:
          description: Input tokens for this model call.
          minimum: 0
          type: integer
        input_tokens_breakdown:
          properties:
            harness:
              description: Tokens attributed to harness system framing.
              minimum: 0
              type: integer
            instructions:
              description: Tokens attributed to agent instructions.
              minimum: 0
              type: integer
            messages:
              description: Tokens attributed to conversation messages.
              minimum: 0
              type: integer
            skills:
              description: Tokens attributed to skill instructions.
              minimum: 0
              type: integer
            tool_definitions:
              description: Tokens attributed to tool schemas.
              minimum: 0
              type: integer
          required:
            - harness
            - skills
            - instructions
            - tool_definitions
            - messages
          type: object
        output_tokens:
          description: Output tokens for this model call.
          minimum: 0
          type: integer
      required:
        - input_tokens
        - output_tokens
        - input_tokens_breakdown
      type: object
    MCPAuthRequiredEvent:
      allOf:
        - $ref: '#/components/schemas/BaseMCPAuthRequiredEvent'
        - properties:
            mcp_servers:
              description: Servers that need authorization, each with an auth_url.
              items:
                $ref: '#/components/schemas/MCPServerAuthInfo'
              type: array
            type:
              description: One or more MCP servers need OAuth before tools can run.
              enum:
                - mcp.auth_required
              type: string
          required:
            - type
            - mcp_servers
          type: object
    ToolApprovalRequiredEvent:
      properties:
        created_at:
          description: ISO 8601 event timestamp.
          type: string
        id:
          description: Unique identifier for the event (monotonic ULID).
          type: string
        thread_id:
          description: Thread that owns the pending tool calls.
          type: string
        tool_calls:
          description: Tool calls waiting for approval.
          items:
            $ref: '#/components/schemas/ToolCallRef'
          type: array
        type:
          description: One or more tool calls need human approval.
          enum:
            - tool.approval_required
          type: string
      required:
        - type
        - id
        - created_at
        - thread_id
        - tool_calls
      type: object
    ToolResponseRequiredEvent:
      properties:
        created_at:
          description: ISO 8601 event timestamp.
          type: string
        id:
          description: Unique identifier for the event (monotonic ULID).
          type: string
        thread_id:
          description: Thread that owns the pending tool calls.
          type: string
        tool_calls:
          description: Tool calls waiting for a client response.
          items:
            $ref: '#/components/schemas/ToolCallRef'
          type: array
        type:
          description: One or more client-side tool calls need a user/tool response.
          enum:
            - tool.response_required
          type: string
      required:
        - type
        - id
        - created_at
        - thread_id
        - tool_calls
      type: object
    RawToolCall:
      allOf:
        - $ref: '#/components/schemas/ChatCompletionMessageToolCall'
        - properties:
            provider_specific_fields:
              additionalProperties: {}
              type: object
          type: object
    ToolInfo:
      discriminator:
        mapping:
          mcp:
            $ref: '#/components/schemas/MCPToolInfo'
          truefoundry-system:
            $ref: '#/components/schemas/TrueFoundrySystemToolInfo'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/TrueFoundrySystemToolInfo'
        - $ref: '#/components/schemas/MCPToolInfo'
    BaseMCPAuthRequiredEvent:
      properties:
        created_at:
          description: ISO 8601 event timestamp.
          type: string
        id:
          description: Unique identifier for the event (monotonic ULID).
          type: string
        thread_id:
          description: Always null — this is a run-level event.
          type:
            - string
            - 'null'
      required:
        - id
        - created_at
        - thread_id
      type: object
    MCPServerAuthInfo:
      properties:
        auth_url:
          description: URL the user must visit to complete OAuth for this server.
          type: string
        id:
          description: Internal MCP server id.
          type: string
        name:
          description: Configured MCP server name.
          type: string
      required:
        - id
        - name
        - auth_url
      type: object
    ToolCallRef:
      properties:
        id:
          description: Tool call id awaiting action.
          type: string
        source_event_id:
          description: Event id of the model.message that requested the tool call.
          type: string
      required:
        - id
        - source_event_id
      type: object
    ChatCompletionMessageToolCall:
      properties:
        function:
          properties:
            arguments:
              description: JSON-encoded function arguments string.
              type: string
            name:
              description: Function/tool name.
              type: string
          required:
            - name
            - arguments
          type: object
        id:
          description: Tool call id.
          type: string
        type:
          description: Tool call type.
          enum:
            - function
          type: string
      required:
        - id
        - type
        - function
      type: object
    MCPToolInfo:
      properties:
        name:
          description: Tool name on the MCP server.
          type: string
        server_id:
          description: Internal MCP server id.
          type: string
        server_name:
          description: Configured MCP server name.
          type: string
        type:
          description: Tool hosted on an MCP server.
          enum:
            - mcp
          type: string
      required:
        - type
        - server_id
        - server_name
        - name
      type: object
    TrueFoundrySystemToolInfo:
      properties:
        name:
          description: System tool name.
          type: string
        type:
          description: Built-in harness system tool.
          enum:
            - truefoundry-system
          type: string
      required:
        - type
        - name
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
> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Cancel a running turn in a session

> Cancel the running last turn for a session. Only the session creator (`created_by`) may cancel.



## OpenAPI

````yaml /openapi.json post /api/v1/sessions/{session_id}/cancel
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
  /api/v1/sessions/{session_id}/cancel:
    post:
      tags:
        - Agent Sessions
      summary: Cancel a running turn in a session
      description: >-
        Cancel the running last turn for a session. Only the session creator
        (`created_by`) may cancel.
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
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CancelSessionRequest'
        required: false
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CancelSessionResponse'
          description: Turn cancelled.
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
          description: Session not found.
        '412':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: >-
            Requested action cannot be performed on the session because it is no
            longer usable, or the executor owning the running turn is
            unreachable.
components:
  schemas:
    CancelSessionRequest:
      description: Empty request body. Cancel identifies the session via the path only.
      properties: {}
      type: object
    CancelSessionResponse:
      description: >-
        Empty success body. HTTP 200 means the cancel request was accepted (or
        nothing was running).
      properties: {}
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
  securitySchemes:
    BearerAuth:
      bearerFormat: JWT
      description: >-
        ID token (`Authorization: Bearer <id_token>`). Required on protected
        routes. Browser sessions may use the HttpOnly `id_token` cookie instead.
      scheme: bearer
      type: http

````
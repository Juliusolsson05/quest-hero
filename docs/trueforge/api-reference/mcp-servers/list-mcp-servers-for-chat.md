> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# List MCP servers for chat

> MCP servers as a slim name/url list for the composer. No auth or auth_status.



## OpenAPI

````yaml /openapi.json get /api/v1/mcp-servers
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
  /api/v1/mcp-servers:
    get:
      tags:
        - MCP Servers
      summary: List MCP servers for chat
      description: >-
        MCP servers as a slim name/url list for the composer. No auth or
        auth_status.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListAvailableMCPServersResponse'
          description: All MCP servers (chat projection).
        '401':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: OIDC is configured and the request has no valid session cookie.
components:
  schemas:
    ListAvailableMCPServersResponse:
      properties:
        data:
          items:
            $ref: '#/components/schemas/AvailableMCPServer'
          type: array
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
    AvailableMCPServer:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/MCPServerAuthPublic'
        auth_status:
          $ref: '#/components/schemas/MCPAuthStatus'
        name:
          $ref: '#/components/schemas/ResourceName'
        url:
          description: URL of the remote MCP server.
          format: uri
          type: string
      required:
        - name
        - url
        - auth_status
      type: object
    MCPServerAuthPublic:
      description: >-
        Auth mechanism when configured (no secrets). Omit when the server needs
        no credentials.
      oneOf:
        - additionalProperties: false
          properties:
            type:
              enum:
                - dcr
              type: string
          required:
            - type
          type: object
        - additionalProperties: false
          properties:
            type:
              enum:
                - header
              type: string
          required:
            - type
          type: object
    MCPAuthStatus:
      additionalProperties: false
      description: Current auth state.
      properties:
        authorization_url:
          description: >-
            When auth is required, this contains the URL to redirect the user to
            for authorization.
          format: uri
          type: string
        status:
          description: Current auth state for this MCP server.
          enum:
            - authenticated
            - auth_required
            - not_required
          type: string
      required:
        - status
      type: object
    ResourceName:
      maxLength: 64
      minLength: 2
      pattern: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$
      type: string
  securitySchemes:
    BearerAuth:
      bearerFormat: JWT
      description: >-
        ID token (`Authorization: Bearer <id_token>`). Required on protected
        routes. Browser sessions may use the HttpOnly `id_token` cookie instead.
      scheme: bearer
      type: http

````
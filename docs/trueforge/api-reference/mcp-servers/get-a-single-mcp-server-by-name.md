> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get a single MCP server by name

> A single MCP server by name, with nested auth_status (settings / admin projection). Header auth values are redacted.



## OpenAPI

````yaml /openapi.json get /api/v1/settings/mcp-servers/{name}
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
  /api/v1/settings/mcp-servers/{name}:
    get:
      tags:
        - MCP Servers
      summary: Get a single MCP server by name
      description: >-
        A single MCP server by name, with nested auth_status (settings / admin
        projection). Header auth values are redacted.
      parameters:
        - description: MCP server name.
          in: path
          name: name
          required: true
          schema:
            description: MCP server name.
            minLength: 1
            type: string
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetMCPServerResponse'
          description: The MCP server
        '404':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: MCP server not found.
components:
  schemas:
    GetMCPServerResponse:
      properties:
        data:
          $ref: '#/components/schemas/ConfiguredMCPServer'
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
    ConfiguredMCPServer:
      additionalProperties: false
      properties:
        auth_status:
          $ref: '#/components/schemas/MCPAuthStatus'
        manifest:
          $ref: '#/components/schemas/MCPServerManifest'
        name:
          $ref: '#/components/schemas/ResourceName'
      required:
        - name
        - manifest
        - auth_status
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
    MCPServerManifest:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/MCPServerManifestAuth'
        description:
          description: Concise summary of what this MCP server provides.
          minLength: 1
          type: string
        name:
          $ref: '#/components/schemas/ResourceName'
        type:
          $ref: '#/components/schemas/MCPServerType'
        url:
          description: URL of the remote MCP server.
          format: uri
          type: string
      required:
        - type
        - name
        - url
        - description
      type: object
    ResourceName:
      maxLength: 64
      minLength: 2
      pattern: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$
      type: string
    MCPServerManifestAuth:
      description: Optional auth settings. Omit when the server needs no credentials.
      discriminator:
        mapping:
          dcr:
            $ref: '#/components/schemas/MCPServerDcrAuth'
          header:
            $ref: '#/components/schemas/MCPServerHeaderAuth'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/MCPServerHeaderAuth'
        - $ref: '#/components/schemas/MCPServerDcrAuth'
    MCPServerType:
      enum:
        - remote
      type: string
    MCPServerDcrAuth:
      additionalProperties: false
      properties:
        type:
          description: Authenticate via OAuth Dynamic Client Registration.
          enum:
            - dcr
          type: string
      required:
        - type
      type: object
    MCPServerHeaderAuth:
      additionalProperties: false
      properties:
        headers:
          additionalProperties:
            minLength: 1
            type: string
          description: >-
            Request headers for this MCP server. Responses are redacted; on PUT,
            a real value sets/rotates and a redacted value keeps the stored
            secret for that header name.
          type: object
        type:
          description: Authenticate with static HTTP headers.
          enum:
            - header
          type: string
      required:
        - type
        - headers
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
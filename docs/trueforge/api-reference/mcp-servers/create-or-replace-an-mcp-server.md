> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Create or replace an MCP server

> Create or replace by `name`. Does not start DCR or change oauth client columns. Header secrets: real value sets/rotates; redacted keeps existing (400 if none).



## OpenAPI

````yaml /openapi.json put /api/v1/settings/mcp-servers
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
  /api/v1/settings/mcp-servers:
    put:
      tags:
        - MCP Servers
      summary: Create or replace an MCP server
      description: >-
        Create or replace by `name`. Does not start DCR or change oauth client
        columns. Header secrets: real value sets/rotates; redacted keeps
        existing (400 if none).
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateMCPServerRequest'
        required: true
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetMCPServerResponse'
          description: The saved MCP server with auth_status
        '400':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: >-
            Invalid request body, or redacted header secret with no stored value
            to keep.
        '422':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: >-
            The server cannot satisfy `auth.type: dcr` (e.g. it advertises no
            registration_endpoint).
components:
  schemas:
    UpdateMCPServerRequest:
      additionalProperties: false
      properties:
        manifest:
          $ref: '#/components/schemas/MCPServerManifest'
      required:
        - manifest
      type: object
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
    ResourceName:
      maxLength: 64
      minLength: 2
      pattern: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$
      type: string
    MCPServerType:
      enum:
        - remote
      type: string
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
> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get the MCP catalog

> Shipped MCP server presets (discovery-only). Copy into PUT /settings/mcp-servers to configure.



## OpenAPI

````yaml /openapi.json get /api/v1/catalogs/mcp-servers
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
  /api/v1/catalogs/mcp-servers:
    get:
      tags:
        - MCP Servers
      summary: Get the MCP catalog
      description: >-
        Shipped MCP server presets (discovery-only). Copy into PUT
        /settings/mcp-servers to configure.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetMCPServerCatalogResponse'
          description: Shipped MCP server presets.
        '401':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Not authenticated.
components:
  schemas:
    GetMCPServerCatalogResponse:
      properties:
        data:
          items:
            $ref: '#/components/schemas/CatalogMCPServer'
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
    CatalogMCPServer:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/MCPServerManifestAuth'
        description:
          description: Concise summary of what this MCP server provides.
          minLength: 1
          type: string
        logo:
          description: URL of the MCP server logo asset.
          format: uri
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
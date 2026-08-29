> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Start (or short-circuit) the auth flow for an MCP server

> For servers without auth returns not_required, and for header credentials returns authenticated (no browser flow). For auth.type dcr, returns authenticated when a usable (or refreshable) token exists; otherwise runs DCR if needed and returns auth_required with an authorization URL. Optional return_to is where the OAuth callback then redirects the browser; without it the callback returns JSON.



## OpenAPI

````yaml /openapi.json get /api/v1/mcp-servers/{name}/authorize
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
  /api/v1/mcp-servers/{name}/authorize:
    get:
      tags:
        - MCP Servers
      summary: Start (or short-circuit) the auth flow for an MCP server
      description: >-
        For servers without auth returns not_required, and for header
        credentials returns authenticated (no browser flow). For auth.type dcr,
        returns authenticated when a usable (or refreshable) token exists;
        otherwise runs DCR if needed and returns auth_required with an
        authorization URL. Optional return_to is where the OAuth callback then
        redirects the browser; without it the callback returns JSON.
      parameters:
        - description: MCP server name.
          in: path
          name: name
          required: true
          schema:
            description: MCP server name.
            minLength: 1
            type: string
        - description: >-
            Optional path to return to after OAuth. Must be a same-origin
            relative path; the OAuth callback redirects here with
            `isSuccess`/`reason` appended.
          in: query
          name: return_to
          required: false
          schema:
            description: >-
              Optional path to return to after OAuth. Must be a same-origin
              relative path; the OAuth callback redirects here with
              `isSuccess`/`reason` appended.
            type: string
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MCPAuthStatus'
          description: >-
            Either already authenticated, or an authorization URL to redirect
            to.
        '400':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Invalid return_to.
        '404':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: MCP server not found.
        '422':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: >-
            DCR could not be completed for this server (e.g. it lacks a
            registration_endpoint).
        '424':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: >-
            The authorization server failed dynamic client registration or
            authorization startup.
        '500':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Server misconfiguration (e.g. PUBLIC_BASE_URL unset).
components:
  schemas:
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
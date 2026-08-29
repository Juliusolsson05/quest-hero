> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get the sandbox provider catalog

> Shipped sandbox-provider presets (discovery-only). Copy into PUT /settings/sandbox-providers to configure.



## OpenAPI

````yaml /openapi.json get /api/v1/catalogs/sandbox-providers
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
  /api/v1/catalogs/sandbox-providers:
    get:
      tags:
        - Sandboxes
      summary: Get the sandbox provider catalog
      description: >-
        Shipped sandbox-provider presets (discovery-only). Copy into PUT
        /settings/sandbox-providers to configure.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetSandboxProviderCatalogResponse'
          description: Shipped sandbox-provider presets.
        '401':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Not authenticated.
components:
  schemas:
    GetSandboxProviderCatalogResponse:
      properties:
        data:
          items:
            $ref: '#/components/schemas/CatalogSandboxProvider'
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
    CatalogSandboxProvider:
      additionalProperties: false
      properties:
        auto_archive_interval_in_minutes:
          description: Minutes before Daytona auto-archives the sandbox (0 disables).
          minimum: 0
          type: integer
        auto_delete_interval_in_minutes:
          description: Minutes before Daytona auto-deletes the sandbox (0 disables).
          minimum: 0
          type: integer
        auto_stop_interval_in_minutes:
          description: >-
            Minutes of idle time before Daytona auto-stops the sandbox (0
            disables).
          minimum: 0
          type: integer
        exec_timeout_ms:
          description: Default sandbox command exec timeout in milliseconds.
          exclusiveMinimum: 0
          type: integer
        type:
          description: Daytona sandbox provider.
          enum:
            - daytona
          type: string
      required:
        - type
        - exec_timeout_ms
        - auto_stop_interval_in_minutes
        - auto_archive_interval_in_minutes
        - auto_delete_interval_in_minutes
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
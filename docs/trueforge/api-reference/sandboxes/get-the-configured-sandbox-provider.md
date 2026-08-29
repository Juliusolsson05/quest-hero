> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get the configured sandbox provider

> The single configured sandbox provider for this tenant. `auth.api_key` is redacted.



## OpenAPI

````yaml /openapi.json get /api/v1/settings/sandbox-providers
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
  /api/v1/settings/sandbox-providers:
    get:
      tags:
        - Sandboxes
      summary: Get the configured sandbox provider
      description: >-
        The single configured sandbox provider for this tenant. `auth.api_key`
        is redacted.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetSandboxProviderResponse'
          description: The configured sandbox provider.
        '404':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: No sandbox provider configured.
components:
  schemas:
    GetSandboxProviderResponse:
      properties:
        data:
          $ref: '#/components/schemas/ConfiguredSandboxProvider'
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
    ConfiguredSandboxProvider:
      additionalProperties: false
      properties:
        manifest:
          $ref: '#/components/schemas/SandboxProviderManifest'
        status:
          $ref: '#/components/schemas/SandboxBuildStatus'
        status_reason:
          description: Human-readable detail for the current status; null when ready.
          type:
            - string
            - 'null'
      required:
        - manifest
        - status
        - status_reason
      type: object
    SandboxProviderManifest:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/DaytonaSandboxProviderAuth'
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
        - auth
        - exec_timeout_ms
        - auto_stop_interval_in_minutes
        - auto_archive_interval_in_minutes
        - auto_delete_interval_in_minutes
      type: object
    SandboxBuildStatus:
      description: Current build status.
      enum:
        - pending
        - ready
        - failed
      type: string
    DaytonaSandboxProviderAuth:
      additionalProperties: false
      description: Daytona authentication credentials.
      properties:
        api_key:
          description: >-
            Daytona API key. Responses are redacted; on PUT, a real value
            sets/rotates and a redacted value keeps the stored key.
          minLength: 1
          type: string
      required:
        - api_key
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
> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get server capabilities

> Report optional runtime capabilities available for this tenant.



## OpenAPI

````yaml /openapi.json get /api/v1/capabilities
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
  /api/v1/capabilities:
    get:
      tags:
        - Capabilities
      summary: Get server capabilities
      description: Report optional runtime capabilities available for this tenant.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetCapabilitiesResponse'
          description: Server capabilities.
        '401':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: OIDC is configured and the request has no valid session cookie.
components:
  schemas:
    GetCapabilitiesResponse:
      properties:
        data:
          $ref: '#/components/schemas/CapabilitiesData'
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
    CapabilitiesData:
      properties:
        sandbox:
          $ref: '#/components/schemas/SandboxCapability'
        settings:
          $ref: '#/components/schemas/SettingsCapability'
        skill:
          $ref: '#/components/schemas/SkillCapability'
      required:
        - sandbox
        - skill
        - settings
      type: object
    SandboxCapability:
      properties:
        enabled:
          description: Whether a sandbox provider is configured for this tenant.
          type: boolean
      required:
        - enabled
      type: object
    SettingsCapability:
      properties:
        enabled:
          description: Whether the settings UI/API is enabled.
          type: boolean
      required:
        - enabled
      type: object
    SkillCapability:
      properties:
        enabled:
          description: >-
            Whether skills are available. False when sandbox is not enabled
            (skills require a sandbox).
          type: boolean
        reason:
          description: Present when skills are disabled. Explains why.
          type: string
      required:
        - enabled
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
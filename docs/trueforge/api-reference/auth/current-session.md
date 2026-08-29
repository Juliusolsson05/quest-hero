> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Current session

> Returns the authenticated caller identity. When auth is enabled this requires a valid `id_token` cookie or `Authorization: Bearer` ID token (401 otherwise). When auth is disabled, returns the default identity.



## OpenAPI

````yaml /openapi.json get /api/v1/auth/me
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
  /api/v1/auth/me:
    get:
      tags:
        - Auth
      summary: Current session
      description: >-
        Returns the authenticated caller identity. When auth is enabled this
        requires a valid `id_token` cookie or `Authorization: Bearer` ID token
        (401 otherwise). When auth is disabled, returns the default identity.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetMeResponse'
          description: Session type and identity for the current request.
        '401':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: >-
            Auth is enabled and the request has no valid cookie or Bearer ID
            token.
components:
  schemas:
    GetMeResponse:
      properties:
        email:
          description: >-
            User email from the ID token when connected; `"default"` when
            anonymous.
          type: string
        role:
          description: Caller role.
          type: string
        type:
          description: >-
            Session kind: `default` when no valid OIDC session; `oidc-connected`
            after a successful browser login.
          enum:
            - default
            - oidc-connected
          type: string
      required:
        - type
        - email
        - role
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
> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Download a file from the turn sandbox

> Download a file from the sandbox this turn ran in. Paths come from the assistant's `sandbox_artifacts` block. Only the session creator (`created_by`) may download.



## OpenAPI

````yaml /openapi.json get /api/v1/sessions/{session_id}/turns/{turn_id}/download-sandbox-file
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
  /api/v1/sessions/{session_id}/turns/{turn_id}/download-sandbox-file:
    get:
      tags:
        - Agent Sessions
      summary: Download a file from the turn sandbox
      description: >-
        Download a file from the sandbox this turn ran in. Paths come from the
        assistant's `sandbox_artifacts` block. Only the session creator
        (`created_by`) may download.
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
        - description: Turn identifier.
          in: path
          name: turn_id
          required: true
          schema:
            description: Turn identifier.
            minLength: 1
            type: string
        - description: >-
            Absolute path of the file inside the sandbox, as listed in the
            assistant's `sandbox_artifacts` block.
          in: query
          name: path
          required: true
          schema:
            description: >-
              Absolute path of the file inside the sandbox, as listed in the
              assistant's `sandbox_artifacts` block.
            minLength: 1
            type: string
      responses:
        '200':
          content:
            application/octet-stream:
              schema:
                format: binary
                type: string
          description: File contents.
        '400':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Invalid path, or the path is a directory.
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
          description: Session, turn, or file not found.
        '410':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Sandbox no longer exists.
        '412':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Turn has no sandbox, or no sandbox provider is configured.
        '413':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: File exceeds the maximum download size.
        '424':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Sandbox infrastructure error.
components:
  schemas:
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
> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a schedule

> Create a schedule for an existing agent (by name) and add its first pending run when active.



## OpenAPI

````yaml /openapi.json post /api/v1/schedules
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
  /api/v1/schedules:
    post:
      tags:
        - Schedules
      summary: Create a schedule
      description: >-
        Create a schedule for an existing agent (by name) and add its first
        pending run when active.
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateScheduleRequest'
        required: true
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetScheduleResponse'
          description: Created schedule.
        '400':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Unknown agent or invalid cron.
        '409':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: >-
            The schedule was modified concurrently (usually the controller
            advancing it). Retry.
components:
  schemas:
    CreateScheduleRequest:
      additionalProperties: false
      properties:
        agent_name:
          $ref: '#/components/schemas/ResourceName'
        manifest:
          $ref: '#/components/schemas/ScheduleManifest'
        name:
          $ref: '#/components/schemas/ResourceName'
      required:
        - agent_name
        - name
        - manifest
      type: object
    GetScheduleResponse:
      properties:
        data:
          $ref: '#/components/schemas/Schedule'
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
    ResourceName:
      maxLength: 64
      minLength: 2
      pattern: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$
      type: string
    ScheduleManifest:
      additionalProperties: false
      properties:
        cron:
          $ref: '#/components/schemas/CronExpression'
        status:
          $ref: '#/components/schemas/ScheduleStatus'
        task:
          description: First user message sent to the agent on every run.
          minLength: 1
          type: string
        timezone:
          $ref: '#/components/schemas/Timezone'
      required:
        - task
        - cron
      type: object
    Schedule:
      additionalProperties: false
      properties:
        agent_name:
          $ref: '#/components/schemas/ResourceName'
        created_at:
          format: date-time
          type: string
        created_by:
          type: string
        id:
          type: string
        manifest:
          $ref: '#/components/schemas/ScheduleManifest'
        name:
          $ref: '#/components/schemas/ResourceName'
        updated_at:
          format: date-time
          type: string
      required:
        - id
        - agent_name
        - name
        - manifest
        - created_by
        - created_at
        - updated_at
      type: object
    CronExpression:
      description: Standard 5-field cron expression, evaluated in `timezone`.
      pattern: ^[\d*,\-/]+(?:\s+[\d*,\-/]+){4}$
      type: string
    ScheduleStatus:
      default: active
      enum:
        - active
        - paused
      type: string
    Timezone:
      default: UTC
      description: IANA time zone the cron expression is evaluated in.
      minLength: 1
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
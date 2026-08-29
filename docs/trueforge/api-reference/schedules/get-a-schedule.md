> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get a schedule

> Get a schedule by id.



## OpenAPI

````yaml /openapi.json get /api/v1/schedules/{schedule_id}
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
  /api/v1/schedules/{schedule_id}:
    get:
      tags:
        - Schedules
      summary: Get a schedule
      description: Get a schedule by id.
      parameters:
        - description: Immutable schedule identifier.
          in: path
          name: schedule_id
          required: true
          schema:
            description: Immutable schedule identifier.
            maxLength: 64
            minLength: 1
            type: string
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetScheduleResponse'
          description: The schedule.
        '404':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Not found.
components:
  schemas:
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
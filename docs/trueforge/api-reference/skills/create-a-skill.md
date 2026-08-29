> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a skill

> Creates a skill keyed by `name`. Fails if `name` is already taken.



## OpenAPI

````yaml /openapi.json post /api/v1/settings/skills
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
  /api/v1/settings/skills:
    post:
      tags:
        - Skills
      summary: Create a skill
      description: Creates a skill keyed by `name`. Fails if `name` is already taken.
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateSkillRequest'
        required: true
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetSkillResponse'
          description: The created skill.
        '400':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Invalid request body.
        '409':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: A skill with this name already exists.
components:
  schemas:
    CreateSkillRequest:
      additionalProperties: false
      properties:
        manifest:
          $ref: '#/components/schemas/SkillManifest'
      required:
        - manifest
      type: object
    GetSkillResponse:
      properties:
        data:
          $ref: '#/components/schemas/ConfiguredSkill'
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
    SkillManifest:
      additionalProperties: false
      properties:
        description:
          description: Concise guidance for when the agent should use the skill.
          minLength: 1
          type: string
        name:
          $ref: '#/components/schemas/ResourceName'
        path:
          description: >-
            Path to the skill directory within the repository. Omit to use the
            repository root.
          minLength: 1
          pattern: ^[A-Za-z0-9._\-/]+$
          type: string
        ref:
          description: Git ref — branch name, tag, or commit SHA.
          minLength: 1
          pattern: ^[A-Za-z0-9._\-/]+$
          type: string
        type:
          $ref: '#/components/schemas/SkillType'
        url:
          description: Full HTTPS URL of a GitHub or GitLab repository.
          minLength: 1
          pattern: >-
            ^https:\/\/(github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|gitlab\.com\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)(\/|\.git)?$
          type: string
      required:
        - type
        - name
        - url
        - ref
        - description
      type: object
    ConfiguredSkill:
      additionalProperties: false
      properties:
        manifest:
          $ref: '#/components/schemas/SkillManifest'
        name:
          $ref: '#/components/schemas/ResourceName'
      required:
        - name
        - manifest
      type: object
    ResourceName:
      maxLength: 64
      minLength: 2
      pattern: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$
      type: string
    SkillType:
      enum:
        - git
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
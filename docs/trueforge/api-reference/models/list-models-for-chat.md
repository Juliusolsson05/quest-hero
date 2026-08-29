> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# List models for chat

> Configured models as a slim FQN list for the composer.



## OpenAPI

````yaml /openapi.json get /api/v1/models
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
  /api/v1/models:
    get:
      tags:
        - Models
      summary: List models for chat
      description: Configured models as a slim FQN list for the composer.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListAvailableModelsResponse'
          description: All configured models (chat projection).
        '401':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: OIDC is configured and the request has no valid session cookie.
components:
  schemas:
    ListAvailableModelsResponse:
      properties:
        data:
          items:
            $ref: '#/components/schemas/AvailableModel'
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
    AvailableModel:
      additionalProperties: false
      properties:
        model_id:
          description: Upstream, provider-specific identifier sent to the provider API.
          type: string
        name:
          description: >-
            Fully qualified name `provider_name/model_name`, e.g.
            "openai/gpt-5-6-sol". Unique within a tenant.
          type: string
        properties:
          $ref: '#/components/schemas/ModelProperties'
        provider:
          $ref: '#/components/schemas/AvailableModelProvider'
      required:
        - name
        - model_id
        - provider
        - properties
      type: object
    ModelProperties:
      additionalProperties: false
      description: Optional model capability metadata.
      properties:
        context_length:
          description: Maximum context window size in tokens.
          exclusiveMinimum: 0
          type: integer
        max_output_tokens:
          description: Maximum output tokens the model can generate.
          exclusiveMinimum: 0
          type: integer
        reasoning_efforts:
          description: Supported reasoning-effort values for this model.
          items:
            $ref: '#/components/schemas/ReasoningEffort'
          minItems: 1
          type: array
      type: object
    AvailableModelProvider:
      additionalProperties: false
      description: Owning configured provider.
      properties:
        name:
          description: Configured provider resource name; matches the FQN prefix of `name`.
          minLength: 1
          type: string
      required:
        - name
      type: object
    ReasoningEffort:
      enum:
        - none
        - minimal
        - low
        - medium
        - high
        - xhigh
        - max
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
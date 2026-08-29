> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Get the model catalog

> Shipped model-provider presets (discovery-only). Copy into PUT /settings/model-providers to configure. Includes a `custom` sentinel with `supported_reasoning_efforts`.



## OpenAPI

````yaml /openapi.json get /api/v1/catalogs/model-providers
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
  /api/v1/catalogs/model-providers:
    get:
      tags:
        - Models
      summary: Get the model catalog
      description: >-
        Shipped model-provider presets (discovery-only). Copy into PUT
        /settings/model-providers to configure. Includes a `custom` sentinel
        with `supported_reasoning_efforts`.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetModelProviderCatalogResponse'
          description: Shipped model-provider presets.
        '401':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: Not authenticated.
components:
  schemas:
    GetModelProviderCatalogResponse:
      properties:
        data:
          items:
            $ref: '#/components/schemas/CatalogModelProvider'
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
    CatalogModelProvider:
      anyOf:
        - $ref: '#/components/schemas/CatalogWellKnownModelProvider'
        - $ref: '#/components/schemas/CatalogCustomModelProvider'
    CatalogWellKnownModelProvider:
      additionalProperties: false
      properties:
        logo:
          description: URL of the provider logo asset
          format: uri
          type: string
        models:
          description: Preset models
          items:
            $ref: '#/components/schemas/CatalogModel'
          type: array
        type:
          $ref: '#/components/schemas/CatalogWellKnownModelProviderType'
      required:
        - type
        - models
      type: object
    CatalogCustomModelProvider:
      additionalProperties: false
      properties:
        supported_reasoning_efforts:
          description: Supported reasoning-effort values for this provider
          items:
            $ref: '#/components/schemas/ReasoningEffort'
          type: array
        type:
          enum:
            - custom
          type: string
      required:
        - type
        - supported_reasoning_efforts
      type: object
    CatalogModel:
      additionalProperties: false
      properties:
        model_id:
          description: Upstream, provider-specific identifier sent to the provider API.
          minLength: 1
          type: string
        name:
          $ref: '#/components/schemas/ResourceName'
        properties:
          $ref: '#/components/schemas/ModelProperties'
      required:
        - model_id
        - name
        - properties
      type: object
    CatalogWellKnownModelProviderType:
      enum:
        - openai
        - anthropic
        - google-gemini
        - fireworks
        - zai
        - moonshot
        - alibaba
        - together
      type: string
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
    ResourceName:
      maxLength: 64
      minLength: 2
      pattern: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$
      type: string
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
  securitySchemes:
    BearerAuth:
      bearerFormat: JWT
      description: >-
        ID token (`Authorization: Bearer <id_token>`). Required on protected
        routes. Browser sessions may use the HttpOnly `id_token` cookie instead.
      scheme: bearer
      type: http

````
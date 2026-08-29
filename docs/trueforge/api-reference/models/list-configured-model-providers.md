> ## Documentation Index
> Fetch the complete documentation index at: https://trueforge.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# List configured model providers

> All configured providers with nested manifests.



## OpenAPI

````yaml /openapi.json get /api/v1/settings/model-providers
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
  /api/v1/settings/model-providers:
    get:
      tags:
        - Models
      summary: List configured model providers
      description: All configured providers with nested manifests.
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListModelProvidersResponse'
          description: All configured model providers
        '401':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: OIDC is configured and the request has no valid session cookie.
        '403':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestErrorResponse'
          description: OIDC is configured and the caller is authenticated but not an admin.
components:
  schemas:
    ListModelProvidersResponse:
      properties:
        data:
          items:
            $ref: '#/components/schemas/ConfiguredModelProvider'
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
    ConfiguredModelProvider:
      additionalProperties: false
      properties:
        manifest:
          $ref: '#/components/schemas/ModelProviderManifest'
        name:
          $ref: '#/components/schemas/ResourceName'
      required:
        - name
        - manifest
      type: object
    ModelProviderManifest:
      discriminator:
        mapping:
          alibaba:
            $ref: '#/components/schemas/AlibabaModelProvider'
          anthropic:
            $ref: '#/components/schemas/AnthropicModelProvider'
          custom:
            $ref: '#/components/schemas/CustomModelProvider'
          fireworks:
            $ref: '#/components/schemas/FireworksModelProvider'
          google-gemini:
            $ref: '#/components/schemas/GoogleGeminiModelProvider'
          moonshot:
            $ref: '#/components/schemas/MoonshotModelProvider'
          openai:
            $ref: '#/components/schemas/OpenAIModelProvider'
          together:
            $ref: '#/components/schemas/TogetherAIModelProvider'
          zai:
            $ref: '#/components/schemas/ZaiModelProvider'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/OpenAIModelProvider'
        - $ref: '#/components/schemas/AnthropicModelProvider'
        - $ref: '#/components/schemas/GoogleGeminiModelProvider'
        - $ref: '#/components/schemas/FireworksModelProvider'
        - $ref: '#/components/schemas/ZaiModelProvider'
        - $ref: '#/components/schemas/MoonshotModelProvider'
        - $ref: '#/components/schemas/TogetherAIModelProvider'
        - $ref: '#/components/schemas/AlibabaModelProvider'
        - $ref: '#/components/schemas/CustomModelProvider'
    ResourceName:
      maxLength: 64
      minLength: 2
      pattern: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$
      type: string
    AlibabaModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          default: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
          description: Override of the provider's default API base URL.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        type:
          enum:
            - alibaba
          type: string
      required:
        - auth
        - models
        - type
      type: object
    AnthropicModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          default: https://api.anthropic.com/v1
          description: Override of the provider's default API base URL.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        type:
          enum:
            - anthropic
          type: string
      required:
        - auth
        - models
        - type
      type: object
    CustomModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          description: Base URL of the provider's API.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        name:
          $ref: '#/components/schemas/ResourceName'
        type:
          enum:
            - custom
          type: string
      required:
        - models
        - type
        - name
        - base_url
      type: object
    FireworksModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          default: https://api.fireworks.ai/inference/v1
          description: Override of the provider's default API base URL.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        type:
          enum:
            - fireworks
          type: string
      required:
        - auth
        - models
        - type
      type: object
    GoogleGeminiModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          default: https://generativelanguage.googleapis.com/v1beta
          description: Override of the provider's default API base URL.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        type:
          enum:
            - google-gemini
          type: string
      required:
        - auth
        - models
        - type
      type: object
    MoonshotModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          default: https://api.moonshot.ai/v1
          description: Override of the provider's default API base URL.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        type:
          enum:
            - moonshot
          type: string
      required:
        - auth
        - models
        - type
      type: object
    OpenAIModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          default: https://api.openai.com/v1
          description: Override of the provider's default API base URL.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        type:
          enum:
            - openai
          type: string
      required:
        - auth
        - models
        - type
      type: object
    TogetherAIModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          default: https://api.together.xyz/v1
          description: Override of the provider's default API base URL.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        type:
          enum:
            - together
          type: string
      required:
        - auth
        - models
        - type
      type: object
    ZaiModelProvider:
      additionalProperties: false
      properties:
        auth:
          $ref: '#/components/schemas/ModelProviderAuth'
        base_url:
          default: https://api.z.ai/api/paas/v4
          description: Override of the provider's default API base URL.
          format: uri
          type: string
        models:
          description: Models exposed by this provider (at least one).
          items:
            $ref: '#/components/schemas/ConfiguredModel'
          minItems: 1
          type: array
        type:
          enum:
            - zai
          type: string
      required:
        - auth
        - models
        - type
      type: object
    ModelProviderAuth:
      additionalProperties: false
      description: Provider authentication credentials.
      properties:
        api_key:
          description: >-
            Provider API key. Responses are redacted; on PUT, a real value
            sets/rotates and a redacted value keeps the stored key.
          minLength: 1
          type: string
      required:
        - api_key
      type: object
    ConfiguredModel:
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
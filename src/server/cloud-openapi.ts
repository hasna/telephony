// ---------------------------------------------------------------------------
// OpenAPI document — source of truth for the generated SDK.
// ---------------------------------------------------------------------------

export function telephonyOpenApi(version: string): Record<string, unknown> {
  const listResponse = (ref: string) => ({
    type: "object",
    properties: {
      items: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
      total: { type: "integer" },
    },
    required: ["items", "total"],
  });
  const contact = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      phone: { type: "string" },
      email: { type: "string", nullable: true },
      agent_id: { type: "string", nullable: true },
      project_id: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
    required: ["id", "name", "phone", "tags", "metadata", "created_at", "updated_at"],
  };
  const str = { type: "string" };
  const strN = { type: "string", nullable: true };
  const intN = { type: "integer", nullable: true };
  const obj = { type: "object", additionalProperties: true };
  const project = {
    type: "object",
    properties: {
      id: str,
      name: str,
      path: str,
      description: strN,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "path", "created_at", "updated_at"],
  };
  const agent = {
    type: "object",
    properties: {
      id: str,
      name: str,
      description: strN,
      session_id: strN,
      project_id: strN,
      capabilities: { type: "array", items: str },
      permissions: { type: "array", items: str },
      status: str,
      metadata: obj,
      last_seen_at: str,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "status", "created_at", "updated_at"],
  };
  const schedule = {
    type: "object",
    properties: {
      id: str,
      name: str,
      cron_expression: str,
      action: str,
      command: str,
      parameters: obj,
      agent_id: strN,
      project_id: strN,
      enabled: { type: "boolean" },
      last_run: strN,
      next_run: strN,
      run_count: { type: "integer" },
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "cron_expression", "action", "command", "created_at", "updated_at"],
  };
  const webhook = {
    type: "object",
    properties: {
      id: str,
      url: str,
      events: { type: "array", items: str },
      secret_configured: { type: "boolean" },
      active: { type: "boolean" },
      created_at: str,
    },
    required: ["id", "url", "events", "secret_configured", "active", "created_at"],
  };
  const phoneNumber = {
    type: "object",
    properties: {
      id: str,
      number: str,
      country: str,
      capabilities: { type: "array", items: str },
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      friendly_name: strN,
      status: str,
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "number", "status", "created_at", "updated_at"],
  };
  const message = {
    type: "object",
    properties: {
      id: str,
      type: str,
      from_number: str,
      to_number: str,
      body: strN,
      media_url: strN,
      status: str,
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      error_message: strN,
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "type", "from_number", "to_number", "status", "created_at", "updated_at"],
  };
  const call = {
    type: "object",
    properties: {
      id: str,
      direction: str,
      from_number: str,
      to_number: str,
      status: str,
      duration: intN,
      recording_url: strN,
      transcription: strN,
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      metadata: obj,
      started_at: str,
      ended_at: strN,
      created_at: str,
    },
    required: ["id", "direction", "from_number", "to_number", "status", "started_at", "created_at"],
  };
  const voicemail = {
    type: "object",
    properties: {
      id: str,
      call_id: strN,
      from_number: str,
      to_number: str,
      recording_url: strN,
      local_path: strN,
      transcription: strN,
      duration: intN,
      listened: { type: "boolean" },
      agent_id: strN,
      project_id: strN,
      created_at: str,
    },
    required: ["id", "from_number", "to_number", "listened", "created_at"],
  };
  return {
    openapi: "3.0.3",
    info: { title: "Telephony", version, description: "@hasna/telephony self-hosted HTTP API" },
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        Contact: contact,
        ContactInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string", nullable: true },
            agent_id: { type: "string", nullable: true },
            project_id: { type: "string", nullable: true },
            notes: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object", additionalProperties: true },
          },
          required: ["name", "phone"],
        },
        ContactPatch: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string", nullable: true },
            notes: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        ContactList: listResponse("Contact"),
        Project: project,
        ProjectInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            path: { type: "string" },
            description: { type: "string", nullable: true },
          },
          required: ["name", "path"],
        },
        ProjectList: listResponse("Project"),
        Agent: agent,
        AgentInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string", nullable: true },
            session_id: { type: "string", nullable: true },
            project_id: { type: "string", nullable: true },
            capabilities: { type: "array", items: { type: "string" } },
            permissions: { type: "array", items: { type: "string" } },
            force: { type: "boolean", description: "Force takeover of a name held by another session" },
          },
          required: ["name"],
        },
        AgentList: listResponse("Agent"),
        Schedule: schedule,
        ScheduleInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            cron_expression: { type: "string" },
            command: { type: "string" },
            action: { type: "string" },
            parameters: { type: "object", additionalProperties: true },
          },
          required: ["name", "cron_expression", "command"],
        },
        ScheduleList: listResponse("Schedule"),
        Webhook: webhook,
        WebhookInput: {
          type: "object",
          properties: {
            url: { type: "string" },
            events: { type: "array", items: { type: "string" } },
            secret: { type: "string", nullable: true },
          },
          required: ["url"],
        },
        WebhookList: listResponse("Webhook"),
        PhoneNumber: phoneNumber,
        PhoneNumberList: listResponse("PhoneNumber"),
        Message: message,
        MessageList: listResponse("Message"),
        Call: call,
        CallList: listResponse("Call"),
        Voicemail: voicemail,
        VoicemailList: listResponse("Voicemail"),
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/contacts": {
        get: {
          operationId: "listContacts",
          summary: "List contacts",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ContactList" } } } },
          },
        },
        post: {
          operationId: "createContact",
          summary: "Create a contact",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContactInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
      },
      "/v1/contacts/{id}": {
        get: {
          operationId: "getContact",
          summary: "Fetch a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
        patch: {
          operationId: "updateContact",
          summary: "Update a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContactPatch" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
        delete: {
          operationId: "deleteContact",
          summary: "Delete a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} },
        },
      },
      "/v1/projects": {
        get: {
          operationId: "listProjects",
          summary: "List projects",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectList" } } } },
          },
        },
        post: {
          operationId: "createProject",
          summary: "Create a project",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } },
          },
        },
      },
      "/v1/projects/{id}": {
        get: {
          operationId: "getProject",
          summary: "Fetch a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } },
          },
        },
        delete: {
          operationId: "deleteProject",
          summary: "Delete a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} },
        },
      },
      "/v1/agents": {
        get: {
          operationId: "listAgents",
          summary: "List agents",
          parameters: [
            { name: "agent_id", in: "query", schema: { type: "string" }, description: "Exact agent id" },
            { name: "project_id", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/AgentList" } } } },
          },
        },
        post: {
          operationId: "registerAgent",
          summary: "Register an agent",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AgentInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } } },
          },
        },
      },
      "/v1/numbers": {
        get: {
          operationId: "listNumbers",
          summary: "List phone numbers",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "number", in: "query", schema: { type: "string" }, description: "Exact E.164 number lookup" },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/PhoneNumberList" } } } },
          },
        },
      },
      "/v1/numbers/available": {
        get: {
          operationId: "searchAvailableNumbers",
          summary: "Search available phone numbers to buy (server-side Twilio proxy)",
          description:
            "Live passthrough to Twilio using the server's credential. Returns 501 when the server has no Twilio credential configured, 502 on an upstream Twilio error.",
          parameters: [
            { name: "country", in: "query", schema: { type: "string" }, description: "ISO country code (default US)" },
            { name: "area_code", in: "query", schema: { type: "string" } },
            { name: "contains", in: "query", schema: { type: "string" } },
            { name: "sms_enabled", in: "query", schema: { type: "boolean" } },
            { name: "voice_enabled", in: "query", schema: { type: "boolean" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            phoneNumber: { type: "string" },
                            friendlyName: { type: "string" },
                            locality: { type: "string" },
                            region: { type: "string" },
                            capabilities: {
                              type: "object",
                              properties: { voice: { type: "boolean" }, sms: { type: "boolean" }, mms: { type: "boolean" } },
                            },
                          },
                        },
                      },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/numbers/twilio": {
        get: {
          operationId: "listTwilioNumbers",
          summary: "List numbers owned in the Twilio account (server-side Twilio proxy)",
          description:
            "Live passthrough to Twilio using the server's credential. Returns 501 when the server has no Twilio credential configured, 502 on an upstream Twilio error.",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            sid: { type: "string" },
                            phoneNumber: { type: "string" },
                            friendlyName: { type: "string" },
                          },
                        },
                      },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/voices": {
        get: {
          operationId: "listVoices",
          summary: "List available TTS voices (server-side ElevenLabs proxy)",
          description:
            "Live passthrough to ElevenLabs using the server's credential. Returns 501 when the server has no ElevenLabs credential configured, 502 on an upstream ElevenLabs error.",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            voice_id: { type: "string" },
                            name: { type: "string" },
                            category: { type: "string" },
                            description: { type: "string" },
                          },
                        },
                      },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/messages": {
        get: {
          operationId: "listMessages",
          summary: "List messages",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "search", in: "query", schema: { type: "string" }, description: "Case-insensitive substring match over message body" },
            { name: "number", in: "query", schema: { type: "string" }, description: "Conversation filter: messages to or from this number" },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/MessageList" } } } },
          },
        },
      },
      "/v1/calls": {
        get: {
          operationId: "listCalls",
          summary: "List calls",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/CallList" } } } },
          },
        },
      },
      "/v1/voicemails": {
        get: {
          operationId: "listVoicemails",
          summary: "List voicemails",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "listened", in: "query", schema: { type: "boolean" }, description: "Filter by listened state (false => unheard only)" },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/VoicemailList" } } } },
          },
        },
      },
      "/v1/agents/{id}": {
        get: {
          operationId: "getAgent",
          summary: "Fetch an agent by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } } },
          },
        },
      },
      "/v1/schedules": {
        get: {
          operationId: "listSchedules",
          summary: "List schedules",
          parameters: [
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "enabled", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ScheduleList" } } } },
          },
        },
        post: {
          operationId: "createSchedule",
          summary: "Create a schedule",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ScheduleInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Schedule" } } } },
          },
        },
      },
      "/v1/webhooks": {
        get: {
          operationId: "listWebhooks",
          summary: "List webhooks",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookList" } } } },
          },
        },
        post: {
          operationId: "createWebhook",
          summary: "Create a webhook",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Webhook" } } } },
          },
        },
      },
    },
  };
}


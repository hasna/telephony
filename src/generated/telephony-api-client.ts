// @generated from the telephony-serve OpenAPI document by scripts/generate-sdk.mjs.
// DO NOT EDIT. Regenerate: bun scripts/generate-sdk.mjs

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Telephony 0.2.5

export interface Contact { "id": string; "name": string; "phone": string; "email"?: string | null; "agent_id"?: string | null; "project_id"?: string | null; "notes"?: string | null; "tags": Array<string>; "metadata": Record<string, unknown>; "created_at": string; "updated_at": string }

export interface ContactInput { "name": string; "phone": string; "email"?: string | null; "agent_id"?: string | null; "project_id"?: string | null; "notes"?: string | null; "tags"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface ContactPatch { "name"?: string; "phone"?: string; "email"?: string | null; "notes"?: string | null; "tags"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface ContactList { "items": Array<Contact>; "total": number }

export interface Project { "id": string; "name": string; "path": string; "description"?: string | null; "created_at": string; "updated_at": string }

export interface ProjectInput { "name": string; "path": string; "description"?: string | null }

export interface ProjectList { "items": Array<Project>; "total": number }

export interface Agent { "id": string; "name": string; "description"?: string | null; "session_id"?: string | null; "project_id"?: string | null; "capabilities"?: Array<string>; "permissions"?: Array<string>; "status": string; "metadata"?: Record<string, unknown>; "last_seen_at"?: string; "created_at": string; "updated_at": string }

export interface AgentInput { "name": string; "description"?: string | null; "session_id"?: string | null; "project_id"?: string | null; "capabilities"?: Array<string>; "permissions"?: Array<string>; "force"?: boolean }

export interface AgentList { "items": Array<Agent>; "total": number }

export interface Schedule { "id": string; "name": string; "cron_expression": string; "action": string; "command": string; "parameters"?: Record<string, unknown>; "agent_id"?: string | null; "project_id"?: string | null; "enabled"?: boolean; "last_run"?: string | null; "next_run"?: string | null; "run_count"?: number; "metadata"?: Record<string, unknown>; "created_at": string; "updated_at": string }

export interface ScheduleInput { "name": string; "cron_expression": string; "command": string; "action"?: string; "parameters"?: Record<string, unknown> }

export interface ScheduleList { "items": Array<Schedule>; "total": number }

export interface Webhook { "id": string; "url": string; "events": Array<string>; "secret"?: string | null; "active": boolean; "created_at": string }

export interface WebhookInput { "url": string; "events"?: Array<string>; "secret"?: string | null }

export interface WebhookList { "items": Array<Webhook>; "total": number }

export interface PhoneNumber { "id": string; "number": string; "country"?: string; "capabilities"?: Array<string>; "agent_id"?: string | null; "project_id"?: string | null; "twilio_sid"?: string | null; "friendly_name"?: string | null; "status": string; "metadata"?: Record<string, unknown>; "created_at": string; "updated_at": string }

export interface PhoneNumberList { "items": Array<PhoneNumber>; "total": number }

export interface Message { "id": string; "type": string; "from_number": string; "to_number": string; "body"?: string | null; "media_url"?: string | null; "status": string; "agent_id"?: string | null; "project_id"?: string | null; "twilio_sid"?: string | null; "error_message"?: string | null; "metadata"?: Record<string, unknown>; "created_at": string; "updated_at": string }

export interface MessageList { "items": Array<Message>; "total": number }

export interface Call { "id": string; "direction": string; "from_number": string; "to_number": string; "status": string; "duration"?: number | null; "recording_url"?: string | null; "transcription"?: string | null; "agent_id"?: string | null; "project_id"?: string | null; "twilio_sid"?: string | null; "metadata"?: Record<string, unknown>; "started_at": string; "ended_at"?: string | null; "created_at": string }

export interface CallList { "items": Array<Call>; "total": number }

export interface Voicemail { "id": string; "call_id"?: string | null; "from_number": string; "to_number": string; "recording_url"?: string | null; "local_path"?: string | null; "transcription"?: string | null; "duration"?: number | null; "listened": boolean; "agent_id"?: string | null; "project_id"?: string | null; "created_at": string }

export interface VoicemailList { "items": Array<Voicemail>; "total": number }

export interface TelephonyApiClientOptions {
  /** Base URL, e.g. process.env.APP_API_URL. */
  baseUrl: string;
  /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class TelephonyApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: TelephonyApiClientOptions) {
    if (!options.baseUrl) throw new Error("TelephonyApiClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseHeaders = options.headers ?? {};
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders, ...(opts.init?.headers as Record<string, string> | undefined) };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let payload: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    const response = await this.fetchImpl(url.toString(), { ...opts.init, method, headers, body: payload });
    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, data);
    }
    return data as T;
  }

    /** List agents */
    async listAgents(query?: { "agent_id"?: string; "project_id"?: string }, init?: RequestInit): Promise<AgentList> {
      return this.request("GET", `/v1/agents`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Register an agent */
    async registerAgent(body: AgentInput, init?: RequestInit): Promise<Agent> {
      return this.request("POST", `/v1/agents`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Fetch an agent by id */
    async getAgent(id: string, init?: RequestInit): Promise<Agent> {
      return this.request("GET", `/v1/agents/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List calls */
    async listCalls(query?: { "limit"?: number }, init?: RequestInit): Promise<CallList> {
      return this.request("GET", `/v1/calls`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List contacts */
    async listContacts(query?: { "limit"?: number; "offset"?: number; "search"?: string; "agent_id"?: string; "project_id"?: string }, init?: RequestInit): Promise<ContactList> {
      return this.request("GET", `/v1/contacts`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a contact */
    async createContact(body: ContactInput, init?: RequestInit): Promise<Contact> {
      return this.request("POST", `/v1/contacts`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Fetch a contact */
    async getContact(id: string, init?: RequestInit): Promise<Contact> {
      return this.request("GET", `/v1/contacts/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a contact */
    async deleteContact(id: string, init?: RequestInit): Promise<void> {
      return this.request("DELETE", `/v1/contacts/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update a contact */
    async updateContact(id: string, body: ContactPatch, init?: RequestInit): Promise<Contact> {
      return this.request("PATCH", `/v1/contacts/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List messages */
    async listMessages(query?: { "limit"?: number; "agent_id"?: string; "project_id"?: string; "type"?: string; "search"?: string; "number"?: string }, init?: RequestInit): Promise<MessageList> {
      return this.request("GET", `/v1/messages`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List phone numbers */
    async listNumbers(query?: { "limit"?: number; "agent_id"?: string; "project_id"?: string; "status"?: string; "number"?: string }, init?: RequestInit): Promise<PhoneNumberList> {
      return this.request("GET", `/v1/numbers`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Search available phone numbers to buy (server-side Twilio proxy) */
    async searchAvailableNumbers(query?: { "country"?: string; "area_code"?: string; "contains"?: string; "sms_enabled"?: boolean; "voice_enabled"?: boolean; "limit"?: number }, init?: RequestInit): Promise<{ "items"?: Array<{ "phoneNumber"?: string; "friendlyName"?: string; "locality"?: string; "region"?: string; "capabilities"?: { "voice"?: boolean; "sms"?: boolean; "mms"?: boolean } }>; "total"?: number }> {
      return this.request("GET", `/v1/numbers/available`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List numbers owned in the Twilio account (server-side Twilio proxy) */
    async listTwilioNumbers(init?: RequestInit): Promise<{ "items"?: Array<{ "sid"?: string; "phoneNumber"?: string; "friendlyName"?: string }>; "total"?: number }> {
      return this.request("GET", `/v1/numbers/twilio`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List projects */
    async listProjects(init?: RequestInit): Promise<ProjectList> {
      return this.request("GET", `/v1/projects`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a project */
    async createProject(body: ProjectInput, init?: RequestInit): Promise<Project> {
      return this.request("POST", `/v1/projects`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Fetch a project */
    async getProject(id: string, init?: RequestInit): Promise<Project> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a project */
    async deleteProject(id: string, init?: RequestInit): Promise<void> {
      return this.request("DELETE", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List schedules */
    async listSchedules(query?: { "agent_id"?: string; "project_id"?: string; "enabled"?: boolean }, init?: RequestInit): Promise<ScheduleList> {
      return this.request("GET", `/v1/schedules`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a schedule */
    async createSchedule(body: ScheduleInput, init?: RequestInit): Promise<Schedule> {
      return this.request("POST", `/v1/schedules`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List voicemails */
    async listVoicemails(query?: { "limit"?: number; "agent_id"?: string; "project_id"?: string; "listened"?: boolean }, init?: RequestInit): Promise<VoicemailList> {
      return this.request("GET", `/v1/voicemails`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List available TTS voices (server-side ElevenLabs proxy) */
    async listVoices(init?: RequestInit): Promise<{ "items"?: Array<{ "voice_id"?: string; "name"?: string; "category"?: string; "description"?: string }>; "total"?: number }> {
      return this.request("GET", `/v1/voices`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List webhooks */
    async listWebhooks(init?: RequestInit): Promise<WebhookList> {
      return this.request("GET", `/v1/webhooks`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a webhook */
    async createWebhook(body: WebhookInput, init?: RequestInit): Promise<Webhook> {
      return this.request("POST", `/v1/webhooks`, {
        body,
        query: undefined,
        init,
      });
    }
}

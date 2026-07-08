// ── The telephony Store abstraction ──────────────────────────────────────────
//
// ONE interface, TWO transports. Every CLI command, MCP tool, and SDK caller
// that reads or writes telephony DATA goes through `TelephonyStore`. There are
// exactly two implementations:
//
//   • LocalStore — on-box SQLite. Delegates to the query/mutation helpers in
//     ../../db/*. The database handle opens lazily on first use, so `local` is
//     first-class and fully functional; cloud mode never touches sqlite.
//   • ApiStore   — the self_hosted/cloud HTTP API at `<API_URL>/v1` with a
//     bearer key. Delegates to the vendored client-flip HTTP storage client.
//
// `getStore()` resolves which transport to use from the client-flip env
// (HASNA_TELEPHONY_API_URL + HASNA_TELEPHONY_API_KEY / HASNA_TELEPHONY_STORAGE_MODE).
// Callers NEVER branch on mode themselves and NEVER touch sqlite or fetch
// directly — that was the split-brain bug this module eliminates.
//
// `self_hosted` and `cloud` are the SAME client code (ApiStore); only the URL and
// key differ, and that distinction is server-side tenancy.
//
// SAFETY: the API key never leaves the transport; it is never logged, returned,
// or embedded in any value produced here. Only the HTTP transport ever holds it.
// There is NO database DSN on the client — the cloud transport is HTTP + key only.

import {
  resolveStorageClient,
  type Env,
  type HasnaStorageClient,
} from "../../generated/storage-client/index.js";

import * as dbAgents from "../../db/agents.js";
import * as dbProjects from "../../db/projects.js";
import * as dbNumbers from "../../db/phone-numbers.js";
import * as dbMessages from "../../db/messages.js";
import * as dbCalls from "../../db/calls.js";
import * as dbVoicemails from "../../db/voicemails.js";
import * as dbContacts from "../../db/contacts.js";
import * as dbSchedules from "../../db/schedules.js";
import * as dbWebhooks from "../../db/webhooks.js";
import { getDatabase } from "../../db/database.js";

import type {
  Agent,
  AgentConflictError,
  Call,
  CallDirection,
  CallStatus,
  Contact,
  CreateContactInput,
  CreateProjectInput,
  CreateScheduleInput,
  CreateWebhookInput,
  Message,
  MessageStatus,
  MessageType,
  PhoneNumber,
  PhoneNumberCapability,
  Project,
  RegisterAgentInput,
  Schedule,
  Voicemail,
  Webhook,
} from "../../types/index.js";

export const TELEPHONY_APP = "telephony";

// ── Input shapes (mirror the db/* create signatures) ─────────────────────────

export interface CreateMessageInput {
  type: MessageType;
  from_number: string;
  to_number: string;
  body?: string;
  media_url?: string;
  status?: MessageStatus;
  agent_id?: string;
  project_id?: string;
  twilio_sid?: string;
}

export interface CreateCallInput {
  direction: CallDirection;
  from_number: string;
  to_number: string;
  agent_id?: string;
  project_id?: string;
  twilio_sid?: string;
}

export interface CreateVoicemailInput {
  call_id?: string;
  from_number: string;
  to_number: string;
  recording_url?: string;
  local_path?: string;
  transcription?: string;
  duration?: number;
  agent_id?: string;
  project_id?: string;
}

export interface CreatePhoneNumberInput {
  number: string;
  country?: string;
  capabilities?: PhoneNumberCapability[];
  agent_id?: string;
  project_id?: string;
  twilio_sid?: string;
  friendly_name?: string;
}

export interface FeedbackInput {
  message: string;
  email?: string;
  category?: string;
  version: string;
}

export interface MessageFilters {
  agent_id?: string;
  project_id?: string;
  type?: MessageType;
  limit?: number;
}

export interface CallFilters {
  agent_id?: string;
  project_id?: string;
  limit?: number;
}

export interface VoicemailFilters {
  agent_id?: string;
  project_id?: string;
  listened?: boolean;
}

export interface ScheduleFilters {
  agent_id?: string;
  project_id?: string;
  enabled?: boolean;
}

// ── The Store interface ──────────────────────────────────────────────────────

export interface TelephonyStore {
  /** Which transport backs this store (banners/diagnostics only). */
  readonly transport: "local" | "cloud-http";

  // Agents
  registerAgent(input: RegisterAgentInput): Promise<Agent | AgentConflictError>;
  listAgents(projectId?: string): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | null>;
  getAgentByName(name: string): Promise<Agent | null>;
  heartbeat(agentId: string): Promise<Agent | null>;
  releaseAgent(agentId: string): Promise<boolean>;
  setFocus(agentName: string, projectId: string): Promise<boolean>;

  // Projects
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  deleteProject(id: string): Promise<boolean>;

  // Phone numbers
  listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }): Promise<PhoneNumber[]>;
  getPhoneNumberByNumber(number: string): Promise<PhoneNumber | null>;
  createPhoneNumber(input: CreatePhoneNumberInput): Promise<PhoneNumber>;
  assignPhoneNumber(id: string, agentId?: string, projectId?: string): Promise<PhoneNumber | null>;
  releasePhoneNumber(id: string): Promise<boolean>;

  // Messages
  createMessage(input: CreateMessageInput): Promise<Message>;
  updateMessageStatus(id: string, status: MessageStatus, errorMessage?: string): Promise<void>;
  listMessages(filters?: MessageFilters): Promise<Message[]>;
  searchMessages(query: string, limit?: number): Promise<Message[]>;
  getConversation(phoneNumber: string, limit?: number): Promise<Message[]>;

  // Calls
  createCall(input: CreateCallInput): Promise<Call>;
  updateCallStatus(
    id: string,
    status: CallStatus,
    extra?: { duration?: number; recording_url?: string; transcription?: string },
  ): Promise<void>;
  listCalls(filters?: CallFilters): Promise<Call[]>;

  // Voicemails
  createVoicemail(input: CreateVoicemailInput): Promise<Voicemail>;
  listVoicemails(filters?: VoicemailFilters): Promise<Voicemail[]>;
  markVoicemailListened(id: string): Promise<boolean>;

  // Contacts
  createContact(input: CreateContactInput): Promise<Contact>;
  listContacts(filters?: { agent_id?: string; project_id?: string }): Promise<Contact[]>;
  searchContacts(query: string): Promise<Contact[]>;
  deleteContact(id: string): Promise<boolean>;

  // Schedules
  createSchedule(input: CreateScheduleInput): Promise<Schedule>;
  listSchedules(filters?: ScheduleFilters): Promise<Schedule[]>;
  enableSchedule(id: string): Promise<boolean>;
  disableSchedule(id: string): Promise<boolean>;
  deleteSchedule(id: string): Promise<boolean>;
  getDueSchedules(): Promise<Schedule[]>;
  markScheduleRun(id: string): Promise<void>;

  // Webhooks
  createWebhook(input: CreateWebhookInput): Promise<Webhook>;
  listWebhooks(): Promise<Webhook[]>;
  deleteWebhook(id: string): Promise<boolean>;

  // Feedback
  saveFeedback(input: FeedbackInput): Promise<void>;
}

// ── LocalStore (on-box SQLite) ───────────────────────────────────────────────

export class LocalStore implements TelephonyStore {
  readonly transport = "local" as const;

  // Agents
  async registerAgent(input: RegisterAgentInput) {
    return dbAgents.registerAgent(input);
  }
  async listAgents(projectId?: string) {
    return dbAgents.listAgents(projectId);
  }
  async getAgent(id: string) {
    return dbAgents.getAgent(id);
  }
  async getAgentByName(name: string) {
    return dbAgents.getAgentByName(name);
  }
  async heartbeat(agentId: string) {
    return dbAgents.heartbeat(agentId);
  }
  async releaseAgent(agentId: string) {
    return dbAgents.releaseAgent(agentId);
  }
  async setFocus(agentName: string, projectId: string) {
    const db = getDatabase();
    const res = db.run("UPDATE agents SET project_id = ?, updated_at = datetime('now') WHERE LOWER(name) = ?", [
      projectId,
      agentName.toLowerCase(),
    ]);
    return res.changes > 0;
  }

  // Projects
  async createProject(input: CreateProjectInput) {
    return dbProjects.createProject(input);
  }
  async listProjects() {
    return dbProjects.listProjects();
  }
  async getProject(id: string) {
    return dbProjects.getProject(id);
  }
  async deleteProject(id: string) {
    return dbProjects.deleteProject(id);
  }

  // Phone numbers
  async listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }) {
    return dbNumbers.listPhoneNumbers(filters);
  }
  async getPhoneNumberByNumber(number: string) {
    return dbNumbers.getPhoneNumberByNumber(number);
  }
  async createPhoneNumber(input: CreatePhoneNumberInput) {
    return dbNumbers.createPhoneNumber(input);
  }
  async assignPhoneNumber(id: string, agentId?: string, projectId?: string) {
    return dbNumbers.assignPhoneNumber(id, agentId, projectId);
  }
  async releasePhoneNumber(id: string) {
    return dbNumbers.releasePhoneNumberDb(id);
  }

  // Messages
  async createMessage(input: CreateMessageInput) {
    return dbMessages.createMessage(input);
  }
  async updateMessageStatus(id: string, status: MessageStatus, errorMessage?: string) {
    dbMessages.updateMessageStatus(id, status, errorMessage);
  }
  async listMessages(filters?: MessageFilters) {
    return dbMessages.listMessages(filters);
  }
  async searchMessages(query: string, limit?: number) {
    return dbMessages.searchMessages(query, limit);
  }
  async getConversation(phoneNumber: string, limit?: number) {
    return dbMessages.getConversation(phoneNumber, limit);
  }

  // Calls
  async createCall(input: CreateCallInput) {
    return dbCalls.createCall(input);
  }
  async updateCallStatus(
    id: string,
    status: CallStatus,
    extra?: { duration?: number; recording_url?: string; transcription?: string },
  ) {
    dbCalls.updateCallStatus(id, status, extra);
  }
  async listCalls(filters?: CallFilters) {
    return dbCalls.listCalls(filters);
  }

  // Voicemails
  async createVoicemail(input: CreateVoicemailInput) {
    return dbVoicemails.createVoicemail(input);
  }
  async listVoicemails(filters?: VoicemailFilters) {
    return dbVoicemails.listVoicemails(filters);
  }
  async markVoicemailListened(id: string) {
    return dbVoicemails.markVoicemailListened(id);
  }

  // Contacts
  async createContact(input: CreateContactInput) {
    return dbContacts.createContact(input);
  }
  async listContacts(filters?: { agent_id?: string; project_id?: string }) {
    return dbContacts.listContacts(filters);
  }
  async searchContacts(query: string) {
    return dbContacts.searchContacts(query);
  }
  async deleteContact(id: string) {
    return dbContacts.deleteContact(id);
  }

  // Schedules
  async createSchedule(input: CreateScheduleInput) {
    return dbSchedules.createSchedule(input);
  }
  async listSchedules(filters?: ScheduleFilters) {
    return dbSchedules.listSchedules(filters);
  }
  async enableSchedule(id: string) {
    return dbSchedules.enableSchedule(id);
  }
  async disableSchedule(id: string) {
    return dbSchedules.disableSchedule(id);
  }
  async deleteSchedule(id: string) {
    return dbSchedules.deleteSchedule(id);
  }
  async getDueSchedules() {
    return dbSchedules.getDueSchedules();
  }
  async markScheduleRun(id: string) {
    dbSchedules.markScheduleRun(id);
  }

  // Webhooks
  async createWebhook(input: CreateWebhookInput) {
    return dbWebhooks.createWebhook(input);
  }
  async listWebhooks() {
    return dbWebhooks.listWebhooks();
  }
  async deleteWebhook(id: string) {
    return dbWebhooks.deleteWebhook(id);
  }

  // Feedback
  async saveFeedback(input: FeedbackInput) {
    const db = getDatabase();
    db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(
      input.message,
      input.email || null,
      input.category || "general",
      input.version,
    );
  }
}

// ── ApiStore (self_hosted / cloud HTTP /v1) ──────────────────────────────────

/** Raised for a client op the cloud `/v1` API cannot serve. */
export class CloudUnsupportedError extends Error {
  constructor(op: string) {
    super(`telephony: '${op}' is not available against the cloud API.`);
    this.name = "CloudUnsupportedError";
  }
}

export class ApiStore implements TelephonyStore {
  readonly transport = "cloud-http" as const;
  constructor(private readonly cloud: HasnaStorageClient) {}

  private async listAll<T>(resource: string, query?: Record<string, string | number | undefined>): Promise<T[]> {
    const q: Record<string, string | number> = {};
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) q[k] = v;
      }
    }
    return (await this.cloud.list<T>(resource, { query: q })).items;
  }

  // Agents
  async registerAgent(input: RegisterAgentInput) {
    return this.cloud.create<Agent>("agents", input);
  }
  async listAgents(projectId?: string) {
    return this.listAll<Agent>("agents", { project_id: projectId });
  }
  async getAgent(id: string) {
    return this.cloud.get<Agent>("agents", id);
  }
  async getAgentByName(name: string) {
    const items = await this.listAll<Agent>("agents");
    return items.find((a) => a.name === name) ?? null;
  }
  async heartbeat(agentId: string) {
    return this.cloud.update<Agent>("agents", agentId, { status: "active" });
  }
  async releaseAgent(agentId: string) {
    await this.cloud.update<Agent>("agents", agentId, { status: "inactive" });
    return true;
  }
  async setFocus(agentName: string, projectId: string) {
    const agent = await this.getAgentByName(agentName);
    if (!agent) return false;
    await this.cloud.update<Agent>("agents", agent.id, { project_id: projectId });
    return true;
  }

  // Projects
  async createProject(input: CreateProjectInput) {
    return this.cloud.create<Project>("projects", input);
  }
  async listProjects() {
    return this.listAll<Project>("projects");
  }
  async getProject(id: string) {
    return this.cloud.get<Project>("projects", id);
  }
  async deleteProject(id: string) {
    await this.cloud.delete("projects", id);
    return true;
  }

  // Phone numbers
  async listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }) {
    return this.listAll<PhoneNumber>("numbers", filters);
  }
  async getPhoneNumberByNumber(number: string) {
    const items = await this.listAll<PhoneNumber>("numbers");
    return items.find((n) => n.number === number) ?? null;
  }
  async createPhoneNumber(input: CreatePhoneNumberInput) {
    return this.cloud.create<PhoneNumber>("numbers", input);
  }
  async assignPhoneNumber(id: string, agentId?: string, projectId?: string) {
    return this.cloud.update<PhoneNumber>("numbers", id, { agent_id: agentId ?? null, project_id: projectId ?? null });
  }
  async releasePhoneNumber(id: string) {
    await this.cloud.update<PhoneNumber>("numbers", id, { status: "released" });
    return true;
  }

  // Messages
  async createMessage(input: CreateMessageInput) {
    return this.cloud.create<Message>("messages", input);
  }
  async updateMessageStatus(id: string, status: MessageStatus, errorMessage?: string) {
    await this.cloud.update<Message>("messages", id, {
      status,
      ...(errorMessage ? { error_message: errorMessage } : {}),
    });
  }
  async listMessages(filters?: MessageFilters) {
    return this.listAll<Message>("messages", { ...filters });
  }
  async searchMessages(query: string, limit?: number) {
    const items = await this.listAll<Message>("messages", { limit: limit ?? 200 });
    const needle = query.toLowerCase();
    return items.filter((m) => (m.body ?? "").toLowerCase().includes(needle));
  }
  async getConversation(phoneNumber: string, limit?: number) {
    const items = await this.listAll<Message>("messages", { limit: limit ?? 200 });
    return items.filter((m) => m.from_number === phoneNumber || m.to_number === phoneNumber);
  }

  // Calls
  async createCall(input: CreateCallInput) {
    return this.cloud.create<Call>("calls", input);
  }
  async updateCallStatus(
    id: string,
    status: CallStatus,
    extra?: { duration?: number; recording_url?: string; transcription?: string },
  ) {
    await this.cloud.update<Call>("calls", id, { status, ...(extra ?? {}) });
  }
  async listCalls(filters?: CallFilters) {
    return this.listAll<Call>("calls", { ...filters });
  }

  // Voicemails
  async createVoicemail(input: CreateVoicemailInput) {
    return this.cloud.create<Voicemail>("voicemails", input);
  }
  async listVoicemails(filters?: VoicemailFilters) {
    const q: Record<string, string | number> = {};
    if (filters?.agent_id) q.agent_id = filters.agent_id;
    if (filters?.project_id) q.project_id = filters.project_id;
    return (await this.cloud.list<Voicemail>("voicemails", { query: q })).items;
  }
  async markVoicemailListened(id: string) {
    await this.cloud.update<Voicemail>("voicemails", id, { listened: true });
    return true;
  }

  // Contacts
  async createContact(input: CreateContactInput) {
    return this.cloud.create<Contact>("contacts", input);
  }
  async listContacts(filters?: { agent_id?: string; project_id?: string }) {
    return this.listAll<Contact>("contacts", filters);
  }
  async searchContacts(query: string) {
    return (await this.cloud.list<Contact>("contacts", { query: { search: query } })).items;
  }
  async deleteContact(id: string) {
    await this.cloud.delete("contacts", id);
    return true;
  }

  // Schedules
  async createSchedule(input: CreateScheduleInput) {
    return this.cloud.create<Schedule>("schedules", input);
  }
  async listSchedules(filters?: ScheduleFilters) {
    return this.listAll<Schedule>("schedules", { agent_id: filters?.agent_id, project_id: filters?.project_id });
  }
  async enableSchedule(id: string) {
    await this.cloud.update<Schedule>("schedules", id, { enabled: true });
    return true;
  }
  async disableSchedule(id: string) {
    await this.cloud.update<Schedule>("schedules", id, { enabled: false });
    return true;
  }
  async deleteSchedule(id: string) {
    await this.cloud.delete("schedules", id);
    return true;
  }
  async getDueSchedules() {
    // The cloud API has no "due" filter; select enabled schedules whose
    // next_run has elapsed, client-side.
    const now = Date.now();
    const all = await this.listAll<Schedule>("schedules");
    return all.filter((s) => s.enabled && (!s.next_run || Date.parse(s.next_run) <= now));
  }
  async markScheduleRun(id: string) {
    await this.cloud.update<Schedule>("schedules", id, { last_run: new Date().toISOString() });
  }

  // Webhooks
  async createWebhook(input: CreateWebhookInput) {
    return this.cloud.create<Webhook>("webhooks", input);
  }
  async listWebhooks() {
    return this.listAll<Webhook>("webhooks");
  }
  async deleteWebhook(id: string) {
    await this.cloud.delete("webhooks", id);
    return true;
  }

  // Feedback
  async saveFeedback(input: FeedbackInput) {
    await this.cloud.create("feedback", input);
  }
}

// ── Resolver ─────────────────────────────────────────────────────────────────

let cached: TelephonyStore | null = null;

/**
 * Resolve (and cache) the telephony Store from the client-flip env. Returns an
 * {@link ApiStore} when the env resolves to cloud (mode=cloud/self_hosted +
 * API_URL + API_KEY), else a {@link LocalStore}. Throws if cloud was requested
 * but is misconfigured (so callers never silently read the wrong dataset).
 */
export function getStore(env: Env = process.env): TelephonyStore {
  // Cache only the default (process.env) resolution — the hot path for CLI/MCP/
  // lib actions. An explicit env override (e.g. SDK constructor) always resolves
  // fresh so callers can target a different transport in the same process.
  const isDefaultEnv = env === process.env;
  if (isDefaultEnv && cached) return cached;
  const resolved = resolveStorageClient(TELEPHONY_APP, env);
  const store = resolved.transport === "cloud-http" ? new ApiStore(resolved.client) : new LocalStore();
  if (isDefaultEnv) cached = store;
  return store;
}

/** Reset the cached Store (tests / env changes). */
export function resetStore(): void {
  cached = null;
}

/** True when the resolved Store is the cloud HTTP transport. */
export function isCloudStore(env: Env = process.env): boolean {
  return getStore(env).transport === "cloud-http";
}

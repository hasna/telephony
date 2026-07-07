/**
 * @hasna/telephony — client storage resolver / facade.
 *
 * This is the single decision point that makes `mode=self_hosted` real for the
 * telephony CLI (and any other client caller). When the client-flip env for the
 * telephony app resolves to cloud — i.e. one of
 *
 *   HASNA_TELEPHONY_STORAGE_MODE=self_hosted   (aliases: cloud/remote/hybrid)
 *   HASNA_TELEPHONY_API_URL=https://telephony.hasna.xyz
 *   HASNA_TELEPHONY_API_KEY=hasna_telephony_...
 *
 * — every read AND write below routes to the app's cloud `/v1` HTTP API with the
 * bearer key. Otherwise it delegates to the on-box SQLite store. There is no DSN
 * on the client and no silent local drift: if cloud is requested but
 * misconfigured, `resolveStorageClient` throws.
 *
 * The functions here mirror the `db/*` module signatures the CLI already imports,
 * so wiring is a one-line import swap in `cli/index.ts` plus `await`.
 */
import { resolveStorageClient, type HasnaStorageClient } from "../generated/storage-client/index.js";
import type {
  Agent,
  AgentConflictError,
  Call,
  Contact,
  CreateContactInput,
  CreateScheduleInput,
  CreateWebhookInput,
  Message,
  MessageType,
  PhoneNumber,
  Project,
  CreateProjectInput,
  RegisterAgentInput,
  Schedule,
  Voicemail,
  Webhook,
} from "../types/index.js";

import * as localAgents from "../db/agents.js";
import * as localProjects from "../db/projects.js";
import * as localNumbers from "../db/phone-numbers.js";
import * as localMessages from "../db/messages.js";
import * as localCalls from "../db/calls.js";
import * as localVoicemails from "../db/voicemails.js";
import * as localContacts from "../db/contacts.js";
import * as localSchedules from "../db/schedules.js";
import * as localWebhooks from "../db/webhooks.js";

export const TELEPHONY_APP = "telephony";

let cached: { transport: "local"; client: null } | { transport: "cloud-http"; client: HasnaStorageClient } | null = null;

/** Resolve (and cache) the client storage transport for the telephony app. */
export function resolveTelephonyStore(): { transport: "local"; client: null } | { transport: "cloud-http"; client: HasnaStorageClient } {
  if (cached) return cached;
  cached = resolveStorageClient(TELEPHONY_APP, process.env);
  return cached;
}

/** Reset the cached resolution (tests). */
export function resetTelephonyStore(): void {
  cached = null;
}

/** True when reads/writes should go to the cloud `/v1` API. */
export function isCloud(): boolean {
  return resolveTelephonyStore().transport === "cloud-http";
}

function cloud(): HasnaStorageClient {
  const r = resolveTelephonyStore();
  if (r.transport !== "cloud-http") throw new Error("telephony: not in cloud mode");
  return r.client;
}

/** Raised for operations the cloud `/v1` API does not (yet) expose. */
export class CloudUnsupportedError extends Error {
  constructor(op: string) {
    super(
      `telephony: '${op}' is not available against the cloud API (HASNA_TELEPHONY_STORAGE_MODE=self_hosted). ` +
        `Unset HASNA_TELEPHONY_API_URL/HASNA_TELEPHONY_API_KEY to use the local store for this operation.`,
    );
    this.name = "CloudUnsupportedError";
  }
}

// ── contacts ────────────────────────────────────────────────────────────────
export async function createContact(input: CreateContactInput): Promise<Contact> {
  if (isCloud()) return cloud().create<Contact>("contacts", input);
  return localContacts.createContact(input);
}
export async function listContacts(filters?: { agent_id?: string; project_id?: string }): Promise<Contact[]> {
  if (isCloud()) {
    const q: Record<string, string> = {};
    if (filters?.agent_id) q.agent_id = filters.agent_id;
    if (filters?.project_id) q.project_id = filters.project_id;
    return (await cloud().list<Contact>("contacts", { query: q })).items;
  }
  return localContacts.listContacts(filters);
}
export async function searchContacts(query: string): Promise<Contact[]> {
  if (isCloud()) return (await cloud().list<Contact>("contacts", { query: { search: query } })).items;
  return localContacts.searchContacts(query);
}
export async function deleteContact(id: string): Promise<boolean> {
  if (isCloud()) {
    await cloud().delete("contacts", id);
    return true;
  }
  return localContacts.deleteContact(id);
}

// ── projects ────────────────────────────────────────────────────────────────
export async function createProject(input: CreateProjectInput): Promise<Project> {
  if (isCloud()) return cloud().create<Project>("projects", input);
  return localProjects.createProject(input);
}
export async function listProjects(): Promise<Project[]> {
  if (isCloud()) return (await cloud().list<Project>("projects")).items;
  return localProjects.listProjects();
}
export async function getProject(id: string): Promise<Project | null> {
  if (isCloud()) return cloud().get<Project>("projects", id);
  return localProjects.getProject(id);
}
export async function deleteProject(id: string): Promise<boolean> {
  if (isCloud()) {
    await cloud().delete("projects", id);
    return true;
  }
  return localProjects.deleteProject(id);
}

// ── agents ──────────────────────────────────────────────────────────────────
export async function registerAgent(input: RegisterAgentInput): Promise<Agent | AgentConflictError> {
  if (isCloud()) return cloud().create<Agent>("agents", input);
  return localAgents.registerAgent(input);
}
export async function listAgents(projectId?: string): Promise<Agent[]> {
  if (isCloud()) {
    const q: Record<string, string> = {};
    if (projectId) q.project_id = projectId;
    return (await cloud().list<Agent>("agents", { query: q })).items;
  }
  return localAgents.listAgents(projectId);
}
export async function getAgent(id: string): Promise<Agent | null> {
  if (isCloud()) return cloud().get<Agent>("agents", id);
  return localAgents.getAgent(id);
}
export async function getAgentByName(name: string): Promise<Agent | null> {
  if (isCloud()) {
    const items = (await cloud().list<Agent>("agents")).items;
    return items.find((a) => a.name === name) ?? null;
  }
  return localAgents.getAgentByName(name);
}
export async function heartbeat(agentId: string): Promise<Agent | null> {
  if (isCloud()) throw new CloudUnsupportedError("agent heartbeat");
  return localAgents.heartbeat(agentId);
}
export async function releaseAgent(agentId: string): Promise<boolean> {
  if (isCloud()) throw new CloudUnsupportedError("agent release");
  return localAgents.releaseAgent(agentId);
}

// ── phone numbers ────────────────────────────────────────────────────────────
export async function listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }): Promise<PhoneNumber[]> {
  if (isCloud()) {
    const q: Record<string, string> = {};
    if (filters?.agent_id) q.agent_id = filters.agent_id;
    if (filters?.project_id) q.project_id = filters.project_id;
    if (filters?.status) q.status = filters.status;
    return (await cloud().list<PhoneNumber>("numbers", { query: q })).items;
  }
  return localNumbers.listPhoneNumbers(filters);
}
export async function assignPhoneNumber(id: string, agentId?: string, projectId?: string): Promise<PhoneNumber | null> {
  if (isCloud()) throw new CloudUnsupportedError("number assign");
  return localNumbers.assignPhoneNumber(id, agentId, projectId);
}

// ── messages ────────────────────────────────────────────────────────────────
export async function listMessages(filters?: { agent_id?: string; project_id?: string; type?: MessageType; limit?: number }): Promise<Message[]> {
  if (isCloud()) {
    const q: Record<string, string | number> = {};
    if (filters?.agent_id) q.agent_id = filters.agent_id;
    if (filters?.project_id) q.project_id = filters.project_id;
    if (filters?.type) q.type = filters.type;
    if (filters?.limit) q.limit = filters.limit;
    return (await cloud().list<Message>("messages", { query: q })).items;
  }
  return localMessages.listMessages(filters);
}
export async function searchMessages(query: string, limit?: number): Promise<Message[]> {
  if (isCloud()) {
    const items = (await cloud().list<Message>("messages", { query: { limit: limit ?? 200 } })).items;
    const needle = query.toLowerCase();
    return items.filter((m) => (m.body ?? "").toLowerCase().includes(needle));
  }
  return localMessages.searchMessages(query, limit);
}
export async function getConversation(phoneNumber: string, limit?: number): Promise<Message[]> {
  if (isCloud()) {
    const items = (await cloud().list<Message>("messages", { query: { limit: limit ?? 200 } })).items;
    return items.filter((m) => m.from_number === phoneNumber || m.to_number === phoneNumber);
  }
  return localMessages.getConversation(phoneNumber, limit);
}

// ── calls ───────────────────────────────────────────────────────────────────
export async function listCalls(filters?: { agent_id?: string; project_id?: string; limit?: number }): Promise<Call[]> {
  if (isCloud()) {
    const q: Record<string, string | number> = {};
    if (filters?.agent_id) q.agent_id = filters.agent_id;
    if (filters?.project_id) q.project_id = filters.project_id;
    if (filters?.limit) q.limit = filters.limit;
    return (await cloud().list<Call>("calls", { query: q })).items;
  }
  return localCalls.listCalls(filters);
}

// ── voicemails ──────────────────────────────────────────────────────────────
export async function listVoicemails(filters?: { agent_id?: string; project_id?: string; listened?: boolean }): Promise<Voicemail[]> {
  if (isCloud()) {
    const q: Record<string, string> = {};
    if (filters?.agent_id) q.agent_id = filters.agent_id;
    if (filters?.project_id) q.project_id = filters.project_id;
    return (await cloud().list<Voicemail>("voicemails", { query: q })).items;
  }
  return localVoicemails.listVoicemails(filters);
}
export async function markVoicemailListened(id: string): Promise<boolean> {
  if (isCloud()) throw new CloudUnsupportedError("voicemail mark-listened");
  return localVoicemails.markVoicemailListened(id);
}

// ── schedules ───────────────────────────────────────────────────────────────
export async function createSchedule(input: CreateScheduleInput): Promise<Schedule> {
  if (isCloud()) return cloud().create<Schedule>("schedules", input);
  return localSchedules.createSchedule(input);
}
export async function listSchedules(filters?: { agent_id?: string; project_id?: string; enabled?: boolean }): Promise<Schedule[]> {
  if (isCloud()) {
    const q: Record<string, string> = {};
    if (filters?.agent_id) q.agent_id = filters.agent_id;
    if (filters?.project_id) q.project_id = filters.project_id;
    return (await cloud().list<Schedule>("schedules", { query: q })).items;
  }
  return localSchedules.listSchedules(filters);
}
export async function enableSchedule(id: string): Promise<boolean> {
  if (isCloud()) throw new CloudUnsupportedError("schedule enable");
  return localSchedules.enableSchedule(id);
}
export async function disableSchedule(id: string): Promise<boolean> {
  if (isCloud()) throw new CloudUnsupportedError("schedule disable");
  return localSchedules.disableSchedule(id);
}
export async function deleteSchedule(id: string): Promise<boolean> {
  if (isCloud()) throw new CloudUnsupportedError("schedule delete");
  return localSchedules.deleteSchedule(id);
}

// ── webhooks ────────────────────────────────────────────────────────────────
export async function createWebhook(input: CreateWebhookInput): Promise<Webhook> {
  if (isCloud()) return cloud().create<Webhook>("webhooks", input);
  return localWebhooks.createWebhook(input);
}
export async function listWebhooks(): Promise<Webhook[]> {
  if (isCloud()) return (await cloud().list<Webhook>("webhooks")).items;
  return localWebhooks.listWebhooks();
}
export async function deleteWebhook(id: string): Promise<boolean> {
  if (isCloud()) throw new CloudUnsupportedError("webhook delete");
  return localWebhooks.deleteWebhook(id);
}

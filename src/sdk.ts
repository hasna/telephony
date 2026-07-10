// @hasna/telephony — embeddable SDK.
//
// Every method routes through the single Store abstraction (getStore) and the
// provider lib actions. This means the SDK works IDENTICALLY in `local` mode
// (on-box SQLite) and in `self_hosted`/`cloud` mode (the /v1 HTTP API with a
// bearer key) — resolved from the client-flip env — WITHOUT requiring a running
// local REST server. No SDK method touches sqlite or fetch directly.

import { getStore, type TelephonyStore } from "./lib/store/index.js";
import { sendSms as sendSmsAction } from "./lib/sms.js";
import { sendWhatsApp as sendWhatsAppAction, sendWhatsAppAudio as sendWhatsAppAudioAction } from "./lib/whatsapp.js";
import { makeCall as makeCallAction } from "./lib/voice.js";
import { searchAvailableNumbers as searchAvailableNumbersAction, provisionNumber as provisionNumberAction, releaseNumber as releaseNumberAction } from "./lib/provisioning.js";
import { generateSpeech, listVoices as listVoicesAction } from "./lib/tts.js";
import { generateSchedule, generateMessage, analyzeIncomingMessage } from "./lib/cerebras.js";
import pkg from "../package.json";
import type { RegisterAgentInput } from "./types/index.js";

export interface TelephonyClientOptions {
  /**
   * Optional environment override for Store resolution (mode/URL/key). Defaults
   * to `process.env`. There is NO baseUrl/DSN option: the transport (local vs
   * cloud) is resolved from the client-flip env, never a raw connection string.
   */
  env?: Record<string, string | undefined>;
}

export class TelephonyClient {
  private readonly store: TelephonyStore;

  constructor(options: TelephonyClientOptions = {}) {
    this.store = getStore(options.env);
  }

  // ── Messaging ──────────────────────────────────────────────────────────────
  async sendSms(to: string, body: string, from?: string) {
    return sendSmsAction({ to, body, from });
  }
  async sendWhatsApp(to: string, body: string, from?: string) {
    return sendWhatsAppAction({ to, body, from });
  }
  async sendWhatsAppAudio(to: string, mediaUrl: string, body?: string) {
    return sendWhatsAppAudioAction({ to, media_url: mediaUrl, body });
  }
  async makeCall(to: string, from?: string, twiml?: string) {
    return makeCallAction({ to, from, twiml });
  }
  async listMessages(options?: { agent_id?: string; limit?: number }) {
    return this.store.listMessages(options);
  }
  async searchMessages(query: string) {
    return this.store.searchMessages(query);
  }
  async getConversation(phone: string) {
    return this.store.getConversation(phone);
  }

  // ── Calls / voicemail ────────────────────────────────────────────────────────
  async listCalls() {
    return this.store.listCalls();
  }
  async listVoicemails() {
    return this.store.listVoicemails();
  }

  // ── Numbers ──────────────────────────────────────────────────────────────────
  async listNumbers() {
    return this.store.listPhoneNumbers();
  }
  async searchAvailableNumbers(options: { country?: string; area_code?: string }) {
    return searchAvailableNumbersAction(options);
  }
  async provisionNumber(phoneNumber: string, agentId?: string) {
    return provisionNumberAction({ phone_number: phoneNumber, agent_id: agentId });
  }
  async releaseNumber(number: string) {
    return releaseNumberAction(number);
  }

  // ── Agents / projects / contacts ──────────────────────────────────────────────
  async listAgents() {
    return this.store.listAgents();
  }
  async registerAgent(name: string, options?: Omit<RegisterAgentInput, "name">) {
    return this.store.registerAgent({ name, ...options });
  }
  async heartbeat(agentId: string) {
    return this.store.heartbeat(agentId);
  }
  async listProjects() {
    return this.store.listProjects();
  }
  async createProject(name: string, path: string, description?: string) {
    return this.store.createProject({ name, path, description });
  }
  async listContacts() {
    return this.store.listContacts();
  }
  async searchContacts(query: string) {
    return this.store.searchContacts(query);
  }

  // ── Schedules ─────────────────────────────────────────────────────────────────
  async listSchedules() {
    return this.store.listSchedules();
  }
  async createScheduleAI(description: string) {
    const parsed = await generateSchedule(description);
    return this.store.createSchedule({
      name: parsed.description,
      cron_expression: parsed.cron_expression,
      action: parsed.action as any,
      command: parsed.command,
      parameters: parsed.parameters,
    });
  }

  // ── TTS / AI ──────────────────────────────────────────────────────────────────
  async tts(text: string, voiceId?: string) {
    return generateSpeech({ text, voice_id: voiceId });
  }
  async listVoices() {
    return listVoicesAction();
  }
  async aiMessage(context: string, instruction: string, tone?: string) {
    return { message: await generateMessage({ context, instruction, tone }) };
  }
  async aiAnalyze(message: string) {
    return analyzeIncomingMessage(message);
  }

  // ── Meta ────────────────────────────────────────────────────────────────────
  async health() {
    return { status: "ok", version: pkg.version, transport: this.store.transport };
  }
}

export function createClient(options?: TelephonyClientOptions): TelephonyClient {
  return new TelephonyClient(options);
}

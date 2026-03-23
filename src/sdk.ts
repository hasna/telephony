export interface TelephonyClientOptions {
  baseUrl?: string;
}

export class TelephonyClient {
  private baseUrl: string;

  constructor(options: TelephonyClientOptions = {}) {
    this.baseUrl = (options.baseUrl || "http://localhost:19451").replace(/\/$/, "");
  }

  private async request(path: string, options?: RequestInit): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
    if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async sendSms(to: string, body: string, from?: string) {
    return this.request("/api/sms/send", { method: "POST", body: JSON.stringify({ to, body, from }) });
  }

  async sendWhatsApp(to: string, body: string, from?: string) {
    return this.request("/api/whatsapp/send", { method: "POST", body: JSON.stringify({ to, body, from }) });
  }

  async sendWhatsAppAudio(to: string, mediaUrl: string, body?: string) {
    return this.request("/api/whatsapp/send-audio", { method: "POST", body: JSON.stringify({ to, media_url: mediaUrl, body }) });
  }

  async makeCall(to: string, from?: string, twiml?: string) {
    return this.request("/api/call/make", { method: "POST", body: JSON.stringify({ to, from, twiml }) });
  }

  async listMessages(options?: { agent_id?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (options?.agent_id) params.set("agent_id", options.agent_id);
    if (options?.limit) params.set("limit", String(options.limit));
    return this.request(`/api/messages?${params}`);
  }

  async searchMessages(query: string) {
    return this.request(`/api/messages/search?q=${encodeURIComponent(query)}`);
  }

  async getConversation(phone: string) {
    return this.request(`/api/conversation/${encodeURIComponent(phone)}`);
  }

  async listCalls() { return this.request("/api/calls"); }
  async listVoicemails() { return this.request("/api/voicemails"); }
  async listNumbers() { return this.request("/api/numbers"); }

  async searchAvailableNumbers(options: { country?: string; area_code?: string }) {
    return this.request("/api/numbers/search", { method: "POST", body: JSON.stringify(options) });
  }

  async provisionNumber(phoneNumber: string, agentId?: string) {
    return this.request("/api/numbers/provision", { method: "POST", body: JSON.stringify({ phone_number: phoneNumber, agent_id: agentId }) });
  }

  async releaseNumber(number: string) {
    return this.request("/api/numbers/release", { method: "POST", body: JSON.stringify({ number }) });
  }

  async listAgents() { return this.request("/api/agents"); }

  async registerAgent(name: string, options?: { description?: string; session_id?: string }) {
    return this.request("/api/agents/register", { method: "POST", body: JSON.stringify({ name, ...options }) });
  }

  async heartbeat(agentId: string) {
    return this.request("/api/agents/heartbeat", { method: "POST", body: JSON.stringify({ agent_id: agentId }) });
  }

  async listProjects() { return this.request("/api/projects"); }
  async createProject(name: string, path: string, description?: string) {
    return this.request("/api/projects", { method: "POST", body: JSON.stringify({ name, path, description }) });
  }

  async listContacts() { return this.request("/api/contacts"); }
  async searchContacts(query: string) { return this.request(`/api/contacts/search?q=${encodeURIComponent(query)}`); }

  async listSchedules() { return this.request("/api/schedules"); }
  async createScheduleAI(description: string) {
    return this.request("/api/schedules/ai", { method: "POST", body: JSON.stringify({ description }) });
  }

  async tts(text: string, voiceId?: string) {
    return this.request("/api/tts", { method: "POST", body: JSON.stringify({ text, voice_id: voiceId }) });
  }

  async listVoices() { return this.request("/api/voices"); }

  async aiMessage(context: string, instruction: string, tone?: string) {
    return this.request("/api/ai/message", { method: "POST", body: JSON.stringify({ context, instruction, tone }) });
  }

  async aiAnalyze(message: string) {
    return this.request("/api/ai/analyze", { method: "POST", body: JSON.stringify({ message }) });
  }

  async health() { return this.request("/health"); }
}

export function createClient(baseUrl?: string): TelephonyClient {
  return new TelephonyClient({ baseUrl });
}

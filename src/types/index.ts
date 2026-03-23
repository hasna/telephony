// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

export type AgentStatus = "active" | "inactive" | "archived";

export interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  session_id: string | null;
  project_id: string | null;
  capabilities: string;
  permissions: string;
  status: string;
  metadata: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  session_id: string | null;
  project_id: string | null;
  capabilities: string[];
  permissions: string[];
  status: AgentStatus;
  metadata: Record<string, unknown>;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface RegisterAgentInput {
  name: string;
  description?: string;
  session_id?: string;
  project_id?: string;
  capabilities?: string[];
  permissions?: string[];
  force?: boolean;
}

export interface AgentConflictError {
  error: "conflict";
  message: string;
  existing_agent: Agent;
  suggestions?: string[];
}

// ---------------------------------------------------------------------------
// Project types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  agent_id: string | null;
  project_id: string | null;
  working_dir: string | null;
  metadata: string;
  started_at: string;
  last_activity: string;
}

export interface Session {
  id: string;
  agent_id: string | null;
  project_id: string | null;
  working_dir: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  last_activity: string;
}

export interface CreateSessionInput {
  agent_id?: string;
  project_id?: string;
  working_dir?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Phone number types
// ---------------------------------------------------------------------------

export type PhoneNumberStatus = "active" | "pending" | "released";
export type PhoneNumberCapability = "sms" | "voice" | "whatsapp" | "mms";

export interface PhoneNumber {
  id: string;
  number: string;
  country: string;
  capabilities: PhoneNumberCapability[];
  agent_id: string | null;
  project_id: string | null;
  twilio_sid: string | null;
  friendly_name: string | null;
  status: PhoneNumberStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PhoneNumberRow {
  id: string;
  number: string;
  country: string;
  capabilities: string;
  agent_id: string | null;
  project_id: string | null;
  twilio_sid: string | null;
  friendly_name: string | null;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface ProvisionNumberInput {
  number?: string;
  country?: string;
  area_code?: string;
  capabilities?: PhoneNumberCapability[];
  agent_id?: string;
  project_id?: string;
  friendly_name?: string;
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type MessageType = "sms_outbound" | "sms_inbound" | "whatsapp_outbound" | "whatsapp_inbound";
export type MessageStatus = "queued" | "sent" | "delivered" | "failed" | "received" | "read";

export interface Message {
  id: string;
  type: MessageType;
  from_number: string;
  to_number: string;
  body: string | null;
  media_url: string | null;
  status: MessageStatus;
  agent_id: string | null;
  project_id: string | null;
  twilio_sid: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  type: string;
  from_number: string;
  to_number: string;
  body: string | null;
  media_url: string | null;
  status: string;
  agent_id: string | null;
  project_id: string | null;
  twilio_sid: string | null;
  error_message: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface SendMessageInput {
  to: string;
  body: string;
  from?: string;
  media_url?: string;
  agent_id?: string;
  project_id?: string;
}

// ---------------------------------------------------------------------------
// Call types
// ---------------------------------------------------------------------------

export type CallDirection = "inbound" | "outbound";
export type CallStatus = "initiated" | "ringing" | "in-progress" | "completed" | "busy" | "no-answer" | "failed" | "canceled";

export interface Call {
  id: string;
  direction: CallDirection;
  from_number: string;
  to_number: string;
  status: CallStatus;
  duration: number | null;
  recording_url: string | null;
  transcription: string | null;
  agent_id: string | null;
  project_id: string | null;
  twilio_sid: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface CallRow {
  id: string;
  direction: string;
  from_number: string;
  to_number: string;
  status: string;
  duration: number | null;
  recording_url: string | null;
  transcription: string | null;
  agent_id: string | null;
  project_id: string | null;
  twilio_sid: string | null;
  metadata: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface MakeCallInput {
  to: string;
  from?: string;
  agent_id?: string;
  project_id?: string;
  twiml?: string;
}

// ---------------------------------------------------------------------------
// Voicemail types
// ---------------------------------------------------------------------------

export interface Voicemail {
  id: string;
  call_id: string | null;
  from_number: string;
  to_number: string;
  recording_url: string | null;
  local_path: string | null;
  transcription: string | null;
  duration: number | null;
  listened: boolean;
  agent_id: string | null;
  project_id: string | null;
  created_at: string;
}

export interface VoicemailRow {
  id: string;
  call_id: string | null;
  from_number: string;
  to_number: string;
  recording_url: string | null;
  local_path: string | null;
  transcription: string | null;
  duration: number | null;
  listened: number;
  agent_id: string | null;
  project_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Contact types
// ---------------------------------------------------------------------------

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  agent_id: string | null;
  project_id: string | null;
  notes: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ContactRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  agent_id: string | null;
  project_id: string | null;
  notes: string | null;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface CreateContactInput {
  name: string;
  phone: string;
  email?: string;
  agent_id?: string;
  project_id?: string;
  notes?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Schedule types
// ---------------------------------------------------------------------------

export type ScheduleAction = "send_sms" | "send_whatsapp" | "make_call" | "tts" | "custom";

export interface Schedule {
  id: string;
  name: string;
  cron_expression: string;
  action: ScheduleAction;
  command: string;
  parameters: Record<string, unknown>;
  agent_id: string | null;
  project_id: string | null;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRow {
  id: string;
  name: string;
  cron_expression: string;
  action: string;
  command: string;
  parameters: string;
  agent_id: string | null;
  project_id: string | null;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleInput {
  name: string;
  cron_expression: string;
  action: ScheduleAction;
  command: string;
  parameters?: Record<string, unknown>;
  agent_id?: string;
  project_id?: string;
}

// ---------------------------------------------------------------------------
// Webhook types
// ---------------------------------------------------------------------------

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

export interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string | null;
  active: number;
  created_at: string;
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
  secret?: string;
}

export interface WebhookEvent {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "failed";
  response_code: number | null;
  error: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface TelephonyConfig {
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  twilio_phone_number?: string;
  elevenlabs_api_key?: string;
  elevenlabs_voice_id?: string;
  openai_api_key?: string;
  cerebras_api_key?: string;
  webhook_base_url?: string;
  server_port?: number;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class PhoneNumberNotFoundError extends Error {
  constructor(id: string) {
    super(`Phone number not found: ${id}`);
    this.name = "PhoneNumberNotFoundError";
  }
}

export class AgentNotFoundError extends Error {
  constructor(id: string) {
    super(`Agent not found: ${id}`);
    this.name = "AgentNotFoundError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDatabase } from "../db/database.js";
import { registerAgent, listAgents, heartbeat, getAgent, getAgentByName } from "../db/agents.js";
import { createProject, listProjects } from "../db/projects.js";
import { listPhoneNumbers, assignPhoneNumber } from "../db/phone-numbers.js";
import { listMessages, searchMessages, getConversation } from "../db/messages.js";
import { listCalls } from "../db/calls.js";
import { listVoicemails } from "../db/voicemails.js";
import { createContact, listContacts, searchContacts } from "../db/contacts.js";
import { createSchedule, listSchedules } from "../db/schedules.js";
import { createWebhook, listWebhooks } from "../db/webhooks.js";
import { sendSms } from "../lib/sms.js";
import { sendWhatsApp, sendWhatsAppAudio } from "../lib/whatsapp.js";
import { makeCall } from "../lib/voice.js";
import { searchAvailableNumbers, provisionNumber, releaseNumber, configureNumber } from "../lib/provisioning.js";
import { generateSpeech, listVoices } from "../lib/tts.js";
import { transcribe } from "../lib/stt.js";
import { generateSchedule, generateMessage, analyzeIncomingMessage } from "../lib/cerebras.js";
import { setGreeting } from "../lib/voicemail.js";
import { tick } from "../lib/scheduler.js";

getDatabase();

const server = new McpServer({ name: "telephony", version: "0.1.0" });

// --- Agents ---
server.tool("telephony_register_agent", "Register an agent", {
  name: z.string(), description: z.string().optional(), session_id: z.string().optional(),
  project_id: z.string().optional(), capabilities: z.array(z.string()).optional(), force: z.boolean().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(registerAgent(args), null, 2) }] }));

server.tool("telephony_list_agents", "List registered agents", {
  project_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(listAgents(args.project_id), null, 2) }] }));

server.tool("telephony_get_agent", "Get agent by ID or name", { id: z.string() }, async (args) => {
  const agent = getAgent(args.id) || getAgentByName(args.id);
  return { content: [{ type: "text" as const, text: JSON.stringify(agent, null, 2) }] };
});

server.tool("telephony_heartbeat", "Send agent heartbeat", { agent_id: z.string() },
  async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(heartbeat(args.agent_id), null, 2) }] }));

// --- Projects ---
server.tool("telephony_create_project", "Create a project", {
  name: z.string(), path: z.string(), description: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(createProject(args), null, 2) }] }));

server.tool("telephony_list_projects", "List projects", {}, async () =>
  ({ content: [{ type: "text" as const, text: JSON.stringify(listProjects(), null, 2) }] }));

// --- SMS ---
server.tool("telephony_send_sms", "Send an SMS message", {
  to: z.string().describe("Recipient phone (E.164)"), body: z.string(),
  from: z.string().optional(), agent_id: z.string().optional(), project_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await sendSms(args), null, 2) }] }));

// --- WhatsApp ---
server.tool("telephony_send_whatsapp", "Send a WhatsApp text message", {
  to: z.string(), body: z.string(), from: z.string().optional(), agent_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await sendWhatsApp(args), null, 2) }] }));

server.tool("telephony_send_audio", "Send a WhatsApp audio message", {
  to: z.string(), media_url: z.string(), body: z.string().optional(), from: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await sendWhatsAppAudio(args), null, 2) }] }));

// --- Messages ---
server.tool("telephony_list_messages", "List messages", {
  agent_id: z.string().optional(), project_id: z.string().optional(), limit: z.number().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(listMessages(args), null, 2) }] }));

server.tool("telephony_search_messages", "Search messages by text", {
  query: z.string(), limit: z.number().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(searchMessages(args.query, args.limit), null, 2) }] }));

server.tool("telephony_get_conversation", "Get conversation with a phone number", {
  phone_number: z.string(), limit: z.number().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(getConversation(args.phone_number, args.limit), null, 2) }] }));

// --- Calls ---
server.tool("telephony_make_call", "Make an outbound call", {
  to: z.string(), from: z.string().optional(), twiml: z.string().optional(), agent_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await makeCall(args), null, 2) }] }));

server.tool("telephony_list_calls", "List call log", {
  agent_id: z.string().optional(), project_id: z.string().optional(), limit: z.number().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(listCalls(args), null, 2) }] }));

// --- Phone Numbers ---
server.tool("telephony_search_available_numbers", "Search available phone numbers to buy", {
  country: z.string().optional(), area_code: z.string().optional(), limit: z.number().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await searchAvailableNumbers(args), null, 2) }] }));

server.tool("telephony_provision_number", "Buy a phone number from Twilio", {
  phone_number: z.string(), agent_id: z.string().optional(), project_id: z.string().optional(), friendly_name: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await provisionNumber(args), null, 2) }] }));

server.tool("telephony_release_number", "Release a phone number", { number: z.string() },
  async (args) => { await releaseNumber(args.number); return { content: [{ type: "text" as const, text: "Number released." }] }; });

server.tool("telephony_list_numbers", "List provisioned phone numbers", {
  agent_id: z.string().optional(), project_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(listPhoneNumbers(args), null, 2) }] }));

server.tool("telephony_assign_number", "Assign phone number to agent/project", {
  id: z.string(), agent_id: z.string().optional(), project_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(assignPhoneNumber(args.id, args.agent_id, args.project_id), null, 2) }] }));

server.tool("telephony_configure_number", "Configure a Twilio phone number", {
  sid: z.string(), sms_url: z.string().optional(), voice_url: z.string().optional(), friendly_name: z.string().optional(),
}, async (args) => { await configureNumber(args.sid, args); return { content: [{ type: "text" as const, text: "Number configured." }] }; });

// --- TTS / STT ---
server.tool("telephony_tts", "Generate speech from text (ElevenLabs)", {
  text: z.string(), voice_id: z.string().optional(), output_path: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await generateSpeech(args), null, 2) }] }));

server.tool("telephony_stt", "Transcribe audio file to text (ElevenLabs)", { file_path: z.string() },
  async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await transcribe(args.file_path), null, 2) }] }));

server.tool("telephony_list_voices", "List available TTS voices", {}, async () =>
  ({ content: [{ type: "text" as const, text: JSON.stringify(await listVoices(), null, 2) }] }));

// --- Voicemail ---
server.tool("telephony_list_voicemails", "List voicemails", {
  agent_id: z.string().optional(), project_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(listVoicemails(args), null, 2) }] }));

server.tool("telephony_set_greeting", "Set voicemail greeting using TTS", {
  agent_id: z.string(), text: z.string(), voice_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await setGreeting(args), null, 2) }] }));

// --- Contacts ---
server.tool("telephony_add_contact", "Add a contact", {
  name: z.string(), phone: z.string(), email: z.string().optional(),
  agent_id: z.string().optional(), project_id: z.string().optional(), notes: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(createContact(args), null, 2) }] }));

server.tool("telephony_list_contacts", "List contacts", {
  agent_id: z.string().optional(), project_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(listContacts(args), null, 2) }] }));

server.tool("telephony_search_contacts", "Search contacts", { query: z.string() },
  async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(searchContacts(args.query), null, 2) }] }));

// --- Schedules ---
server.tool("telephony_create_schedule", "Create a cron schedule", {
  name: z.string(), cron_expression: z.string(),
  action: z.enum(["send_sms", "send_whatsapp", "make_call", "tts", "custom"]),
  command: z.string(), parameters: z.record(z.unknown()).optional(),
  agent_id: z.string().optional(), project_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(createSchedule(args as any), null, 2) }] }));

server.tool("telephony_create_schedule_ai", "Create schedule from natural language (Cerebras AI)", {
  description: z.string().describe("e.g. 'send SMS to +1234 every day at 9am'"), agent_id: z.string().optional(),
}, async (args) => {
  const parsed = await generateSchedule(args.description);
  const sched = createSchedule({ name: parsed.description, cron_expression: parsed.cron_expression, action: parsed.action as any, command: parsed.command, parameters: parsed.parameters, agent_id: args.agent_id });
  return { content: [{ type: "text" as const, text: JSON.stringify({ parsed, schedule: sched }, null, 2) }] };
});

server.tool("telephony_list_schedules", "List schedules", {
  agent_id: z.string().optional(), project_id: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(listSchedules(args), null, 2) }] }));

server.tool("telephony_run_schedules", "Run all due schedules now", {}, async () =>
  ({ content: [{ type: "text" as const, text: JSON.stringify(await tick(), null, 2) }] }));

// --- AI ---
server.tool("telephony_ai_message", "Generate a message using Cerebras AI", {
  context: z.string(), instruction: z.string(), tone: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: await generateMessage(args) }] }));

server.tool("telephony_ai_analyze", "Analyze an incoming message with AI", { message: z.string() },
  async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await analyzeIncomingMessage(args.message), null, 2) }] }));

// --- Webhooks ---
server.tool("telephony_create_webhook", "Register a webhook", {
  url: z.string(), events: z.array(z.string()).optional(), secret: z.string().optional(),
}, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(createWebhook(args), null, 2) }] }));

server.tool("telephony_list_webhooks", "List webhooks", {}, async () =>
  ({ content: [{ type: "text" as const, text: JSON.stringify(listWebhooks(), null, 2) }] }));

// --- Meta ---
server.tool("telephony_describe_tools", "List all available telephony tools", {}, async () => {
  const tools = ["telephony_register_agent", "telephony_list_agents", "telephony_get_agent", "telephony_heartbeat", "telephony_create_project", "telephony_list_projects", "telephony_send_sms", "telephony_send_whatsapp", "telephony_send_audio", "telephony_list_messages", "telephony_search_messages", "telephony_get_conversation", "telephony_make_call", "telephony_list_calls", "telephony_search_available_numbers", "telephony_provision_number", "telephony_release_number", "telephony_list_numbers", "telephony_assign_number", "telephony_configure_number", "telephony_tts", "telephony_stt", "telephony_list_voices", "telephony_list_voicemails", "telephony_set_greeting", "telephony_add_contact", "telephony_list_contacts", "telephony_search_contacts", "telephony_create_schedule", "telephony_create_schedule_ai", "telephony_list_schedules", "telephony_run_schedules", "telephony_ai_message", "telephony_ai_analyze", "telephony_create_webhook", "telephony_list_webhooks", "telephony_send_feedback"];
  return { content: [{ type: "text" as const, text: tools.join("\n") }] };
});

server.tool("telephony_send_feedback", "Send feedback about this service", {
  message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional(),
}, async (args) => {
  try {
    const db = getDatabase();
    db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(args.message, args.email || null, args.category || "general", "0.1.0");
    return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
  } catch (e: any) {
    return { content: [{ type: "text" as const, text: String(e) }], isError: true };
  }
});

server.tool("telephony_set_focus", "Set agent focus to a project", {
  project_id: z.string(), from: z.string().optional(),
}, async (args) => {
  const db = getDatabase();
  const agent = args.from || "unknown";
  db.run("UPDATE agents SET project_id = ?, updated_at = datetime('now') WHERE LOWER(name) = ?", [args.project_id, agent.toLowerCase()]);
  return { content: [{ type: "text" as const, text: JSON.stringify({ agent, focused: true, project_id: args.project_id }) }] };
});

// --- Start ---
const transport = new StdioServerTransport();
await server.connect(transport);

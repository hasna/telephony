#!/usr/bin/env bun
import { Command } from "commander";
import { getDatabase } from "../db/database.js";
import { registerAgent, listAgents, heartbeat, releaseAgent, getAgent, getAgentByName } from "../db/agents.js";
import { createProject, listProjects, getProject, deleteProject } from "../db/projects.js";
import { listPhoneNumbers, assignPhoneNumber } from "../db/phone-numbers.js";
import { listMessages, searchMessages, getConversation } from "../db/messages.js";
import { listCalls } from "../db/calls.js";
import { listVoicemails, markVoicemailListened } from "../db/voicemails.js";
import { createContact, listContacts, searchContacts, deleteContact } from "../db/contacts.js";
import { createSchedule, listSchedules, enableSchedule, disableSchedule, deleteSchedule } from "../db/schedules.js";
import { createWebhook, listWebhooks, deleteWebhook } from "../db/webhooks.js";
import { sendSms } from "../lib/sms.js";
import { sendWhatsApp, sendWhatsAppAudio } from "../lib/whatsapp.js";
import { makeCall } from "../lib/voice.js";
import { searchAvailableNumbers, provisionNumber, releaseNumber, configureNumber, listTwilioNumbers } from "../lib/provisioning.js";
import { generateSpeech, listVoices } from "../lib/tts.js";
import { transcribe } from "../lib/stt.js";
import { generateSchedule, generateMessage } from "../lib/cerebras.js";
import { setGreeting } from "../lib/voicemail.js";
import { tick } from "../lib/scheduler.js";
import { getConfig } from "../lib/config.js";

// Ensure DB is initialized
getDatabase();

const program = new Command();
program
  .name("telephony")
  .description("Telephony platform for AI agents — SMS, WhatsApp, voice, TTS/STT")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------
const smsCmd = program.command("sms").description("SMS messaging");

smsCmd
  .command("send")
  .description("Send an SMS")
  .requiredOption("--to <number>", "Recipient phone number")
  .requiredOption("--body <text>", "Message body")
  .option("--from <number>", "Sender phone number")
  .option("--agent <id>", "Agent ID")
  .option("--project <id>", "Project ID")
  .action(async (opts) => {
    const msg = await sendSms({ to: opts.to, body: opts.body, from: opts.from, agent_id: opts.agent, project_id: opts.project });
    console.log(JSON.stringify(msg, null, 2));
  });

smsCmd
  .command("list")
  .description("List SMS messages")
  .option("--agent <id>", "Filter by agent")
  .option("--project <id>", "Filter by project")
  .option("--limit <n>", "Limit results", "50")
  .action((opts) => {
    const msgs = listMessages({ agent_id: opts.agent, project_id: opts.project, limit: parseInt(opts.limit) });
    console.log(JSON.stringify(msgs, null, 2));
  });

smsCmd
  .command("search <query>")
  .description("Search messages")
  .option("--limit <n>", "Limit results", "50")
  .action((query, opts) => {
    const msgs = searchMessages(query, parseInt(opts.limit));
    console.log(JSON.stringify(msgs, null, 2));
  });

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------
const waCmd = program.command("whatsapp").description("WhatsApp messaging");

waCmd
  .command("send")
  .description("Send a WhatsApp message")
  .requiredOption("--to <number>", "Recipient phone number")
  .requiredOption("--body <text>", "Message body")
  .option("--from <number>", "Sender")
  .option("--agent <id>", "Agent ID")
  .action(async (opts) => {
    const msg = await sendWhatsApp({ to: opts.to, body: opts.body, from: opts.from, agent_id: opts.agent });
    console.log(JSON.stringify(msg, null, 2));
  });

waCmd
  .command("send-audio")
  .description("Send a WhatsApp audio message")
  .requiredOption("--to <number>", "Recipient")
  .requiredOption("--media-url <url>", "Audio URL")
  .option("--body <text>", "Caption")
  .option("--from <number>", "Sender")
  .action(async (opts) => {
    const msg = await sendWhatsAppAudio({ to: opts.to, media_url: opts.mediaUrl, body: opts.body, from: opts.from });
    console.log(JSON.stringify(msg, null, 2));
  });

waCmd
  .command("list")
  .description("List WhatsApp messages")
  .option("--agent <id>", "Filter by agent")
  .option("--limit <n>", "Limit", "50")
  .action((opts) => {
    const msgs = listMessages({ agent_id: opts.agent, type: "whatsapp_outbound", limit: parseInt(opts.limit) });
    console.log(JSON.stringify(msgs, null, 2));
  });

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------
const callCmd = program.command("call").description("Voice calls");

callCmd
  .command("make")
  .description("Make a call")
  .requiredOption("--to <number>", "Number to call")
  .option("--from <number>", "Caller ID")
  .option("--twiml <xml>", "TwiML instructions")
  .option("--agent <id>", "Agent ID")
  .action(async (opts) => {
    const call = await makeCall({ to: opts.to, from: opts.from, twiml: opts.twiml, agent_id: opts.agent });
    console.log(JSON.stringify(call, null, 2));
  });

callCmd
  .command("list")
  .description("List calls")
  .option("--agent <id>", "Filter by agent")
  .option("--limit <n>", "Limit", "50")
  .action((opts) => {
    const calls = listCalls({ agent_id: opts.agent, limit: parseInt(opts.limit) });
    console.log(JSON.stringify(calls, null, 2));
  });

// ---------------------------------------------------------------------------
// Voicemail
// ---------------------------------------------------------------------------
const vmCmd = program.command("voicemail").description("Voicemail management");

vmCmd
  .command("list")
  .description("List voicemails")
  .option("--agent <id>", "Filter by agent")
  .option("--unheard", "Only unheard")
  .action((opts) => {
    const vms = listVoicemails({ agent_id: opts.agent, listened: opts.unheard ? false : undefined });
    console.log(JSON.stringify(vms, null, 2));
  });

vmCmd
  .command("listen <id>")
  .description("Mark voicemail as listened")
  .action((id) => {
    markVoicemailListened(id);
    console.log("Marked as listened.");
  });

vmCmd
  .command("set-greeting")
  .description("Set voicemail greeting (TTS)")
  .requiredOption("--agent <id>", "Agent ID")
  .requiredOption("--text <text>", "Greeting text")
  .option("--voice <id>", "ElevenLabs voice ID")
  .action(async (opts) => {
    const result = await setGreeting({ agent_id: opts.agent, text: opts.text, voice_id: opts.voice });
    console.log("Greeting saved:", result.path);
  });

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------
const numCmd = program.command("number").description("Phone number management");

numCmd
  .command("search-available")
  .description("Search available phone numbers")
  .option("--country <code>", "Country code", "US")
  .option("--area-code <code>", "Area code")
  .option("--limit <n>", "Limit", "10")
  .action(async (opts) => {
    const numbers = await searchAvailableNumbers({ country: opts.country, area_code: opts.areaCode, limit: parseInt(opts.limit) });
    console.log(JSON.stringify(numbers, null, 2));
  });

numCmd
  .command("provision <number>")
  .description("Buy a phone number")
  .option("--agent <id>", "Assign to agent")
  .option("--project <id>", "Assign to project")
  .option("--name <name>", "Friendly name")
  .action(async (number, opts) => {
    const pn = await provisionNumber({ phone_number: number, agent_id: opts.agent, project_id: opts.project, friendly_name: opts.name });
    console.log(JSON.stringify(pn, null, 2));
  });

numCmd
  .command("release <number>")
  .description("Release a phone number")
  .action(async (number) => {
    await releaseNumber(number);
    console.log("Number released.");
  });

numCmd
  .command("list")
  .description("List phone numbers")
  .option("--agent <id>", "Filter by agent")
  .option("--project <id>", "Filter by project")
  .action((opts) => {
    const numbers = listPhoneNumbers({ agent_id: opts.agent, project_id: opts.project });
    console.log(JSON.stringify(numbers, null, 2));
  });

numCmd
  .command("assign <id>")
  .description("Assign number to agent/project")
  .option("--agent <id>", "Agent ID")
  .option("--project <id>", "Project ID")
  .action((id, opts) => {
    assignPhoneNumber(id, opts.agent, opts.project);
    console.log("Number assigned.");
  });

numCmd
  .command("twilio-list")
  .description("List numbers from Twilio account")
  .action(async () => {
    const numbers = await listTwilioNumbers();
    console.log(JSON.stringify(numbers, null, 2));
  });

numCmd
  .command("configure <sid>")
  .description("Configure a Twilio number")
  .option("--sms-url <url>", "SMS webhook URL")
  .option("--voice-url <url>", "Voice webhook URL")
  .option("--name <name>", "Friendly name")
  .action(async (sid, opts) => {
    await configureNumber(sid, { sms_url: opts.smsUrl, voice_url: opts.voiceUrl, friendly_name: opts.name });
    console.log("Number configured.");
  });

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
const agentCmd = program.command("agent").description("Agent management");

agentCmd
  .command("register")
  .description("Register an agent")
  .requiredOption("--name <name>", "Agent name")
  .option("--description <desc>", "Description")
  .option("--project <id>", "Project ID")
  .option("--force", "Force takeover")
  .action((opts) => {
    const result = registerAgent({ name: opts.name, description: opts.description, project_id: opts.project, force: opts.force });
    console.log(JSON.stringify(result, null, 2));
  });

agentCmd
  .command("list")
  .description("List agents")
  .option("--project <id>", "Filter by project")
  .action((opts) => {
    const agents = listAgents(opts.project);
    console.log(JSON.stringify(agents, null, 2));
  });

agentCmd
  .command("get <id>")
  .description("Get agent details")
  .action((id) => {
    const agent = getAgent(id) || getAgentByName(id);
    console.log(JSON.stringify(agent, null, 2));
  });

agentCmd
  .command("heartbeat <id>")
  .description("Send agent heartbeat")
  .action((id) => {
    const agent = heartbeat(id);
    console.log(JSON.stringify(agent, null, 2));
  });

agentCmd
  .command("release <id>")
  .description("Release an agent")
  .action((id) => {
    releaseAgent(id);
    console.log("Agent released.");
  });

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
const projCmd = program.command("project").description("Project management");

projCmd
  .command("create")
  .description("Create a project")
  .requiredOption("--name <name>", "Project name")
  .requiredOption("--path <path>", "Project path")
  .option("--description <desc>", "Description")
  .action((opts) => {
    const proj = createProject({ name: opts.name, path: opts.path, description: opts.description });
    console.log(JSON.stringify(proj, null, 2));
  });

projCmd
  .command("list")
  .description("List projects")
  .action(() => {
    console.log(JSON.stringify(listProjects(), null, 2));
  });

projCmd
  .command("get <id>")
  .description("Get project details")
  .action((id) => {
    console.log(JSON.stringify(getProject(id), null, 2));
  });

projCmd
  .command("delete <id>")
  .description("Delete a project")
  .action((id) => {
    deleteProject(id);
    console.log("Project deleted.");
  });

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------
const schedCmd = program.command("schedule").description("Cron schedules");

schedCmd
  .command("create")
  .description("Create a schedule")
  .requiredOption("--name <name>", "Schedule name")
  .requiredOption("--cron <expr>", "Cron expression (5-field)")
  .requiredOption("--action <type>", "Action type")
  .requiredOption("--command <cmd>", "Command to run")
  .option("--agent <id>", "Agent ID")
  .option("--project <id>", "Project ID")
  .action((opts) => {
    const sched = createSchedule({
      name: opts.name,
      cron_expression: opts.cron,
      action: opts.action,
      command: opts.command,
      agent_id: opts.agent,
      project_id: opts.project,
    });
    console.log(JSON.stringify(sched, null, 2));
  });

schedCmd
  .command("ai <description>")
  .description("Create schedule from natural language (Cerebras AI)")
  .option("--agent <id>", "Agent ID")
  .action(async (description, opts) => {
    const parsed = await generateSchedule(description);
    console.log("AI parsed schedule:", JSON.stringify(parsed, null, 2));
    const sched = createSchedule({
      name: parsed.description,
      cron_expression: parsed.cron_expression,
      action: parsed.action as any,
      command: parsed.command,
      parameters: parsed.parameters,
      agent_id: opts.agent,
    });
    console.log("Created:", JSON.stringify(sched, null, 2));
  });

schedCmd
  .command("list")
  .description("List schedules")
  .option("--agent <id>", "Filter by agent")
  .action((opts) => {
    console.log(JSON.stringify(listSchedules({ agent_id: opts.agent }), null, 2));
  });

schedCmd
  .command("enable <id>")
  .action((id) => { enableSchedule(id); console.log("Enabled."); });

schedCmd
  .command("disable <id>")
  .action((id) => { disableSchedule(id); console.log("Disabled."); });

schedCmd
  .command("delete <id>")
  .action((id) => { deleteSchedule(id); console.log("Deleted."); });

schedCmd
  .command("run")
  .description("Run all due schedules now")
  .action(async () => {
    const results = await tick();
    console.log(JSON.stringify(results, null, 2));
  });

// ---------------------------------------------------------------------------
// TTS / STT
// ---------------------------------------------------------------------------
program
  .command("tts")
  .description("Text-to-speech (ElevenLabs)")
  .requiredOption("--text <text>", "Text to convert")
  .option("--voice <id>", "Voice ID")
  .option("--out <file>", "Output filename")
  .action(async (opts) => {
    const result = await generateSpeech({ text: opts.text, voice_id: opts.voice, output_path: opts.out });
    console.log("Audio saved:", result.path, `(${result.size} bytes)`);
  });

program
  .command("stt")
  .description("Speech-to-text (ElevenLabs)")
  .requiredOption("--file <path>", "Audio file path")
  .action(async (opts) => {
    const result = await transcribe(opts.file);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("voices")
  .description("List available TTS voices")
  .action(async () => {
    const voices = await listVoices();
    for (const v of voices) {
      console.log(`${v.voice_id}  ${v.name}  [${v.category}]`);
    }
  });

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
const contactCmd = program.command("contact").description("Contact management");

contactCmd
  .command("add")
  .requiredOption("--name <name>", "Contact name")
  .requiredOption("--phone <number>", "Phone number")
  .option("--email <email>", "Email")
  .option("--agent <id>", "Agent ID")
  .option("--notes <text>", "Notes")
  .action((opts) => {
    const c = createContact({ name: opts.name, phone: opts.phone, email: opts.email, agent_id: opts.agent, notes: opts.notes });
    console.log(JSON.stringify(c, null, 2));
  });

contactCmd
  .command("list")
  .option("--agent <id>", "Filter by agent")
  .action((opts) => {
    console.log(JSON.stringify(listContacts({ agent_id: opts.agent }), null, 2));
  });

contactCmd
  .command("search <query>")
  .action((query) => {
    console.log(JSON.stringify(searchContacts(query), null, 2));
  });

contactCmd
  .command("delete <id>")
  .action((id) => { deleteContact(id); console.log("Deleted."); });

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
const whCmd = program.command("webhook").description("Webhook management");

whCmd
  .command("create")
  .requiredOption("--url <url>", "Webhook URL")
  .option("--events <events>", "Comma-separated events")
  .option("--secret <secret>", "Signing secret")
  .action((opts) => {
    const wh = createWebhook({ url: opts.url, events: opts.events?.split(","), secret: opts.secret });
    console.log(JSON.stringify(wh, null, 2));
  });

whCmd.command("list").action(() => { console.log(JSON.stringify(listWebhooks(), null, 2)); });
whCmd.command("delete <id>").action((id) => { deleteWebhook(id); console.log("Deleted."); });

// ---------------------------------------------------------------------------
// AI Message Generation
// ---------------------------------------------------------------------------
program
  .command("ai-message")
  .description("Generate a message using Cerebras AI")
  .requiredOption("--context <text>", "Context")
  .requiredOption("--instruction <text>", "Instruction")
  .option("--tone <tone>", "Tone")
  .action(async (opts) => {
    const msg = await generateMessage({ context: opts.context, instruction: opts.instruction, tone: opts.tone });
    console.log(msg);
  });

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------
program
  .command("conversation <phone>")
  .description("View conversation with a phone number")
  .option("--limit <n>", "Limit", "50")
  .action((phone, opts) => {
    const msgs = getConversation(phone, parseInt(opts.limit));
    console.log(JSON.stringify(msgs, null, 2));
  });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    const config = getConfig();
    const safe = {
      ...config,
      twilio_auth_token: config.twilio_auth_token ? "***" : undefined,
      elevenlabs_api_key: config.elevenlabs_api_key ? "***" : undefined,
      openai_api_key: config.openai_api_key ? "***" : undefined,
      cerebras_api_key: config.cerebras_api_key ? "***" : undefined,
    };
    console.log(JSON.stringify(safe, null, 2));
  });

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------
program
  .command("serve")
  .description("Start REST API + webhook server")
  .option("--port <port>", "Port number", "19451")
  .action(async (opts) => {
    process.env["TELEPHONY_PORT"] = opts.port;
    await import("../server/index.js");
  });

program.parse();

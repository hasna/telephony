import { getDatabase } from "../db/database.js";
import { registerAgent, listAgents, heartbeat, getAgent } from "../db/agents.js";
import { createProject, listProjects, getProject, deleteProject } from "../db/projects.js";
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
import { searchAvailableNumbers, provisionNumber, releaseNumber } from "../lib/provisioning.js";
import { generateSpeech, listVoices } from "../lib/tts.js";
import { transcribe } from "../lib/stt.js";
import { generateSchedule, generateMessage, analyzeIncomingMessage } from "../lib/cerebras.js";
import { startScheduler } from "../lib/scheduler.js";
import {
  handleSmsWebhook,
  handleWhatsAppWebhook,
  handleVoiceWebhook,
  handleVoicemailRecordingWebhook,
  handleStatusWebhook,
} from "./webhooks.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Ensure DB
getDatabase();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function twiml(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": "application/xml" },
  });
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return req.json();
  return {};
}

// Dashboard static file serving
const dashboardDir = join(import.meta.dir, "../../dashboard/dist");
const hasDashboard = existsSync(dashboardDir);

export function createServer(port: number = 19451) {
  // Start scheduler
  startScheduler();

  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      try {
        // --- Twilio Webhooks ---
        if (path === "/webhooks/sms/inbound" && req.method === "POST") {
          const body = await req.text();
          return twiml(await handleSmsWebhook(body));
        }
        if (path === "/webhooks/whatsapp/inbound" && req.method === "POST") {
          const body = await req.text();
          return twiml(await handleWhatsAppWebhook(body));
        }
        if (path === "/webhooks/voice/inbound" && req.method === "POST") {
          const body = await req.text();
          return twiml(await handleVoiceWebhook(body));
        }
        if (path === "/webhooks/voicemail/recording" && req.method === "POST") {
          const body = await req.text();
          return twiml(await handleVoicemailRecordingWebhook(body));
        }
        if (path === "/webhooks/status" && req.method === "POST") {
          const body = await req.text();
          return twiml(await handleStatusWebhook(body));
        }

        // --- Health ---
        if (path === "/health") return json({ status: "ok", version: "0.1.0" });

        // --- API Routes ---
        if (path === "/api/sms/send" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await sendSms(body as any));
        }
        if (path === "/api/whatsapp/send" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await sendWhatsApp(body as any));
        }
        if (path === "/api/whatsapp/send-audio" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await sendWhatsAppAudio(body as any));
        }
        if (path === "/api/call/make" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await makeCall(body as any));
        }
        if (path === "/api/messages") return json(listMessages({ limit: 50 }));
        if (path === "/api/messages/search") {
          const q = url.searchParams.get("q") || "";
          return json(searchMessages(q));
        }
        if (path.startsWith("/api/conversation/")) {
          const phone = decodeURIComponent(path.slice("/api/conversation/".length));
          return json(getConversation(phone));
        }
        if (path === "/api/calls") return json(listCalls());
        if (path === "/api/voicemails") return json(listVoicemails());
        if (path === "/api/numbers") return json(listPhoneNumbers());
        if (path === "/api/numbers/search" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await searchAvailableNumbers(body as any));
        }
        if (path === "/api/numbers/provision" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await provisionNumber(body as any));
        }
        if (path === "/api/numbers/release" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await releaseNumber(body.number as string));
        }
        if (path === "/api/agents" && req.method === "GET") return json(listAgents());
        if (path === "/api/agents/register" && req.method === "POST") {
          const body = await parseBody(req);
          return json(registerAgent(body as any));
        }
        if (path === "/api/agents/heartbeat" && req.method === "POST") {
          const body = await parseBody(req);
          return json(heartbeat(body.agent_id as string));
        }
        if (path === "/api/projects" && req.method === "GET") return json(listProjects());
        if (path === "/api/projects" && req.method === "POST") {
          const body = await parseBody(req);
          return json(createProject(body as any));
        }
        if (path === "/api/contacts" && req.method === "GET") return json(listContacts());
        if (path === "/api/contacts" && req.method === "POST") {
          const body = await parseBody(req);
          return json(createContact(body as any));
        }
        if (path === "/api/contacts/search") {
          const q = url.searchParams.get("q") || "";
          return json(searchContacts(q));
        }
        if (path === "/api/schedules" && req.method === "GET") return json(listSchedules());
        if (path === "/api/schedules" && req.method === "POST") {
          const body = await parseBody(req);
          return json(createSchedule(body as any));
        }
        if (path === "/api/schedules/ai" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await generateSchedule(body.description as string));
        }
        if (path === "/api/webhooks" && req.method === "GET") return json(listWebhooks());
        if (path === "/api/webhooks" && req.method === "POST") {
          const body = await parseBody(req);
          return json(createWebhook(body as any));
        }
        if (path === "/api/tts" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await generateSpeech(body as any));
        }
        if (path === "/api/voices") return json(await listVoices());
        if (path === "/api/ai/message" && req.method === "POST") {
          const body = await parseBody(req);
          return json({ message: await generateMessage(body as any) });
        }
        if (path === "/api/ai/analyze" && req.method === "POST") {
          const body = await parseBody(req);
          return json(await analyzeIncomingMessage(body.message as string));
        }

        // --- Dashboard ---
        if (hasDashboard) {
          const filePath = path === "/" ? "/index.html" : path;
          const file = Bun.file(join(dashboardDir, filePath));
          if (await file.exists()) return new Response(file);
          // SPA fallback
          const index = Bun.file(join(dashboardDir, "index.html"));
          if (await index.exists()) return new Response(index);
        }

        return json({ error: "Not found" }, 404);
      } catch (err: any) {
        return json({ error: err.message }, 500);
      }
    },
  });
}

import { requireConfig } from "./config.js";

interface CerebrasResponse {
  choices: Array<{ message: { content: string } }>;
}

/**
 * The Cerebras chat model. Overridable via CEREBRAS_MODEL / HASNA_CEREBRAS_MODEL
 * so a model retirement never hard-bricks ai-message / schedule-ai / ai-analyze
 * again. The default is a currently-served, generally-available Cerebras model
 * (the former `llama-4-scout-17b-16e-instruct` was retired and 404'd every call).
 */
export const DEFAULT_CEREBRAS_MODEL = "gpt-oss-120b";

export function resolveModel(): string {
  const raw = process.env.CEREBRAS_MODEL ?? process.env.HASNA_CEREBRAS_MODEL;
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_CEREBRAS_MODEL;
  // Strip a single pair of wrapping quotes (fleet machines sometimes store env
  // values quoted), mirroring config.env().
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (trimmed.length >= 2 && (first === '"' || first === "'") && last === first) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function cerebrasChat(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = requireConfig("cerebras_api_key");

  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) throw new Error(`Cerebras API error: ${res.status} ${await res.text()}`);

  const data = await res.json() as CerebrasResponse;
  return data.choices[0]?.message?.content || "";
}

export interface ParsedSchedule {
  cron_expression: string;
  action: string;
  command: string;
  parameters: Record<string, unknown>;
  description: string;
}

export async function generateSchedule(naturalLanguage: string): Promise<ParsedSchedule> {
  const systemPrompt = `You are a scheduling assistant. Parse natural language scheduling requests into structured cron schedules.
Return a JSON object with these fields:
- cron_expression: standard 5-field cron (minute hour dom month dow)
- action: one of "send_sms", "send_whatsapp", "make_call", "tts", "custom"
- command: the action to execute (e.g., message body, phone number)
- parameters: any additional parameters as key-value pairs
- description: human-readable description of what the schedule does

Current date/time: ${new Date().toISOString()}
Return ONLY valid JSON, no markdown.`;

  const response = await cerebrasChat(systemPrompt, naturalLanguage);

  try {
    return JSON.parse(response.trim()) as ParsedSchedule;
  } catch {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ParsedSchedule;
    }
    throw new Error(`Failed to parse schedule from AI response: ${response}`);
  }
}

export async function generateMessage(options: {
  context: string;
  instruction: string;
  tone?: string;
  max_length?: number;
}): Promise<string> {
  const systemPrompt = `You are a message composer for an AI agent telephony system.
Generate a message based on the given context and instruction.
${options.tone ? `Tone: ${options.tone}` : ""}
${options.max_length ? `Maximum length: ${options.max_length} characters` : ""}
Return ONLY the message text, nothing else.`;

  return cerebrasChat(systemPrompt, `Context: ${options.context}\n\nInstruction: ${options.instruction}`);
}

export async function analyzeIncomingMessage(message: string): Promise<{
  intent: string;
  sentiment: string;
  suggested_response: string;
  should_escalate: boolean;
}> {
  const systemPrompt = `Analyze this incoming message and return a JSON object with:
- intent: the purpose of the message (e.g., "inquiry", "complaint", "appointment", "greeting")
- sentiment: "positive", "neutral", or "negative"
- suggested_response: a brief suggested reply
- should_escalate: boolean, whether this needs human attention
Return ONLY valid JSON.`;

  const response = await cerebrasChat(systemPrompt, message);
  try {
    return JSON.parse(response.trim());
  } catch {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { intent: "unknown", sentiment: "neutral", suggested_response: "", should_escalate: false };
  }
}

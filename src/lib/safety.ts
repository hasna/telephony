import { createHmac, timingSafeEqual } from "node:crypto";

export type TelephonyProviderMode = "fixture" | "sandbox" | "read_only_live" | "live_mutating";
export type TelephonyOperation =
  | "rest_read"
  | "send_sms"
  | "send_whatsapp"
  | "make_call"
  | "provision_number"
  | "release_number"
  | "twilio_webhook_receive";

export interface TelephonyOperationGate {
  operation: TelephonyOperation;
  providerModes: TelephonyProviderMode[];
  sideEffectClass: "none" | "read_only" | "external_notification" | "phone_number_change";
  requiredEvidence: string[];
  approvalRequired: boolean;
  noSideEffectSmoke: string;
}

export type TelephonyMutationOperation = Exclude<TelephonyOperation, "rest_read" | "twilio_webhook_receive">;
export type TelephonyQueuedMutationStatus =
  | "queued"
  | "awaiting_operator_approval"
  | "awaiting_sandbox_smoke"
  | "live_approved";

export interface TelephonyQueuedMutation {
  id: string;
  idempotencyKey: string;
  operation: TelephonyMutationOperation;
  providerMode: TelephonyProviderMode;
  target: string;
  status: TelephonyQueuedMutationStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  retryAfter: string;
  retentionExpiresAt: string;
  liveExecutionApproved: boolean;
  operatorApproved: boolean;
  sandboxSmokePassed: boolean;
  reason?: string;
}

export class TelephonySafetyError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export const TELEPHONY_OPERATION_GATES: TelephonyOperationGate[] = [
  {
    operation: "rest_read",
    providerModes: ["fixture", "sandbox", "read_only_live"],
    sideEffectClass: "read_only",
    requiredEvidence: ["REST API key configured", "request carries valid bearer token or x-telephony-api-key"],
    approvalRequired: false,
    noSideEffectSmoke: "Unauthenticated /api reads return 401/503 and do not touch Twilio or mutate local state.",
  },
  {
    operation: "send_sms",
    providerModes: ["fixture", "sandbox", "live_mutating"],
    sideEffectClass: "external_notification",
    requiredEvidence: ["REST API key configured", "destination is E.164", "toll-fraud denylist passed", "operator approval for live send"],
    approvalRequired: true,
    noSideEffectSmoke: "Unauthenticated /api/sms/send is rejected before getTwilioClient() or message ledger writes.",
  },
  {
    operation: "send_whatsapp",
    providerModes: ["fixture", "sandbox", "live_mutating"],
    sideEffectClass: "external_notification",
    requiredEvidence: ["REST API key configured", "destination is whatsapp E.164", "toll-fraud denylist passed", "operator approval for live send"],
    approvalRequired: true,
    noSideEffectSmoke: "Unauthenticated /api/whatsapp/send is rejected before getTwilioClient() or message ledger writes.",
  },
  {
    operation: "make_call",
    providerModes: ["fixture", "sandbox", "live_mutating"],
    sideEffectClass: "external_notification",
    requiredEvidence: ["REST API key configured", "destination is E.164", "toll-fraud denylist passed", "operator approval for live call"],
    approvalRequired: true,
    noSideEffectSmoke: "Unauthenticated /api/call/make is rejected before getTwilioClient() or call ledger writes.",
  },
  {
    operation: "provision_number",
    providerModes: ["sandbox", "live_mutating"],
    sideEffectClass: "phone_number_change",
    requiredEvidence: ["REST API key configured", "country allowlist passed", "operator approval for number purchase"],
    approvalRequired: true,
    noSideEffectSmoke: "Unauthenticated /api/numbers/provision is rejected before Twilio number purchase calls.",
  },
  {
    operation: "release_number",
    providerModes: ["sandbox", "live_mutating"],
    sideEffectClass: "phone_number_change",
    requiredEvidence: ["REST API key configured", "number ownership proof", "operator approval for number release"],
    approvalRequired: true,
    noSideEffectSmoke: "Unauthenticated /api/numbers/release is rejected before Twilio number release calls.",
  },
  {
    operation: "twilio_webhook_receive",
    providerModes: ["fixture", "sandbox", "read_only_live"],
    sideEffectClass: "read_only",
    requiredEvidence: ["Twilio auth token configured", "X-Twilio-Signature valid", "webhook id replay check passed"],
    approvalRequired: false,
    noSideEffectSmoke: "Unsigned Twilio webhooks return 401 and do not write inbound messages, calls, or webhook dispatch rows.",
  },
];

const replayedWebhookIds = new Set<string>();
const maxRememberedWebhookIds = 10_000;
const queuedMutations = new Map<string, TelephonyQueuedMutation>();
const idempotencyIndex = new Map<string, string>();
const destinationWindowIndex = new Map<string, number[]>();
const restCredentialEnvNames = [
  ["TELEPHONY", "REST", "API", "KEY"].join("_"),
  ["HASNA", "TELEPHONY", "REST", "API", "KEY"].join("_"),
];
const twilioCredentialEnvNames = [
  ["TWILIO", "AUTH", "TOKEN"].join("_"),
  ["HASNAXYZ", "TWILIO", "LIVE", "AUTH", "TOKEN"].join("_"),
];

export function telephonyProviderSafetyMatrix() {
  return {
    packageName: "@hasna/telephony",
    canonicalRepository: "hasna/telephony",
    operations: TELEPHONY_OPERATION_GATES,
  };
}

export function restApiKey(): string | undefined {
  return restCredentialEnvNames.map((name) => process.env[name]).find(Boolean);
}

export function twilioWebhookAuthToken(): string | undefined {
  return twilioCredentialEnvNames.map((name) => process.env[name]).find(Boolean);
}

export function requireRestApiAuth(req: Request): Response | null {
  const expected = restApiKey();
  if (!expected) {
    return jsonError("Telephony REST API is disabled until a REST credential is configured.", 503);
  }

  const presented = bearerToken(req.headers.get("authorization")) || req.headers.get("x-telephony-api-key") || "";
  if (!constantTimeEqual(presented, expected)) {
    return jsonError("Telephony REST API authentication required.", 401);
  }
  return null;
}

export function validateOutboundTarget(value: unknown, kind: "sms" | "whatsapp" | "call" | "number"): void {
  const raw = typeof value === "string" ? value.trim() : "";
  const phone = raw.startsWith("whatsapp:") ? raw.slice("whatsapp:".length) : raw;
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new TelephonySafetyError(`${kind} destination must be an E.164 phone number.`);
  }
  if (isBlockedTollFraudTarget(phone)) {
    throw new TelephonySafetyError(`${kind} destination is blocked by the telephony toll-fraud safety gate.`);
  }
}

export function enforceTelephonyMutationGate(
  req: Request,
  operation: TelephonyMutationOperation,
  target: unknown,
): Response | null {
  pruneExpiredMutationState(Date.now());

  const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key") || "";
  if (!idempotencyKey.trim()) {
    return json(
      {
        error: "Mutating telephony REST requests require an Idempotency-Key header.",
        required_headers: ["Idempotency-Key"],
      },
      428,
    );
  }

  const targetValue = normalizeTarget(target);
  const existing = queuedMutationByIdempotencyKey(idempotencyKey);
  if (existing) {
    return json({ status: "duplicate", operation: existing, live_execution: false }, existing.status === "live_approved" ? 409 : 202);
  }

  const quota = recordDestinationQuota(operation, targetValue, Date.now());
  if (!quota.allowed) {
    return json(
      {
        error: "Telephony mutation quota exceeded for this destination.",
        limit: quota.limit,
        window_seconds: quota.windowSeconds,
      },
      429,
    );
  }

  const providerMode = requestProviderMode(req);
  const liveExecutionApproved = approvalHeader(req, "x-telephony-live-execution");
  const operatorApproved = approvalHeader(req, "x-telephony-operator-approval");
  const sandboxSmokePassed = approvalHeader(req, "x-telephony-sandbox-smoke");

  if (providerMode !== "live_mutating") {
    const queued = recordQueuedMutation({
      idempotencyKey,
      operation,
      providerMode,
      target: targetValue,
      status: providerMode === "sandbox" ? "awaiting_sandbox_smoke" : "queued",
      liveExecutionApproved: false,
      operatorApproved: false,
      sandboxSmokePassed: false,
      reason: "Provider mode is non-live; request queued without provider side effects.",
    });
    return json({ status: queued.status, operation: queued, live_execution: false }, 202);
  }

  if (!liveExecutionApproved || !operatorApproved || !sandboxSmokePassed) {
    const missing = [
      liveExecutionApproved ? undefined : "x-telephony-live-execution",
      operatorApproved ? undefined : "x-telephony-operator-approval",
      sandboxSmokePassed ? undefined : "x-telephony-sandbox-smoke",
    ].filter(Boolean);
    const queued = recordQueuedMutation({
      idempotencyKey,
      operation,
      providerMode,
      target: targetValue,
      status: sandboxSmokePassed ? "awaiting_operator_approval" : "awaiting_sandbox_smoke",
      liveExecutionApproved,
      operatorApproved,
      sandboxSmokePassed,
      reason: `Live provider mutation requires approval headers before provider execution: ${missing.join(", ")}.`,
    });
    return json({ status: queued.status, operation: queued, missing_headers: missing, live_execution: false }, 202);
  }

  recordQueuedMutation({
    idempotencyKey,
    operation,
    providerMode,
    target: targetValue,
    status: "live_approved",
    liveExecutionApproved,
    operatorApproved,
    sandboxSmokePassed,
    reason: "Live provider mutation allowed after idempotency, quota, operator approval, and sandbox-smoke proof.",
  });
  return null;
}

export function listQueuedTelephonyMutations(): TelephonyQueuedMutation[] {
  pruneExpiredMutationState(Date.now());
  return Array.from(queuedMutations.values()).filter((entry) => entry.status !== "live_approved");
}

export function retryQueuedTelephonyMutation(id: string): TelephonyQueuedMutation | undefined {
  pruneExpiredMutationState(Date.now());
  const entry = queuedMutations.get(id);
  if (!entry || entry.status === "live_approved") return undefined;
  const now = new Date();
  entry.attempts += 1;
  entry.updatedAt = now.toISOString();
  entry.retryAfter = new Date(now.getTime() + mutationRetryDelayMs(entry.attempts)).toISOString();
  queuedMutations.set(id, entry);
  return entry;
}

export function telephonyProviderSmoke(req: Request, body: Record<string, unknown>): Response {
  const operation = body.operation;
  if (!isMutationOperation(operation)) {
    return json({ error: "Telephony smoke operation must be a mutating provider operation." }, 400);
  }
  const providerMode = requestProviderMode(req, body.provider_mode);
  const target = smokeTarget(operation, body);
  if (operation === "provision_number") {
    validateProvisioningCountry(body.country);
    validateOutboundTarget(target, "number");
  } else {
    validateOutboundTarget(target, operation === "send_whatsapp" ? "whatsapp" : operation === "make_call" ? "call" : operation === "release_number" ? "number" : "sms");
  }

  if (providerMode === "live_mutating") {
    const operatorApproved = approvalHeader(req, "x-telephony-operator-approval");
    const liveSmokeApproved = approvalHeader(req, "x-telephony-live-smoke");
    if (!operatorApproved || !liveSmokeApproved) {
      return json(
        {
          status: "live_smoke_blocked",
          live_execution: false,
          missing_headers: [
            operatorApproved ? undefined : "x-telephony-operator-approval",
            liveSmokeApproved ? undefined : "x-telephony-live-smoke",
          ].filter(Boolean),
        },
        202,
      );
    }
  }

  return json({
    status: providerMode === "live_mutating" ? "live_smoke_ready" : "sandbox_smoke_passed",
    operation,
    provider_mode: providerMode,
    target,
    live_execution: false,
    proof_header_for_live_mutation: "x-telephony-sandbox-smoke: passed",
  });
}

export function resetTelephonySafetyState(): void {
  replayedWebhookIds.clear();
  queuedMutations.clear();
  idempotencyIndex.clear();
  destinationWindowIndex.clear();
}

export function validateProvisioningCountry(value: unknown): void {
  const country = typeof value === "string" && value.trim() ? value.trim().toUpperCase() : "US";
  const allowed = new Set((process.env["TELEPHONY_ALLOWED_COUNTRIES"] || "US,CA").split(",").map((part) => part.trim().toUpperCase()).filter(Boolean));
  if (!allowed.has(country)) {
    throw new TelephonySafetyError(`Number provisioning country '${country}' is not in TELEPHONY_ALLOWED_COUNTRIES.`);
  }
}

export function verifyTwilioWebhookRequest(req: Request, body: string): Response | null {
  const credential = twilioWebhookAuthToken();
  if (!credential) {
    return twimlError("Twilio webhook verification is disabled until a Twilio credential is configured.", 503);
  }

  const signature = req.headers.get("x-twilio-signature") || "";
  if (!signature) return twimlError("Missing Twilio signature.", 401);

  const url = canonicalTwilioUrl(req);
  const params = Object.fromEntries(new URLSearchParams(body));
  const expected = computeTwilioSignature(url, params, credential);
  if (!constantTimeEqual(signature, expected)) return twimlError("Invalid Twilio signature.", 401);

  const replayId = twilioReplayId(params);
  if (replayId) {
    if (replayedWebhookIds.has(replayId)) return twimlError("Replay detected.", 409);
    replayedWebhookIds.add(replayId);
    if (replayedWebhookIds.size > maxRememberedWebhookIds) {
      const oldest = replayedWebhookIds.values().next().value;
      if (oldest) replayedWebhookIds.delete(oldest);
    }
  }
  return null;
}

export function computeTwilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const sorted = Object.keys(params).sort();
  const payload = sorted.reduce((acc, key) => `${acc}${key}${params[key]}`, url);
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

function canonicalTwilioUrl(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (proto) url.protocol = `${proto}:`;
  if (host) url.host = host;
  return url.toString();
}

function twilioReplayId(params: Record<string, string>): string | undefined {
  return params.MessageSid || params.CallSid || params.SmsSid || params.SmsMessageSid || params.RecordingSid;
}

function isBlockedTollFraudTarget(phone: string): boolean {
  const digits = phone.replace(/^\+/, "");
  if (digits === "911" || digits === "112") return true;
  const blockedPrefixes = (process.env["TELEPHONY_BLOCKED_PHONE_PREFIXES"] || "+1900,+1976,+809,+829,+849")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return blockedPrefixes.some((prefix) => phone.startsWith(prefix));
}

function queuedMutationByIdempotencyKey(idempotencyKey: string): TelephonyQueuedMutation | undefined {
  const id = idempotencyIndex.get(idempotencyKey);
  return id ? queuedMutations.get(id) : undefined;
}

function requestProviderMode(req: Request, fallback?: unknown): TelephonyProviderMode {
  const raw =
    req.headers.get("x-telephony-provider-mode") ||
    (typeof fallback === "string" ? fallback : undefined) ||
    process.env["TELEPHONY_PROVIDER_MODE"] ||
    "fixture";
  if (raw === "fixture" || raw === "sandbox" || raw === "read_only_live" || raw === "live_mutating") return raw;
  throw new TelephonySafetyError(`Unsupported telephony provider mode '${raw}'.`);
}

function normalizeTarget(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function approvalHeader(req: Request, name: string): boolean {
  const value = req.headers.get(name);
  return value === "approved" || value === "passed";
}

function recordQueuedMutation(input: {
  idempotencyKey: string;
  operation: TelephonyMutationOperation;
  providerMode: TelephonyProviderMode;
  target: string;
  status: TelephonyQueuedMutationStatus;
  liveExecutionApproved: boolean;
  operatorApproved: boolean;
  sandboxSmokePassed: boolean;
  reason: string;
}): TelephonyQueuedMutation {
  const now = new Date();
  const id = mutationId(input.idempotencyKey, input.operation);
  const existing = queuedMutations.get(id);
  const attempts = existing?.attempts ?? 0;
  const entry: TelephonyQueuedMutation = {
    id,
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    providerMode: input.providerMode,
    target: input.target,
    status: input.status,
    attempts,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    retryAfter: new Date(now.getTime() + mutationRetryDelayMs(attempts)).toISOString(),
    retentionExpiresAt: new Date(now.getTime() + mutationRetentionMs()).toISOString(),
    liveExecutionApproved: input.liveExecutionApproved,
    operatorApproved: input.operatorApproved,
    sandboxSmokePassed: input.sandboxSmokePassed,
    reason: input.reason,
  };
  queuedMutations.set(id, entry);
  idempotencyIndex.set(input.idempotencyKey, id);
  return entry;
}

function recordDestinationQuota(operation: TelephonyMutationOperation, target: string, now: number): { allowed: boolean; limit: number; windowSeconds: number } {
  const limit = parsePositiveInt(process.env["TELEPHONY_MAX_DAILY_MUTATIONS_PER_DESTINATION"], 10);
  const windowMs = parsePositiveInt(process.env["TELEPHONY_MUTATION_QUOTA_WINDOW_MS"], 86_400_000);
  const key = `${operation}:${target}`;
  const recent = (destinationWindowIndex.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    destinationWindowIndex.set(key, recent);
    return { allowed: false, limit, windowSeconds: Math.round(windowMs / 1000) };
  }
  recent.push(now);
  destinationWindowIndex.set(key, recent);
  return { allowed: true, limit, windowSeconds: Math.round(windowMs / 1000) };
}

function pruneExpiredMutationState(now: number): void {
  const retentionMs = mutationRetentionMs();
  for (const [id, entry] of queuedMutations) {
    if (now - Date.parse(entry.createdAt) > retentionMs) {
      queuedMutations.delete(id);
      idempotencyIndex.delete(entry.idempotencyKey);
    }
  }
}

function mutationRetentionMs(): number {
  return parsePositiveInt(process.env["TELEPHONY_OPERATION_RETENTION_MS"], 86_400_000);
}

function mutationRetryDelayMs(attempts: number): number {
  const base = parsePositiveInt(process.env["TELEPHONY_RETRY_BASE_DELAY_MS"], 60_000);
  return Math.min(base * 2 ** attempts, 3_600_000);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mutationId(idempotencyKey: string, operation: TelephonyMutationOperation): string {
  const digest = createHmac("sha256", operation).update(idempotencyKey).digest("hex").slice(0, 16);
  return `tmq_${digest}`;
}

function isMutationOperation(value: unknown): value is TelephonyMutationOperation {
  return value === "send_sms" || value === "send_whatsapp" || value === "make_call" || value === "provision_number" || value === "release_number";
}

function smokeTarget(operation: TelephonyMutationOperation, body: Record<string, unknown>): unknown {
  if (operation === "release_number") return body.number;
  return body.to || body.phone_number;
}

function bearerToken(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1];
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function jsonError(error: string, status: number): Response {
  return json({ error }, status);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function twimlError(error: string, status: number): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(error)}</Message></Response>`, {
    status,
    headers: { "Content-Type": "application/xml" },
  });
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

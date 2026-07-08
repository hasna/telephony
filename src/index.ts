// Embeddable SDK (routes through the Store — works local and self_hosted/cloud)
export { TelephonyClient, createClient } from "./sdk.js";
export type { TelephonyClientOptions } from "./sdk.js";

// Generated typed SDK client (from the telephony-serve OpenAPI document)
export { TelephonyApiClient } from "./generated/telephony-api-client.js";

// ── The single Store abstraction (LocalStore + ApiStore) ─────────────────────
// EVERY read/write goes through this. `getStore()` resolves local vs cloud from
// the client-flip env. Callers never touch sqlite or fetch directly.
export {
  getStore,
  resetStore,
  isCloudStore,
  LocalStore,
  ApiStore,
  CloudUnsupportedError,
  TELEPHONY_APP,
} from "./lib/store/index.js";
export type {
  TelephonyStore,
  CreateMessageInput,
  CreateCallInput,
  CreateVoicemailInput,
  CreatePhoneNumberInput,
  FeedbackInput,
  MessageFilters,
  CallFilters,
  VoicemailFilters,
  ScheduleFilters,
} from "./lib/store/index.js";

// Server bootstrap + cloud storage (self_hosted service side, PURE REMOTE)
export { createTelephonyCloudClient, PgAdapterAsync, TELEPHONY_APP_NAME } from "./db/remote-storage.js";
export { telephonyOpenApi, startTelephonyServe, createServeHandler, TELEPHONY_SERVE_APP } from "./server/cloud-serve.js";

// Lib: Twilio
export { getTwilioClient, getDefaultPhoneNumber, hasTwilioConfig } from "./lib/twilio.js";

// Lib: Provisioning
export { searchAvailableNumbers, provisionNumber, releaseNumber, configureNumber, listTwilioNumbers } from "./lib/provisioning.js";

// Lib: SMS
export { sendSms, handleInboundSms } from "./lib/sms.js";

// Lib: WhatsApp
export { sendWhatsApp, sendWhatsAppAudio, handleInboundWhatsApp } from "./lib/whatsapp.js";

// Lib: Voice
export { makeCall, endCall, getCallStatus, handleInboundCall, generateTwiml } from "./lib/voice.js";

// Lib: Voicemail
export { setGreeting, getGreetingPath, handleVoicemailRecording } from "./lib/voicemail.js";

// Lib: TTS
export { generateSpeech, listVoices } from "./lib/tts.js";

// Lib: STT
export { transcribe, transcribeUrl } from "./lib/stt.js";

// Lib: Audio
export { saveAudio, loadAudio, encodeBase64, audioExists, generateAudioFilename, getAudioDir } from "./lib/audio.js";

// Lib: Cerebras AI
export { generateSchedule, generateMessage, analyzeIncomingMessage } from "./lib/cerebras.js";

// Lib: Realtime (public webhook mode)
export { isCloudMode, createRealtimeSession, connectOpenAI, handleTwilioMediaStream, closeSession as closeRealtimeSession, generateRealtimeTwiml } from "./lib/realtime.js";

// Lib: Scheduler
export { runSchedule, tick, startScheduler, stopScheduler } from "./lib/scheduler.js";

// Lib: Config
export { getConfig, requireConfig } from "./lib/config.js";

// Lib: Safety gates
export {
  computeTwilioSignature,
  enforceTelephonyMutationGate,
  listQueuedTelephonyMutations,
  requireRestApiAuth,
  resetTelephonySafetyState,
  retryQueuedTelephonyMutation,
  telephonyProviderSafetyMatrix,
  telephonyProviderSmoke,
  TELEPHONY_OPERATION_GATES,
  validateOutboundTarget,
  validateProvisioningCountry,
  verifyTwilioWebhookRequest,
} from "./lib/safety.js";
export type {
  TelephonyMutationOperation,
  TelephonyOperation,
  TelephonyOperationGate,
  TelephonyProviderMode,
  TelephonyQueuedMutation,
  TelephonyQueuedMutationStatus,
} from "./lib/safety.js";

// PG Migrations (external PostgreSQL deployments)
export { PG_MIGRATIONS } from "./lib/pg-migrations.js";

// Types
export type * from "./types/index.js";

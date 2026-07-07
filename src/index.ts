// REST SDK Client (legacy hand-rolled client, kept for compatibility)
export { TelephonyClient, createClient } from "./sdk.js";
export type { TelephonyClientOptions } from "./sdk.js";

// Generated typed SDK client (from the telephony-serve OpenAPI document)
export { TelephonyApiClient } from "./generated/telephony-api-client.js";

// Cloud storage (PURE REMOTE / Amendment A1)
export { createTelephonyCloudClient, PgAdapterAsync, TELEPHONY_APP_NAME } from "./db/remote-storage.js";
export { telephonyOpenApi, startTelephonyServe, createServeHandler, TELEPHONY_SERVE_APP } from "./server/cloud-serve.js";

// Core database
export { getDatabase, closeDatabase, resetDatabase, resolvePartialId, now, uuid } from "./db/database.js";

// Agents
export { registerAgent, getAgent, getAgentByName, listAgents, heartbeat, releaseAgent, deleteAgent } from "./db/agents.js";

// Projects
export { createProject, getProject, getProjectByPath, listProjects, updateProject, deleteProject } from "./db/projects.js";

// Sessions
export { createSession, getSession, listSessions, updateSessionActivity } from "./db/sessions.js";

// Phone Numbers
export { createPhoneNumber, getPhoneNumber, getPhoneNumberByNumber, listPhoneNumbers, assignPhoneNumber, releasePhoneNumberDb, deletePhoneNumber } from "./db/phone-numbers.js";

// Messages
export { createMessage, getMessage, listMessages, searchMessages, getConversation, updateMessageStatus } from "./db/messages.js";

// Calls
export { createCall, getCall, listCalls, updateCallStatus } from "./db/calls.js";

// Voicemails
export { createVoicemail, getVoicemail, listVoicemails, markVoicemailListened, deleteVoicemail } from "./db/voicemails.js";

// Contacts
export { createContact, getContact, listContacts, searchContacts, updateContact, deleteContact } from "./db/contacts.js";

// Schedules
export { createSchedule, getSchedule, listSchedules, enableSchedule, disableSchedule, deleteSchedule, markScheduleRun, getDueSchedules, computeNextRun } from "./db/schedules.js";

// Webhooks
export { createWebhook, getWebhook, listWebhooks, deleteWebhook, dispatchWebhook } from "./db/webhooks.js";

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

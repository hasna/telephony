/**
 * Stable public exports for the telephony cloud HTTP service.
 *
 * Implementation lives in focused runtime, handler, route, serialization, and
 * OpenAPI modules so each concern can evolve independently.
 */
export { createServeHandler, type ServeDeps } from "./cloud-handler.js";
export { telephonyOpenApi } from "./cloud-openapi.js";
export {
  normalizeCloudDatabaseUrl,
  startTelephonyServe,
  TELEPHONY_SERVE_APP,
  type RunningServe,
  type StartServeOptions,
} from "./cloud-runtime.js";

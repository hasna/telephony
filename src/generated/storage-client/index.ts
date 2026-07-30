// Vendored Hasna client-flip HTTP storage client.
//
// Extracted from `@hasna/contracts` (`src/client/*`) so the telephony CLI/MCP
// can route reads AND writes to the server's `/v1` API when the client-flip env
// resolves to server-backed data (HASNA_TELEPHONY_STORAGE_MODE=postgres +
// HASNA_TELEPHONY_API_URL + HASNA_TELEPHONY_API_KEY). Only the mode enum is
// imported from the package (see ./mode.ts); the transport seam stays vendored.
//
// See ../../lib/store/index.ts for the telephony-specific Store (LocalStore +
// ApiStore) and resolver.
export * from "./mode.js";
export * from "./transport.js";
export * from "./storage.js";

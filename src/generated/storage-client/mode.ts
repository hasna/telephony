// Self-contained storage-mode helpers for the vendored client-flip transport.
//
// This is a minimal, dependency-free extract of the canonical
// `@hasna/contracts` mode helpers (normalizeStorageMode / envToken). It is
// vendored here — alongside the vendored `storage-kit` — so the CLIENT cloud
// transport does not need an unreleased `@hasna/contracts` subpath at runtime.
//
// Two runtime modes only (Amendment A1):
//   - `local` : on-box SQLite is authoritative.
//   - `cloud` : reads AND writes go to the app's cloud `/v1` HTTP API.
// The words `remote`, `hybrid`, and `self_hosted` are accepted as deprecated
// aliases that normalize to `cloud` (a self-hosted server is `cloud` pointed at
// a private API URL).

export type Env = Record<string, string | undefined>;

export type StorageMode = "local" | "cloud";

export const DEPRECATED_STORAGE_MODE_ALIASES = ["remote", "hybrid", "self_hosted"] as const;

export interface StorageModeNormalization {
  mode: StorageMode;
  /** The deprecated alias that was normalized to `cloud`, if any. */
  deprecatedAlias: string | null;
}

/**
 * Normalize a raw storage-mode string to the `local | cloud` runtime enum.
 * Accepts deprecated aliases (`remote`, `hybrid`, `self_hosted`) and maps them
 * to `cloud`. Throws on any other value.
 */
export function normalizeStorageMode(value: string): StorageModeNormalization {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local") return { mode: "local", deprecatedAlias: null };
  if (normalized === "cloud") return { mode: "cloud", deprecatedAlias: null };
  if ((DEPRECATED_STORAGE_MODE_ALIASES as readonly string[]).includes(normalized)) {
    return { mode: "cloud", deprecatedAlias: normalized };
  }
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}

/** Upper-snake env token for an app name, e.g. `telephony` -> `TELEPHONY`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

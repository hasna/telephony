// Storage-backend helpers for the vendored client-flip transport.
//
// These are RE-EXPORTED from `@hasna/contracts/mode` rather than hand-copied.
// The copy that used to live here drifted: it still spoke the removed
// `local | cloud | self_hosted` placement vocabulary long after the vendored kit
// and hasna.contract.json moved to the data-backend switch, so the published
// manifest advertised a configuration the shipped CLI rejected. Re-exporting
// keeps the client's mode enum in lockstep with the pinned contract by
// construction, so that drift cannot reopen.
//
// The runtime-placement axis was removed (owner directive 2026-07-29). The only
// switch is the data backend the app's rows live in:
//   - `sqlite`   : the on-box SQLite file is authoritative.
//   - `postgres` : the rows live in a PostgreSQL server, which a CLIENT reaches
//     over that server's `/v1` HTTP API — never by opening PostgreSQL directly.
// `postgresql` is accepted as the long spelling of `postgres`; every other value
// (including every removed placement word) throws.
//
// Only the mode enum comes from the package. The transport/credential seam
// beside this file stays vendored — un-vendoring that is the separate migration
// documented in src/contract.test.ts.

export { envToken, normalizeStorageMode, type StorageModeNormalization } from "@hasna/contracts/mode";
export type { StorageMode } from "@hasna/contracts/schemas";

export type Env = Record<string, string | undefined>;

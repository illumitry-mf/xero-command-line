# GSM Token Storage Design

**Date:** 2026-04-15
**Status:** Approved

## Problem

The Xero CLI stores OAuth tokens in a local file (`~/.config/xero-command-line/tokens.json`). In a Docker container this file does not persist across restarts, and the env var token approach (`XERO_ACCESS_TOKEN` etc.) breaks down when tokens expire because the refresh loop always reads the stale env var rather than the newly written cache.

The goal is a token backend that:
- Persists across container restarts
- Supports automatic token refresh with write-back
- Is seeded from an interactive login without a separate seed command
- Works with a GCP service account key file

## Architecture

The token backend becomes pluggable via a `XERO_TOKEN_STORE` env var. The two choke points in `src/lib/auth.ts` — `getCachedTokenSet` and `cacheTokenSet` — check the mode and route accordingly. No other files change.

Priority order in `getCachedTokenSet`:

1. `XERO_TOKEN_STORE=gsm` → read from GSM (new path)
2. `XERO_ACCESS_TOKEN` + `XERO_REFRESH_TOKEN` + `XERO_TENANT_ID` all set → env var tokens (existing)
3. Otherwise → local file cache (existing)

A new file `src/lib/gsm-token-store.ts` encapsulates all GSM interaction. `auth.ts` calls `getTokenFromGsm` / `saveTokenToGsm` — it has no direct dependency on the GSM SDK.

## Configuration

| Env var | Required when | Purpose |
|---------|--------------|---------|
| `XERO_TOKEN_STORE=gsm` | Always for GSM mode | Activates GSM backend |
| `XERO_GCP_PROJECT` | GSM mode | GCP project ID |
| `XERO_GSM_SECRET_NAME` | GSM mode | Secret ID in GSM (e.g. `xero-tokens-acme`) — one per Xero profile |
| `GOOGLE_APPLICATION_CREDENTIALS` | GSM mode | Path to service account key file |
| `XERO_CLIENT_ID` | GSM mode (no profile file in container) | Xero OAuth client ID |
| `XERO_TENANT_ID` | GSM mode | Xero tenant ID for API calls |

The GSM store constructs the full resource path as `projects/{XERO_GCP_PROJECT}/secrets/{XERO_GSM_SECRET_NAME}`.

One GSM secret per Xero profile. The secret value is the `TokenEntry` JSON blob — same shape as entries in `tokens.json` today:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1744000000000,
  "tenantId": "...",
  "tenantName": "Acme Corp"
}
```

## New Files

### `src/lib/gsm-token-store.ts`

Exports two functions:

```ts
getTokenFromGsm(secretName: string, projectId: string): Promise<TokenEntry | null>
saveTokenToGsm(secretName: string, projectId: string, entry: TokenEntry): Promise<void>
```

- Uses `@google-cloud/secret-manager` SDK
- `getTokenFromGsm` accesses `projects/{projectId}/secrets/{secretName}/versions/latest`, parses the JSON payload, returns `TokenEntry` or `null` if the secret does not exist
- `saveTokenToGsm` adds a new secret version with the serialised `TokenEntry`
- Both functions let SDK errors propagate with a clear prefix message

## Changed Files

### `src/lib/auth.ts`

`getCachedTokenSet`:
- If `XERO_TOKEN_STORE === 'gsm'`: validate `XERO_GCP_PROJECT` and `XERO_GSM_SECRET_NAME` are set (throw a clear error if not), then call `getTokenFromGsm`
- Existing env var and file cache paths unchanged

`cacheTokenSet`:
- If `XERO_TOKEN_STORE === 'gsm'`: call `saveTokenToGsm` instead of writing to the file cache
- Existing file cache path unchanged

### `package.json`

Add `@google-cloud/secret-manager` as a production dependency.

## Seeding Flow (Interactive → Docker)

Run `xero login` once on an interactive machine with the GSM env vars set:

```bash
XERO_TOKEN_STORE=gsm \
XERO_GCP_PROJECT=my-project \
XERO_GSM_SECRET_NAME=xero-tokens-acme \
GOOGLE_APPLICATION_CREDENTIALS=./sa-key.json \
XERO_CLIENT_ID=<client-id> \
xero login
```

The browser OAuth flow completes → `cacheTokenSet` is called → `saveTokenToGsm` creates the initial secret version. No separate seed command is needed.

## Refresh & Write-Back Flow (Docker)

1. Command runs → `getCachedTokenSet` reads the latest GSM secret version → returns `TokenEntry` with a real `expiresAt` timestamp
2. `isTokenExpired` evaluates against the real timestamp — proactive refresh fires correctly when the token is within 60 seconds of expiry
3. `refreshAccessToken` fetches a new token pair from Xero (refresh token rotation applies — old refresh token is invalidated)
4. `cacheTokenSet` calls `saveTokenToGsm` → creates a new GSM secret version with the updated `TokenEntry`
5. The retry in `withRetry` reads the freshly written GSM secret and succeeds

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Secret does not exist in GSM | Return `null` → existing "Not logged in" error. Message updated to hint: "Run `xero login` with XERO_TOKEN_STORE=gsm to seed." |
| `XERO_GCP_PROJECT` or `XERO_GSM_SECRET_NAME` missing | Throw at `getCachedTokenSet` / `cacheTokenSet` call time: "XERO_GCP_PROJECT and XERO_GSM_SECRET_NAME are required when XERO_TOKEN_STORE=gsm" |
| `GOOGLE_APPLICATION_CREDENTIALS` missing or invalid | GSM SDK throws — surface as: "GSM auth failed — check GOOGLE_APPLICATION_CREDENTIALS" |
| GSM write failure during refresh | Hard fail — if the new token cannot be written back, the next container start would use a stale token, so failing immediately is safer |

## Dependencies

- Add `@google-cloud/secret-manager` to `dependencies` in `package.json`
- No other new dependencies

## Out of Scope

- Multiple profiles per GSM secret (one secret per profile is the design)
- GKE Workload Identity or other GCP auth mechanisms (service account key file only)
- A `xero token push` / `xero token pull` command (seeding via `xero login` is sufficient)
- Encryption of the secret value beyond what GSM provides natively

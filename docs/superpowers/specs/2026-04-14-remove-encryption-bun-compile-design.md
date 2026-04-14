# Remove Encryption + Bun Compile for Docker

## Goal

Remove the AES-256-GCM encryption layer and `@napi-rs/keyring` dependency from token storage. Add environment variable override for tokens. Package the CLI as a single binary via Bun compile for use in Docker containers.

## Phase 1: Remove encryption, add env var override

### Delete `src/lib/crypto.ts`

The entire file is removed. All encryption (AES-256-GCM), keyring (`@napi-rs/keyring`), and key management code goes away.

### Simplify `src/lib/auth.ts`

**Remove:**
- `EncryptedTokenEntry` interface
- Import of `encrypt`, `decrypt`, `getOrCreateKey` from `crypto.js`
- All `encrypt()`/`decrypt()` calls in `getCachedTokenSet()` and `cacheTokenSet()`

**Add env var override to `getCachedTokenSet()`:**
- Before checking the file cache, check for `XERO_ACCESS_TOKEN`, `XERO_REFRESH_TOKEN`, `XERO_TENANT_ID` env vars
- If all three are present, return a `TokenEntry` with `expiresAt: Infinity` (env var tokens are assumed valid; the caller handles 401s)
- Optional `XERO_TENANT_NAME` env var
- Env vars take full precedence — file cache is not consulted

**Plaintext storage:**
- `cacheTokenSet()` stores `accessToken` and `refreshToken` as plain strings
- File is still written with `mode: 0o600`
- The `TokenEntry` interface is reused for both in-memory and on-disk representation (no separate `EncryptedTokenEntry`)

### Env var precedence

```
XERO_ACCESS_TOKEN + XERO_REFRESH_TOKEN + XERO_TENANT_ID  →  returned directly
~/.config/xero-command-line/tokens.json                    →  fallback (plaintext)
Neither                                                    →  null (triggers "Not logged in" error)
```

### Remove `@napi-rs/keyring` dependency

- Remove from `package.json` `dependencies`
- Run `npm install` to update `package-lock.json`

### Update tests (`test/lib/auth.test.ts`)

- Remove the `vi.mock('../../src/lib/crypto.js')` block
- Remove the `TEST_KEY` constant
- Add tests for env var override path (set `process.env`, verify returned values, clean up)

### Update `CLAUDE.md`

- Remove the `src/lib/crypto.ts` row from the key lib modules table
- Update the `src/lib/auth.ts` description to mention env var override

## Phase 2: Bun compile packaging

### Generate `oclif.manifest.json`

Run `npx oclif manifest` to create a static command index. This eliminates oclif's filesystem scanning at runtime, which is required for single-binary packaging.

### Add build script

Add to `package.json` scripts:
```json
"build:binary": "npm run build && npx oclif manifest && bun build ./bin/run.js --compile --target=bun-linux-arm64 --outfile xero"
```

### Add Dockerfile

```dockerfile
FROM debian:bookworm-slim
COPY xero /usr/local/bin/xero
ENTRYPOINT ["xero"]
```

### Add `oclif.manifest.json` to `.gitignore`

It's a generated build artifact.

## Files changed

| File | Action |
|------|--------|
| `src/lib/crypto.ts` | Delete |
| `src/lib/auth.ts` | Simplify (remove encryption, add env var override) |
| `test/lib/auth.test.ts` | Update (remove crypto mock, add env var tests) |
| `package.json` | Remove `@napi-rs/keyring`, add `build:binary` script |
| `CLAUDE.md` | Update lib modules table |
| `.gitignore` | Add `oclif.manifest.json` |
| `Dockerfile` | Create |

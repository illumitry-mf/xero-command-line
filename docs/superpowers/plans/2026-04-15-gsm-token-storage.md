# GSM Token Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Secret Manager as a pluggable token backend so the Xero CLI works reliably in Docker containers without a persistent filesystem.

**Architecture:** A new `src/lib/gsm-token-store.ts` encapsulates all GSM SDK interaction. `src/lib/auth.ts` checks `XERO_TOKEN_STORE=gsm` at the top of `getCachedTokenSet` and `cacheTokenSet` and routes to the GSM functions — all other code paths remain unchanged.

**Tech Stack:** `@google-cloud/secret-manager` SDK, vitest (existing), TypeScript Node16 modules.

---

## File Map

| File | Change |
|------|--------|
| `package.json` | Add `@google-cloud/secret-manager` to `dependencies` |
| `src/lib/gsm-token-store.ts` | **Create** — `getTokenFromGsm`, `saveTokenToGsm` |
| `src/lib/auth.ts` | Make `getCachedTokenSet` / `cacheTokenSet` async; add GSM routing at top of each |
| `src/lib/xero-client.ts` | Update "Not logged in" error to hint at GSM seeding |
| `test/lib/gsm-token-store.test.ts` | **Create** — unit tests for GSM store functions |
| `test/lib/auth.test.ts` | **Create** — unit tests for GSM routing in auth functions |

---

## Task 1: Install `@google-cloud/secret-manager`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

```bash
npm install @google-cloud/secret-manager
```

Expected output: package added to `node_modules` and `package.json` `dependencies`.

- [ ] **Step 2: Verify it appears in package.json**

```bash
grep secret-manager package.json
```

Expected: `"@google-cloud/secret-manager": "^x.x.x"` under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @google-cloud/secret-manager dependency"
```

---

## Task 2: Create `gsm-token-store.ts` — write failing tests first

**Files:**
- Create: `test/lib/gsm-token-store.test.ts`
- Create: `src/lib/gsm-token-store.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/lib/gsm-token-store.test.ts`:

```ts
import {describe, it, expect, vi, beforeEach} from 'vitest'

const mockAccessSecretVersion = vi.fn()
const mockAddSecretVersion = vi.fn()

vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: vi.fn(() => ({
    accessSecretVersion: mockAccessSecretVersion,
    addSecretVersion: mockAddSecretVersion,
  })),
}))

const {getTokenFromGsm, saveTokenToGsm} = await import('../../src/lib/gsm-token-store.js')

const ENTRY = {
  accessToken: 'at',
  refreshToken: 'rt',
  expiresAt: 9999999999000,
  tenantId: 'tid',
  tenantName: 'Acme',
}

describe('getTokenFromGsm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed TokenEntry when secret exists', async () => {
    mockAccessSecretVersion.mockResolvedValue([
      {payload: {data: Buffer.from(JSON.stringify(ENTRY), 'utf-8')}},
    ])

    const result = await getTokenFromGsm('xero-tokens-acme', 'my-project')

    expect(mockAccessSecretVersion).toHaveBeenCalledWith({
      name: 'projects/my-project/secrets/xero-tokens-acme/versions/latest',
    })
    expect(result).toEqual(ENTRY)
  })

  it('returns null when secret is not found (gRPC code 5)', async () => {
    const notFound = Object.assign(new Error('NOT_FOUND'), {code: 5})
    mockAccessSecretVersion.mockRejectedValue(notFound)

    const result = await getTokenFromGsm('xero-tokens-acme', 'my-project')
    expect(result).toBeNull()
  })

  it('throws with GSM auth message on unexpected error', async () => {
    mockAccessSecretVersion.mockRejectedValue(new Error('UNAUTHENTICATED'))

    await expect(getTokenFromGsm('xero-tokens-acme', 'my-project')).rejects.toThrow(
      'GSM auth failed — check GOOGLE_APPLICATION_CREDENTIALS',
    )
  })
})

describe('saveTokenToGsm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls addSecretVersion with serialised TokenEntry payload', async () => {
    mockAddSecretVersion.mockResolvedValue([{}])

    await saveTokenToGsm('xero-tokens-acme', 'my-project', ENTRY)

    expect(mockAddSecretVersion).toHaveBeenCalledWith({
      parent: 'projects/my-project/secrets/xero-tokens-acme',
      payload: {
        data: Buffer.from(JSON.stringify(ENTRY), 'utf-8'),
      },
    })
  })

  it('throws with GSM write message on failure', async () => {
    mockAddSecretVersion.mockRejectedValue(new Error('PERMISSION_DENIED'))

    await expect(saveTokenToGsm('xero-tokens-acme', 'my-project', ENTRY)).rejects.toThrow(
      'GSM write failed',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/lib/gsm-token-store.test.ts
```

Expected: FAIL — `Cannot find module '../../src/lib/gsm-token-store.js'`

- [ ] **Step 3: Create `src/lib/gsm-token-store.ts`**

```ts
import {SecretManagerServiceClient} from '@google-cloud/secret-manager'
import type {TokenEntry} from './auth.js'

export async function getTokenFromGsm(secretName: string, projectId: string): Promise<TokenEntry | null> {
  const client = new SecretManagerServiceClient()
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`
  try {
    const [version] = await client.accessSecretVersion({name})
    const payload = version.payload?.data
    if (!payload) return null
    const json = typeof payload === 'string' ? payload : Buffer.from(payload as Uint8Array).toString('utf-8')
    return JSON.parse(json) as TokenEntry
  } catch (err: unknown) {
    const code = (err as {code?: number}).code
    if (code === 5) return null  // gRPC NOT_FOUND
    throw new Error(`GSM auth failed — check GOOGLE_APPLICATION_CREDENTIALS: ${(err as Error).message}`)
  }
}

export async function saveTokenToGsm(secretName: string, projectId: string, entry: TokenEntry): Promise<void> {
  const client = new SecretManagerServiceClient()
  const parent = `projects/${projectId}/secrets/${secretName}`
  try {
    await client.addSecretVersion({
      parent,
      payload: {
        data: Buffer.from(JSON.stringify(entry), 'utf-8'),
      },
    })
  } catch (err: unknown) {
    throw new Error(`GSM write failed: ${(err as Error).message}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/lib/gsm-token-store.test.ts
```

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gsm-token-store.ts test/lib/gsm-token-store.test.ts
git commit -m "feat: add GSM token store with getTokenFromGsm and saveTokenToGsm"
```

---

## Task 3: Add GSM routing to `auth.ts` — write failing tests first

**Files:**
- Create: `test/lib/auth.test.ts`
- Modify: `src/lib/auth.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/lib/auth.test.ts`:

```ts
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mkdirSync, rmSync} from 'node:fs'

const TEST_DIR = join(tmpdir(), `xero-auth-test-${Date.now()}`)

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {...actual, homedir: () => TEST_DIR}
})

const mockGetTokenFromGsm = vi.fn()
const mockSaveTokenToGsm = vi.fn()

vi.mock('../../src/lib/gsm-token-store.js', () => ({
  getTokenFromGsm: mockGetTokenFromGsm,
  saveTokenToGsm: mockSaveTokenToGsm,
}))

const {getCachedTokenSet, cacheTokenSet} = await import('../../src/lib/auth.js')

const ENTRY = {
  accessToken: 'at',
  refreshToken: 'rt',
  expiresAt: 9999999999000,
  tenantId: 'tid',
  tenantName: 'Acme',
}

describe('getCachedTokenSet', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, '.config', 'xero-command-line'), {recursive: true})
    vi.clearAllMocks()
    delete process.env.XERO_TOKEN_STORE
    delete process.env.XERO_GCP_PROJECT
    delete process.env.XERO_GSM_SECRET_NAME
    delete process.env.XERO_ACCESS_TOKEN
    delete process.env.XERO_REFRESH_TOKEN
    delete process.env.XERO_TENANT_ID
  })

  afterEach(() => {
    rmSync(TEST_DIR, {recursive: true, force: true})
  })

  describe('GSM mode', () => {
    beforeEach(() => {
      process.env.XERO_TOKEN_STORE = 'gsm'
      process.env.XERO_GCP_PROJECT = 'my-project'
      process.env.XERO_GSM_SECRET_NAME = 'xero-tokens-acme'
    })

    it('calls getTokenFromGsm with secret name and project', async () => {
      mockGetTokenFromGsm.mockResolvedValue(ENTRY)

      const result = await getCachedTokenSet('acme')

      expect(mockGetTokenFromGsm).toHaveBeenCalledWith('xero-tokens-acme', 'my-project')
      expect(result).toEqual(ENTRY)
    })

    it('returns null when GSM returns null', async () => {
      mockGetTokenFromGsm.mockResolvedValue(null)
      const result = await getCachedTokenSet('acme')
      expect(result).toBeNull()
    })

    it('throws when XERO_GCP_PROJECT is missing', async () => {
      delete process.env.XERO_GCP_PROJECT

      await expect(getCachedTokenSet('acme')).rejects.toThrow(
        'XERO_GCP_PROJECT and XERO_GSM_SECRET_NAME are required when XERO_TOKEN_STORE=gsm',
      )
    })

    it('throws when XERO_GSM_SECRET_NAME is missing', async () => {
      delete process.env.XERO_GSM_SECRET_NAME

      await expect(getCachedTokenSet('acme')).rejects.toThrow(
        'XERO_GCP_PROJECT and XERO_GSM_SECRET_NAME are required when XERO_TOKEN_STORE=gsm',
      )
    })
  })

  describe('env var mode (existing behaviour)', () => {
    it('returns env var token when all three are set', async () => {
      process.env.XERO_ACCESS_TOKEN = 'at-env'
      process.env.XERO_REFRESH_TOKEN = 'rt-env'
      process.env.XERO_TENANT_ID = 'tid-env'

      const result = await getCachedTokenSet('any-profile')

      expect(mockGetTokenFromGsm).not.toHaveBeenCalled()
      expect(result?.accessToken).toBe('at-env')
    })
  })

  describe('file cache mode (existing behaviour)', () => {
    it('returns null when no cache file exists', async () => {
      const result = await getCachedTokenSet('no-such-profile')
      expect(result).toBeNull()
    })
  })
})

describe('cacheTokenSet', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, '.config', 'xero-command-line'), {recursive: true})
    vi.clearAllMocks()
    delete process.env.XERO_TOKEN_STORE
    delete process.env.XERO_GCP_PROJECT
    delete process.env.XERO_GSM_SECRET_NAME
  })

  afterEach(() => {
    rmSync(TEST_DIR, {recursive: true, force: true})
  })

  describe('GSM mode', () => {
    beforeEach(() => {
      process.env.XERO_TOKEN_STORE = 'gsm'
      process.env.XERO_GCP_PROJECT = 'my-project'
      process.env.XERO_GSM_SECRET_NAME = 'xero-tokens-acme'
    })

    it('calls saveTokenToGsm with the token entry', async () => {
      mockSaveTokenToGsm.mockResolvedValue(undefined)

      await cacheTokenSet(
        'acme',
        {access_token: 'at', refresh_token: 'rt', expires_in: 1800},
        'tid',
        'Acme',
      )

      expect(mockSaveTokenToGsm).toHaveBeenCalledWith(
        'xero-tokens-acme',
        'my-project',
        expect.objectContaining({
          accessToken: 'at',
          refreshToken: 'rt',
          tenantId: 'tid',
          tenantName: 'Acme',
        }),
      )
    })

    it('throws when XERO_GCP_PROJECT is missing', async () => {
      delete process.env.XERO_GCP_PROJECT

      await expect(
        cacheTokenSet('acme', {access_token: 'at', refresh_token: 'rt'}, 'tid'),
      ).rejects.toThrow(
        'XERO_GCP_PROJECT and XERO_GSM_SECRET_NAME are required when XERO_TOKEN_STORE=gsm',
      )
    })
  })

  describe('file cache mode (existing behaviour)', () => {
    it('does not call saveTokenToGsm', async () => {
      await cacheTokenSet('acme', {access_token: 'at', refresh_token: 'rt'}, 'tid')
      expect(mockSaveTokenToGsm).not.toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- test/lib/auth.test.ts
```

Expected: FAIL — tests for GSM routing fail because `getCachedTokenSet` and `cacheTokenSet` don't check `XERO_TOKEN_STORE` yet.

- [ ] **Step 3: Update `src/lib/auth.ts`**

Replace the entire file with:

```ts
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {getTokenFromGsm, saveTokenToGsm} from './gsm-token-store.js'

export interface TokenEntry {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp in ms
  tenantId: string
  tenantName?: string
}

interface TokenCache {
  [profileName: string]: TokenEntry
}

const CONFIG_DIR = join(homedir(), '.config', 'xero-command-line')
const TOKEN_PATH = join(CONFIG_DIR, 'tokens.json')
const TOKEN_BUFFER_MS = 60_000 // Refresh 60s before expiry

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, {recursive: true})
  }
}

function readTokenCache(): TokenCache {
  ensureConfigDir()
  if (!existsSync(TOKEN_PATH)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')) as TokenCache
  } catch {
    return {}
  }
}

function writeTokenCache(cache: TokenCache): void {
  ensureConfigDir()
  writeFileSync(TOKEN_PATH, JSON.stringify(cache, null, 2), {mode: 0o600})
}

export async function getCachedTokenSet(profileName: string): Promise<TokenEntry | null> {
  // GSM backend
  if (process.env.XERO_TOKEN_STORE === 'gsm') {
    const projectId = process.env.XERO_GCP_PROJECT
    const secretName = process.env.XERO_GSM_SECRET_NAME
    if (!projectId || !secretName) {
      throw new Error('XERO_GCP_PROJECT and XERO_GSM_SECRET_NAME are required when XERO_TOKEN_STORE=gsm')
    }
    return getTokenFromGsm(secretName, projectId)
  }

  // Env var tokens
  const envAccessToken = process.env.XERO_ACCESS_TOKEN
  const envRefreshToken = process.env.XERO_REFRESH_TOKEN
  const envTenantId = process.env.XERO_TENANT_ID
  if (envAccessToken && envRefreshToken && envTenantId) {
    // After a token refresh, the new token lands in the file cache with a real
    // expiry. Prefer it over the env var token if it's still valid — this
    // allows the retry logic in withRetry to succeed after a 401-triggered refresh.
    const cache = readTokenCache()
    const fileEntry = cache[profileName]
    if (fileEntry && !isTokenExpired(fileEntry)) {
      return fileEntry
    }

    return {
      accessToken: envAccessToken,
      refreshToken: envRefreshToken,
      expiresAt: Infinity,
      tenantId: envTenantId,
      tenantName: process.env.XERO_TENANT_NAME,
    }
  }

  // File cache
  const cache = readTokenCache()
  const entry = cache[profileName]
  if (!entry) return null

  return entry
}

export function isTokenExpired(entry: TokenEntry): boolean {
  return Date.now() >= entry.expiresAt - TOKEN_BUFFER_MS
}

export async function cacheTokenSet(
  profileName: string,
  tokenSet: {access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: number},
  tenantId: string,
  tenantName?: string,
): Promise<void> {
  const accessToken = tokenSet.access_token
  const refreshToken = tokenSet.refresh_token
  if (!accessToken || !refreshToken) return

  let expiresAt: number
  if (tokenSet.expires_at) {
    expiresAt = tokenSet.expires_at * 1000
  } else if (tokenSet.expires_in) {
    expiresAt = Date.now() + tokenSet.expires_in * 1000
  } else {
    expiresAt = Date.now() + 1800 * 1000
  }

  const entry: TokenEntry = {accessToken, refreshToken, expiresAt, tenantId, tenantName}

  // GSM backend
  if (process.env.XERO_TOKEN_STORE === 'gsm') {
    const projectId = process.env.XERO_GCP_PROJECT
    const secretName = process.env.XERO_GSM_SECRET_NAME
    if (!projectId || !secretName) {
      throw new Error('XERO_GCP_PROJECT and XERO_GSM_SECRET_NAME are required when XERO_TOKEN_STORE=gsm')
    }
    return saveTokenToGsm(secretName, projectId, entry)
  }

  // File cache
  const cache = readTokenCache()
  cache[profileName] = entry
  writeTokenCache(cache)
}

export async function clearCachedToken(profileName: string): Promise<void> {
  // GSM mode: no-op on clear (don't delete the secret, just let the next
  // login overwrite it via addSecretVersion)
  if (process.env.XERO_TOKEN_STORE === 'gsm') return

  const cache = readTokenCache()
  delete cache[profileName]
  writeTokenCache(cache)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/lib/auth.test.ts
```

Expected: PASS — all tests passing.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts test/lib/auth.test.ts
git commit -m "feat: add GSM routing to getCachedTokenSet and cacheTokenSet"
```

---

## Task 4: Fix call sites broken by async signature change

`clearCachedToken` is now async. Check all call sites in `xero-client.ts` are already using `await`.

**Files:**
- Modify: `src/lib/xero-client.ts` (if needed)

- [ ] **Step 1: Check how `clearCachedToken` is called**

```bash
grep -n 'clearCachedToken' src/lib/xero-client.ts
```

Expected output (line numbers may vary):
```
6: export {clearCachedToken}
27:     clearCachedToken(profileName)
69:     clearCachedToken(profileName)
72:     clearCachedToken(profileName)
```

- [ ] **Step 2: Add `await` to any bare `clearCachedToken` calls**

In `src/lib/xero-client.ts`, ensure every `clearCachedToken(...)` call is prefixed with `await`:

```ts
// Line ~27 (inside createXeroClient catch block)
await clearCachedToken(profileName)

// Line ~69 (inside withRetry catch block)
await clearCachedToken(profileName)

// Line ~72 (inside withRetry after failed refresh)
await clearCachedToken(profileName)
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/xero-client.ts
git commit -m "fix: await clearCachedToken calls after async signature change"
```

---

## Task 5: Update "Not logged in" error to hint at GSM seeding

**Files:**
- Modify: `src/lib/xero-client.ts`

- [ ] **Step 1: Find the error message**

```bash
grep -n 'Not logged in' src/lib/xero-client.ts
```

Expected: one match on the line that throws the error.

- [ ] **Step 2: Update the error message**

Replace the existing throw in `createXeroClient`:

```ts
// Before
throw new Error(`Not logged in. Run "xero login" to authenticate.`)

// After
const gsmHint = process.env.XERO_TOKEN_STORE === 'gsm'
  ? ' Set XERO_TOKEN_STORE=gsm and run "xero login" with GSM env vars to seed the secret.'
  : ''
throw new Error(`Not logged in. Run "xero login" to authenticate.${gsmHint}`)
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/xero-client.ts
git commit -m "fix: hint at GSM seeding in Not logged in error when XERO_TOKEN_STORE=gsm"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| `XERO_TOKEN_STORE=gsm` activates GSM backend | Task 3 — `getCachedTokenSet` / `cacheTokenSet` |
| `XERO_GCP_PROJECT` + `XERO_GSM_SECRET_NAME` required | Task 3 — throws with clear message if missing |
| `getTokenFromGsm` reads `versions/latest`, parses JSON | Task 2 |
| `getTokenFromGsm` returns `null` on NOT_FOUND (code 5) | Task 2 |
| `getTokenFromGsm` throws GSM auth message on other errors | Task 2 |
| `saveTokenToGsm` calls `addSecretVersion` with payload | Task 2 |
| `saveTokenToGsm` throws GSM write message on failure | Task 2 |
| Existing env var and file cache paths unchanged | Task 3 — tested explicitly |
| `cacheTokenSet` routes to GSM on write-back | Task 3 |
| `clearCachedToken` is a no-op in GSM mode | Task 3 (implemented), Task 4 (await fix) |
| "Not logged in" hints at GSM seeding | Task 5 |
| `@google-cloud/secret-manager` added to dependencies | Task 1 |

All spec requirements are covered. No TBDs or placeholder steps present.

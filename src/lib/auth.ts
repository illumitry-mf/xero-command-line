import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

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

export function getCachedTokenSet(profileName: string): TokenEntry | null {
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

  const cache = readTokenCache()
  const entry = cache[profileName]
  if (!entry) return null

  return entry
}

export function isTokenExpired(entry: TokenEntry): boolean {
  return Date.now() >= entry.expiresAt - TOKEN_BUFFER_MS
}

export function cacheTokenSet(
  profileName: string,
  tokenSet: {access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: number},
  tenantId: string,
  tenantName?: string,
): void {
  const accessToken = tokenSet.access_token
  const refreshToken = tokenSet.refresh_token
  if (!accessToken || !refreshToken) return

  let expiresAt: number
  if (tokenSet.expires_at) {
    // expires_at is in seconds since epoch
    expiresAt = tokenSet.expires_at * 1000
  } else if (tokenSet.expires_in) {
    expiresAt = Date.now() + tokenSet.expires_in * 1000
  } else {
    // Default 30 min
    expiresAt = Date.now() + 1800 * 1000
  }

  const cache = readTokenCache()
  cache[profileName] = {
    accessToken,
    refreshToken,
    expiresAt,
    tenantId,
    tenantName,
  }
  writeTokenCache(cache)
}

export function clearCachedToken(profileName: string): void {
  const cache = readTokenCache()
  delete cache[profileName]
  writeTokenCache(cache)
}

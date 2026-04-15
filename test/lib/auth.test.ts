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

const {getCachedTokenSet, cacheTokenSet, clearCachedToken} = await import('../../src/lib/auth.js')

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

    it('throws when XERO_GSM_SECRET_NAME is missing', async () => {
      delete process.env.XERO_GSM_SECRET_NAME

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

describe('clearCachedToken', () => {
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

  it('is a no-op in GSM mode', async () => {
    process.env.XERO_TOKEN_STORE = 'gsm'
    await expect(clearCachedToken('acme')).resolves.toBeUndefined()
  })

  it('removes profile from file cache in non-GSM mode', async () => {
    await cacheTokenSet('acme', {access_token: 'at', refresh_token: 'rt'}, 'tid')
    await clearCachedToken('acme')
    const result = await getCachedTokenSet('acme')
    expect(result).toBeNull()
  })
})

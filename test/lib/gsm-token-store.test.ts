import {describe, it, expect, vi, beforeEach} from 'vitest'

const mockAccessSecretVersion = vi.fn()
const mockAddSecretVersion = vi.fn()
const mockCreateSecret = vi.fn()

vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: vi.fn(() => ({
    accessSecretVersion: mockAccessSecretVersion,
    addSecretVersion: mockAddSecretVersion,
    createSecret: mockCreateSecret,
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

  it('returns null when payload data is missing', async () => {
    mockAccessSecretVersion.mockResolvedValue([{payload: {data: null}}])
    const result = await getTokenFromGsm('xero-tokens-acme', 'my-project')
    expect(result).toBeNull()
  })

  it('throws with corrupt payload message when secret contains invalid JSON', async () => {
    mockAccessSecretVersion.mockResolvedValue([
      {payload: {data: Buffer.from('not-valid-json', 'utf-8')}},
    ])

    await expect(getTokenFromGsm('xero-tokens-acme', 'my-project')).rejects.toThrow(
      'GSM secret payload is not valid JSON',
    )
  })
})

describe('saveTokenToGsm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls addSecretVersion with serialised TokenEntry payload', async () => {
    mockAddSecretVersion.mockResolvedValue([{}])

    await expect(saveTokenToGsm('xero-tokens-acme', 'my-project', ENTRY)).resolves.toBeUndefined()

    expect(mockAddSecretVersion).toHaveBeenCalledWith({
      parent: 'projects/my-project/secrets/xero-tokens-acme',
      payload: {
        data: Buffer.from(JSON.stringify(ENTRY), 'utf-8'),
      },
    })
  })

  it('creates the secret then writes when secret does not exist (gRPC code 5)', async () => {
    const notFound = Object.assign(new Error('NOT_FOUND'), {code: 5})
    mockAddSecretVersion.mockRejectedValueOnce(notFound).mockResolvedValueOnce([{}])
    mockCreateSecret.mockResolvedValue([{}])

    await expect(saveTokenToGsm('xero-tokens-acme', 'my-project', ENTRY)).resolves.toBeUndefined()

    expect(mockCreateSecret).toHaveBeenCalledWith({
      parent: 'projects/my-project',
      secretId: 'xero-tokens-acme',
      secret: {replication: {automatic: {}}},
    })
    expect(mockAddSecretVersion).toHaveBeenCalledTimes(2)
  })

  it('throws with GSM write message on non-NOT_FOUND failure', async () => {
    mockAddSecretVersion.mockRejectedValue(new Error('PERMISSION_DENIED'))

    await expect(saveTokenToGsm('xero-tokens-acme', 'my-project', ENTRY)).rejects.toThrow(
      'GSM write failed',
    )
  })

  it('throws with GSM write message when createSecret fails', async () => {
    const notFound = Object.assign(new Error('NOT_FOUND'), {code: 5})
    mockAddSecretVersion.mockRejectedValueOnce(notFound)
    mockCreateSecret.mockRejectedValue(new Error('PERMISSION_DENIED'))

    await expect(saveTokenToGsm('xero-tokens-acme', 'my-project', ENTRY)).rejects.toThrow(
      'GSM write failed',
    )
  })
})

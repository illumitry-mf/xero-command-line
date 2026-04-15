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

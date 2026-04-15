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
    if (err instanceof SyntaxError) throw new Error('GSM secret payload is not valid JSON — the secret may be corrupt')
    throw new Error(`GSM auth failed — check GOOGLE_APPLICATION_CREDENTIALS: ${(err as Error).message}`)
  }
}

export async function saveTokenToGsm(secretName: string, projectId: string, entry: TokenEntry): Promise<void> {
  const client = new SecretManagerServiceClient()
  const projectPath = `projects/${projectId}`
  const secretPath = `${projectPath}/secrets/${secretName}`
  const payload = {data: Buffer.from(JSON.stringify(entry), 'utf-8')}

  let newVersionName: string | null | undefined
  try {
    const [version] = await client.addSecretVersion({parent: secretPath, payload})
    newVersionName = version.name
  } catch (err: unknown) {
    const code = (err as {code?: number}).code
    if (code !== 5) throw new Error(`GSM write failed: ${(err as Error).message}`)

    // Secret does not exist yet — create it then add the first version.
    try {
      await client.createSecret({
        parent: projectPath,
        secretId: secretName,
        secret: {replication: {automatic: {}}},
      })
      await client.addSecretVersion({parent: secretPath, payload})
      return  // First version only — no previous versions to clean up.
    } catch (createErr: unknown) {
      throw new Error(`GSM write failed: ${(createErr as Error).message}`)
    }
  }

  // Destroy all previously enabled versions to avoid accumulating stale secrets.
  if (newVersionName) {
    try {
      const [versions] = await client.listSecretVersions({parent: secretPath, filter: 'state:ENABLED'})
      for (const v of versions) {
        if (v.name && v.name !== newVersionName) {
          await client.destroySecretVersion({name: v.name})
        }
      }
    } catch {
      // Best-effort cleanup — don't fail the write if version cleanup fails.
    }
  }
}

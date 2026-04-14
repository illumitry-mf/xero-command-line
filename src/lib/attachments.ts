import * as fs from 'node:fs'
import * as path from 'node:path'
import {XeroClient} from 'xero-node'
import type {Attachment} from 'xero-node'

export type AttachmentResource =
  | 'invoice'
  | 'creditNote'
  | 'bankTransaction'
  | 'quote'
  | 'contact'
  | 'account'
  | 'manualJournal'

const MIME_MAP: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.xml':  'application/xml',
  '.csv':  'text/csv',
  '.txt':  'text/plain',
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const mime = MIME_MAP[ext]
  if (!mime) throw new Error(`Unsupported file type: ${ext}`)
  return mime
}

export function validateUploadFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }
  const stat = fs.statSync(filePath)
  const maxBytes = 25 * 1024 * 1024
  if (stat.size > maxBytes) {
    const mb = (stat.size / 1024 / 1024).toFixed(1)
    throw new Error(`File exceeds 25MB limit (actual: ${mb} MB)`)
  }
}

type ApiClient = XeroClient['accountingApi']

// Resources that support includeOnline on upload
const SUPPORTS_INCLUDE_ONLINE = new Set<AttachmentResource>(['invoice', 'creditNote'])

function getUploadMethod(api: ApiClient, resource: AttachmentResource) {
  const map: Record<AttachmentResource, (...args: any[]) => Promise<any>> = {
    invoice:         (...a) => api.createInvoiceAttachmentByFileName(...a),
    creditNote:      (...a) => api.createCreditNoteAttachmentByFileName(...a),
    bankTransaction: (...a) => api.createBankTransactionAttachmentByFileName(...a),
    quote:           (...a) => api.createQuoteAttachmentByFileName(...a),
    contact:         (...a) => api.createContactAttachmentByFileName(...a),
    account:         (...a) => api.createAccountAttachmentByFileName(...a),
    manualJournal:   (...a) => api.createManualJournalAttachmentByFileName(...a),
  }
  return map[resource]
}

function getListMethod(api: ApiClient, resource: AttachmentResource) {
  const map: Record<AttachmentResource, (...args: any[]) => Promise<any>> = {
    invoice:         (...a) => api.getInvoiceAttachments(...a),
    creditNote:      (...a) => api.getCreditNoteAttachments(...a),
    bankTransaction: (...a) => api.getBankTransactionAttachments(...a),
    quote:           (...a) => api.getQuoteAttachments(...a),
    contact:         (...a) => api.getContactAttachments(...a),
    account:         (...a) => api.getAccountAttachments(...a),
    manualJournal:   (...a) => api.getManualJournalAttachments(...a),
  }
  return map[resource]
}

function getDownloadByIdMethod(api: ApiClient, resource: AttachmentResource) {
  const map: Record<AttachmentResource, (...args: any[]) => Promise<any>> = {
    invoice:         (...a) => api.getInvoiceAttachmentById(...a),
    creditNote:      (...a) => api.getCreditNoteAttachmentById(...a),
    bankTransaction: (...a) => api.getBankTransactionAttachmentById(...a),
    quote:           (...a) => api.getQuoteAttachmentById(...a),
    contact:         (...a) => api.getContactAttachmentById(...a),
    account:         (...a) => api.getAccountAttachmentById(...a),
    manualJournal:   (...a) => api.getManualJournalAttachmentById(...a),
  }
  return map[resource]
}

export async function uploadAttachment(
  xero: XeroClient,
  tenantId: string,
  resource: AttachmentResource,
  resourceId: string,
  filePath: string,
  includeOnline: boolean,
): Promise<Attachment> {
  validateUploadFile(filePath)
  getMimeType(filePath) // throws for unsupported extension

  const fileName = path.basename(filePath)
  const stream = fs.createReadStream(filePath)
  const api = xero.accountingApi
  const upload = getUploadMethod(api, resource)

  let response: any
  if (SUPPORTS_INCLUDE_ONLINE.has(resource)) {
    response = await upload(tenantId, resourceId, fileName, stream, includeOnline, undefined)
  } else {
    response = await upload(tenantId, resourceId, fileName, stream, undefined)
  }

  return response.body.attachments?.[0] as Attachment
}

export async function listAttachments(
  xero: XeroClient,
  tenantId: string,
  resource: AttachmentResource,
  resourceId: string,
): Promise<Attachment[]> {
  const list = getListMethod(xero.accountingApi, resource)
  const response = await list(tenantId, resourceId)
  return (response.body.attachments ?? []) as Attachment[]
}

export async function downloadAttachment(
  xero: XeroClient,
  tenantId: string,
  resource: AttachmentResource,
  resourceId: string,
  attachmentId: string,
): Promise<{fileName: string; data: Buffer}> {
  // Resolve filename + mimeType from list
  const attachments = await listAttachments(xero, tenantId, resource, resourceId)
  const meta = attachments.find(a => a.attachmentID === attachmentId)
  if (!meta) throw new Error(`Attachment not found: ${attachmentId}`)

  const fileName = meta.fileName ?? 'attachment'
  const mimeType = meta.mimeType ?? 'application/octet-stream'

  const getById = getDownloadByIdMethod(xero.accountingApi, resource)
  const response = await getById(tenantId, resourceId, attachmentId, mimeType)
  return {fileName, data: response.body as Buffer}
}

# Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upload`, `list`, and `download` attachment sub-commands to 7 existing CLI resource topics (invoices, credit-notes, bank-transactions, quotes, contacts, accounts, manual-journals).

**Architecture:** A shared `src/lib/attachments.ts` contains all API logic with a dispatch map routing `AttachmentResource` enum values to xero-node SDK methods. The 21 command files (3 per resource) are thin wrappers: parse flags → `this.xeroCall` → delegate to lib → format output.

**Tech Stack:** TypeScript, oclif v4, xero-node v13 (`xero.accountingApi`), vitest, Node.js `fs` (streams + `writeFileSync`), `path`.

---

## File Map

**Create:**
- `src/lib/attachments.ts` — shared upload/list/download logic + MIME map + dispatch
- `src/commands/invoices/attachments/upload.ts`
- `src/commands/invoices/attachments/list.ts`
- `src/commands/invoices/attachments/download.ts`
- `src/commands/credit-notes/attachments/upload.ts`
- `src/commands/credit-notes/attachments/list.ts`
- `src/commands/credit-notes/attachments/download.ts`
- `src/commands/bank-transactions/attachments/upload.ts`
- `src/commands/bank-transactions/attachments/list.ts`
- `src/commands/bank-transactions/attachments/download.ts`
- `src/commands/quotes/attachments/upload.ts`
- `src/commands/quotes/attachments/list.ts`
- `src/commands/quotes/attachments/download.ts`
- `src/commands/contacts/attachments/upload.ts`
- `src/commands/contacts/attachments/list.ts`
- `src/commands/contacts/attachments/download.ts`
- `src/commands/accounts/attachments/upload.ts`
- `src/commands/accounts/attachments/list.ts`
- `src/commands/accounts/attachments/download.ts`
- `src/commands/manual-journals/attachments/upload.ts`
- `src/commands/manual-journals/attachments/list.ts`
- `src/commands/manual-journals/attachments/download.ts`
- `test/lib/attachments.test.ts`

**Modify:**
- `package.json` — add 7 `attachments` sub-topic entries under `oclif.topics`

---

## Task 1: Shared lib + tests

**Files:**
- Create: `src/lib/attachments.ts`
- Create: `test/lib/attachments.test.ts`

### Step 1.1 — Write failing tests

Create `test/lib/attachments.test.ts`:

```typescript
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {getMimeType, validateUploadFile, AttachmentResource} from '../../src/lib/attachments.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {...actual}
})

describe('getMimeType', () => {
  it('returns application/pdf for .pdf', () => {
    expect(getMimeType('invoice.pdf')).toBe('application/pdf')
  })

  it('returns image/png for .png', () => {
    expect(getMimeType('receipt.png')).toBe('image/png')
  })

  it('returns image/jpeg for .jpg', () => {
    expect(getMimeType('photo.jpg')).toBe('image/jpeg')
  })

  it('returns image/jpeg for .jpeg', () => {
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg')
  })

  it('returns image/gif for .gif', () => {
    expect(getMimeType('anim.gif')).toBe('image/gif')
  })

  it('returns image/webp for .webp', () => {
    expect(getMimeType('img.webp')).toBe('image/webp')
  })

  it('returns application/xml for .xml', () => {
    expect(getMimeType('data.xml')).toBe('application/xml')
  })

  it('returns text/csv for .csv', () => {
    expect(getMimeType('data.csv')).toBe('text/csv')
  })

  it('returns text/plain for .txt', () => {
    expect(getMimeType('notes.txt')).toBe('text/plain')
  })

  it('is case-insensitive', () => {
    expect(getMimeType('INVOICE.PDF')).toBe('application/pdf')
  })

  it('throws for unknown extension', () => {
    expect(() => getMimeType('file.xyz')).toThrow('Unsupported file type: .xyz')
  })

  it('throws for no extension', () => {
    expect(() => getMimeType('noext')).toThrow('Unsupported file type: ')
  })
})

describe('validateUploadFile', () => {
  it('throws if file does not exist', () => {
    expect(() => validateUploadFile('/nonexistent/path/file.pdf')).toThrow('File not found: /nonexistent/path/file.pdf')
  })

  it('throws if file exceeds 25MB', () => {
    const tmpFile = path.join(os.tmpdir(), `xero-test-oversize-${Date.now()}.pdf`)
    // Write a real temp file but mock statSync to return large size
    fs.writeFileSync(tmpFile, 'x')
    const statSyncSpy = vi.spyOn(fs, 'statSync').mockReturnValue({size: 26 * 1024 * 1024} as fs.Stats)
    try {
      expect(() => validateUploadFile(tmpFile)).toThrow('File exceeds 25MB limit')
    } finally {
      statSyncSpy.mockRestore()
      fs.unlinkSync(tmpFile)
    }
  })

  it('does not throw for a valid small file', () => {
    const tmpFile = path.join(os.tmpdir(), `xero-test-valid-${Date.now()}.pdf`)
    fs.writeFileSync(tmpFile, 'x')
    try {
      expect(() => validateUploadFile(tmpFile)).not.toThrow()
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})

describe('uploadAttachment', () => {
  it('calls createInvoiceAttachmentByFileName with correct args', async () => {
    const {uploadAttachment} = await import('../../src/lib/attachments.js')
    const tmpFile = path.join(os.tmpdir(), `xero-upload-test-${Date.now()}.pdf`)
    fs.writeFileSync(tmpFile, 'fake pdf content')

    const mockCreate = vi.fn().mockResolvedValue({
      body: {attachments: [{attachmentID: 'att-1', fileName: path.basename(tmpFile)}]},
    })
    const xero = {accountingApi: {createInvoiceAttachmentByFileName: mockCreate}} as any

    await uploadAttachment(xero, 'tenant-1', 'invoice', 'inv-123', tmpFile, false)

    expect(mockCreate).toHaveBeenCalledWith(
      'tenant-1',
      'inv-123',
      path.basename(tmpFile),
      expect.any(Object), // ReadStream
      false,
      undefined,
    )
    fs.unlinkSync(tmpFile)
  })

  it('calls createBankTransactionAttachmentByFileName for bankTransaction', async () => {
    const {uploadAttachment} = await import('../../src/lib/attachments.js')
    const tmpFile = path.join(os.tmpdir(), `xero-upload-bank-${Date.now()}.pdf`)
    fs.writeFileSync(tmpFile, 'fake content')

    const mockCreate = vi.fn().mockResolvedValue({
      body: {attachments: [{attachmentID: 'att-2', fileName: path.basename(tmpFile)}]},
    })
    const xero = {accountingApi: {createBankTransactionAttachmentByFileName: mockCreate}} as any

    await uploadAttachment(xero, 'tenant-1', 'bankTransaction', 'bt-456', tmpFile, false)

    expect(mockCreate).toHaveBeenCalledWith(
      'tenant-1',
      'bt-456',
      path.basename(tmpFile),
      expect.any(Object),
      undefined,
    )
    fs.unlinkSync(tmpFile)
  })
})

describe('listAttachments', () => {
  it('returns array of attachments from invoice', async () => {
    const {listAttachments} = await import('../../src/lib/attachments.js')
    const mockGet = vi.fn().mockResolvedValue({
      body: {
        attachments: [
          {attachmentID: 'att-1', fileName: 'receipt.pdf', mimeType: 'application/pdf', contentLength: 1024, url: 'https://example.com/att-1'},
        ],
      },
    })
    const xero = {accountingApi: {getInvoiceAttachments: mockGet}} as any

    const result = await listAttachments(xero, 'tenant-1', 'invoice', 'inv-123')

    expect(mockGet).toHaveBeenCalledWith('tenant-1', 'inv-123')
    expect(result).toHaveLength(1)
    expect(result[0].attachmentID).toBe('att-1')
    expect(result[0].fileName).toBe('receipt.pdf')
  })

  it('returns empty array when no attachments', async () => {
    const {listAttachments} = await import('../../src/lib/attachments.js')
    const mockGet = vi.fn().mockResolvedValue({body: {attachments: []}})
    const xero = {accountingApi: {getInvoiceAttachments: mockGet}} as any

    const result = await listAttachments(xero, 'tenant-1', 'invoice', 'inv-123')
    expect(result).toHaveLength(0)
  })
})

describe('downloadAttachment', () => {
  it('resolves filename via list then downloads by ID', async () => {
    const {downloadAttachment} = await import('../../src/lib/attachments.js')

    const mockList = vi.fn().mockResolvedValue({
      body: {
        attachments: [
          {attachmentID: 'att-1', fileName: 'invoice.pdf', mimeType: 'application/pdf'},
        ],
      },
    })
    const fakeBuffer = Buffer.from('PDF content')
    const mockGetById = vi.fn().mockResolvedValue({body: fakeBuffer})

    const xero = {
      accountingApi: {
        getInvoiceAttachments: mockList,
        getInvoiceAttachmentById: mockGetById,
      },
    } as any

    const result = await downloadAttachment(xero, 'tenant-1', 'invoice', 'inv-123', 'att-1')

    expect(mockList).toHaveBeenCalledWith('tenant-1', 'inv-123')
    expect(mockGetById).toHaveBeenCalledWith('tenant-1', 'inv-123', 'att-1', 'application/pdf')
    expect(result.fileName).toBe('invoice.pdf')
    expect(result.data).toEqual(fakeBuffer)
  })

  it('throws if attachmentId not found in list', async () => {
    const {downloadAttachment} = await import('../../src/lib/attachments.js')

    const mockList = vi.fn().mockResolvedValue({body: {attachments: []}})
    const xero = {accountingApi: {getInvoiceAttachments: mockList}} as any

    await expect(downloadAttachment(xero, 'tenant-1', 'invoice', 'inv-123', 'no-such-id'))
      .rejects.toThrow('Attachment not found: no-such-id')
  })
})
```

### Step 1.2 — Run tests to confirm they fail

```bash
cd /Users/marcfong/projects/xero-command-line && npx vitest run test/lib/attachments.test.ts
```

Expected: FAIL — `src/lib/attachments.ts` does not exist yet.

### Step 1.3 — Implement `src/lib/attachments.ts`

```typescript
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

// Resources that support includeOnline on upload
const SUPPORTS_INCLUDE_ONLINE = new Set<AttachmentResource>(['invoice', 'creditNote'])

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
```

### Step 1.4 — Run tests to confirm they pass

```bash
npx vitest run test/lib/attachments.test.ts
```

Expected: all tests PASS.

### Step 1.5 — Commit

```bash
git add src/lib/attachments.ts test/lib/attachments.test.ts
git commit -m "feat: add attachments lib with upload, list, download"
```

---

## Task 2: Register attachment sub-topics in package.json

**Files:**
- Modify: `package.json`

### Step 2.1 — Add the 7 sub-topic entries to `oclif.topics`

In `package.json`, add these entries inside the `"topics"` object (alongside the existing `"tracking:categories"` and `"tracking:options"` entries):

```json
"invoices:attachments": {
  "description": "Manage invoice attachments"
},
"credit-notes:attachments": {
  "description": "Manage credit note attachments"
},
"bank-transactions:attachments": {
  "description": "Manage bank transaction attachments"
},
"quotes:attachments": {
  "description": "Manage quote attachments"
},
"contacts:attachments": {
  "description": "Manage contact attachments"
},
"accounts:attachments": {
  "description": "Manage account attachments"
},
"manual-journals:attachments": {
  "description": "Manage manual journal attachments"
}
```

### Step 2.2 — Commit

```bash
git add package.json
git commit -m "feat: register attachment sub-topics in oclif config"
```

---

## Task 3: Invoice attachment commands

**Files:**
- Create: `src/commands/invoices/attachments/upload.ts`
- Create: `src/commands/invoices/attachments/list.ts`
- Create: `src/commands/invoices/attachments/download.ts`

### Step 3.1 — Create `src/commands/invoices/attachments/upload.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {uploadAttachment} from '../../../lib/attachments.js'

export default class InvoicesAttachmentsUpload extends BaseCommand {
  static override description = 'Upload an attachment to an invoice'

  static override examples = [
    '<%= config.bin %> invoices attachments upload --invoice-id abc-123 --file receipt.pdf',
    '<%= config.bin %> invoices attachments upload --invoice-id abc-123 --file receipt.pdf --include-online',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'invoice-id': Flags.string({description: 'Invoice ID', required: true}),
    file: Flags.string({description: 'Path to file to upload', required: true}),
    'include-online': Flags.boolean({description: 'Show attachment in online invoice view', default: false}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(InvoicesAttachmentsUpload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      uploadAttachment(xero, tenantId, 'invoice', flags['invoice-id'], flags.file, flags['include-online']),
    )

    const r = result as Record<string, unknown>
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Attachment uploaded: ${r.fileName} (${r.attachmentID})`)
    }
  }
}
```

### Step 3.2 — Create `src/commands/invoices/attachments/list.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {listAttachments} from '../../../lib/attachments.js'

export default class InvoicesAttachmentsList extends BaseCommand {
  static override description = 'List attachments on an invoice'

  static override examples = [
    '<%= config.bin %> invoices attachments list --invoice-id abc-123',
    '<%= config.bin %> invoices attachments list --invoice-id abc-123 --json',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'invoice-id': Flags.string({description: 'Invoice ID', required: true}),
  }

  private readonly columns = [
    {key: 'attachmentID', header: 'ID'},
    {key: 'fileName', header: 'File Name'},
    {key: 'mimeType', header: 'Type'},
    {key: 'contentLength', header: 'Size (bytes)'},
    {key: 'url', header: 'URL'},
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(InvoicesAttachmentsList)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      listAttachments(xero, tenantId, 'invoice', flags['invoice-id']),
    )

    this.outputFormatted(result as unknown as Record<string, unknown>[], this.columns, flags)
  }
}
```

### Step 3.3 — Create `src/commands/invoices/attachments/download.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {downloadAttachment} from '../../../lib/attachments.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

export default class InvoicesAttachmentsDownload extends BaseCommand {
  static override description = 'Download an attachment from an invoice'

  static override examples = [
    '<%= config.bin %> invoices attachments download --invoice-id abc-123 --attachment-id def-456',
    '<%= config.bin %> invoices attachments download --invoice-id abc-123 --attachment-id def-456 --output ./downloads/',
    '<%= config.bin %> invoices attachments download --invoice-id abc-123 --attachment-id def-456 --output ./saved.pdf',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'invoice-id': Flags.string({description: 'Invoice ID', required: true}),
    'attachment-id': Flags.string({description: 'Attachment ID', required: true}),
    output: Flags.string({description: 'Output path (file or directory). Defaults to current directory.'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(InvoicesAttachmentsDownload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      downloadAttachment(xero, tenantId, 'invoice', flags['invoice-id'], flags['attachment-id']),
    )

    const {fileName, data} = result as {fileName: string; data: Buffer}
    const outputPath = resolveOutputPath(flags.output, fileName)
    fs.writeFileSync(outputPath, data)
    this.log(`Saved: ${outputPath}`)
  }
}

function resolveOutputPath(output: string | undefined, fileName: string): string {
  if (!output) return path.join(process.cwd(), fileName)
  if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
    return path.join(output, fileName)
  }
  return output
}
```

### Step 3.4 — Smoke test invoice commands (dev mode)

```bash
npm run dev -- invoices attachments list --invoice-id <any-valid-invoice-id>
```

Expected: table of attachments (or empty table if none), no crash.

### Step 3.5 — Commit

```bash
git add src/commands/invoices/attachments/
git commit -m "feat: add invoice attachment commands (upload, list, download)"
```

---

## Task 4: Credit note attachment commands

**Files:**
- Create: `src/commands/credit-notes/attachments/upload.ts`
- Create: `src/commands/credit-notes/attachments/list.ts`
- Create: `src/commands/credit-notes/attachments/download.ts`

### Step 4.1 — Create `src/commands/credit-notes/attachments/upload.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {uploadAttachment} from '../../../lib/attachments.js'

export default class CreditNotesAttachmentsUpload extends BaseCommand {
  static override description = 'Upload an attachment to a credit note'

  static override examples = [
    '<%= config.bin %> credit-notes attachments upload --credit-note-id abc-123 --file receipt.pdf',
    '<%= config.bin %> credit-notes attachments upload --credit-note-id abc-123 --file receipt.pdf --include-online',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credit-note-id': Flags.string({description: 'Credit Note ID', required: true}),
    file: Flags.string({description: 'Path to file to upload', required: true}),
    'include-online': Flags.boolean({description: 'Show attachment in online credit note view', default: false}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CreditNotesAttachmentsUpload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      uploadAttachment(xero, tenantId, 'creditNote', flags['credit-note-id'], flags.file, flags['include-online']),
    )

    const r = result as Record<string, unknown>
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Attachment uploaded: ${r.fileName} (${r.attachmentID})`)
    }
  }
}
```

### Step 4.2 — Create `src/commands/credit-notes/attachments/list.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {listAttachments} from '../../../lib/attachments.js'

export default class CreditNotesAttachmentsList extends BaseCommand {
  static override description = 'List attachments on a credit note'

  static override examples = [
    '<%= config.bin %> credit-notes attachments list --credit-note-id abc-123',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credit-note-id': Flags.string({description: 'Credit Note ID', required: true}),
  }

  private readonly columns = [
    {key: 'attachmentID', header: 'ID'},
    {key: 'fileName', header: 'File Name'},
    {key: 'mimeType', header: 'Type'},
    {key: 'contentLength', header: 'Size (bytes)'},
    {key: 'url', header: 'URL'},
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(CreditNotesAttachmentsList)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      listAttachments(xero, tenantId, 'creditNote', flags['credit-note-id']),
    )

    this.outputFormatted(result as unknown as Record<string, unknown>[], this.columns, flags)
  }
}
```

### Step 4.3 — Create `src/commands/credit-notes/attachments/download.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {downloadAttachment} from '../../../lib/attachments.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

export default class CreditNotesAttachmentsDownload extends BaseCommand {
  static override description = 'Download an attachment from a credit note'

  static override examples = [
    '<%= config.bin %> credit-notes attachments download --credit-note-id abc-123 --attachment-id def-456',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credit-note-id': Flags.string({description: 'Credit Note ID', required: true}),
    'attachment-id': Flags.string({description: 'Attachment ID', required: true}),
    output: Flags.string({description: 'Output path (file or directory). Defaults to current directory.'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CreditNotesAttachmentsDownload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      downloadAttachment(xero, tenantId, 'creditNote', flags['credit-note-id'], flags['attachment-id']),
    )

    const {fileName, data} = result as {fileName: string; data: Buffer}
    const outputPath = resolveOutputPath(flags.output, fileName)
    fs.writeFileSync(outputPath, data)
    this.log(`Saved: ${outputPath}`)
  }
}

function resolveOutputPath(output: string | undefined, fileName: string): string {
  if (!output) return path.join(process.cwd(), fileName)
  if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
    return path.join(output, fileName)
  }
  return output
}
```

### Step 4.4 — Commit

```bash
git add src/commands/credit-notes/attachments/
git commit -m "feat: add credit note attachment commands (upload, list, download)"
```

---

## Task 5: Bank transaction attachment commands

**Files:**
- Create: `src/commands/bank-transactions/attachments/upload.ts`
- Create: `src/commands/bank-transactions/attachments/list.ts`
- Create: `src/commands/bank-transactions/attachments/download.ts`

### Step 5.1 — Create `src/commands/bank-transactions/attachments/upload.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {uploadAttachment} from '../../../lib/attachments.js'

export default class BankTransactionsAttachmentsUpload extends BaseCommand {
  static override description = 'Upload an attachment to a bank transaction'

  static override examples = [
    '<%= config.bin %> bank-transactions attachments upload --bank-transaction-id abc-123 --file receipt.pdf',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'bank-transaction-id': Flags.string({description: 'Bank Transaction ID', required: true}),
    file: Flags.string({description: 'Path to file to upload', required: true}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(BankTransactionsAttachmentsUpload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      uploadAttachment(xero, tenantId, 'bankTransaction', flags['bank-transaction-id'], flags.file, false),
    )

    const r = result as Record<string, unknown>
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Attachment uploaded: ${r.fileName} (${r.attachmentID})`)
    }
  }
}
```

### Step 5.2 — Create `src/commands/bank-transactions/attachments/list.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {listAttachments} from '../../../lib/attachments.js'

export default class BankTransactionsAttachmentsList extends BaseCommand {
  static override description = 'List attachments on a bank transaction'

  static override examples = [
    '<%= config.bin %> bank-transactions attachments list --bank-transaction-id abc-123',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'bank-transaction-id': Flags.string({description: 'Bank Transaction ID', required: true}),
  }

  private readonly columns = [
    {key: 'attachmentID', header: 'ID'},
    {key: 'fileName', header: 'File Name'},
    {key: 'mimeType', header: 'Type'},
    {key: 'contentLength', header: 'Size (bytes)'},
    {key: 'url', header: 'URL'},
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(BankTransactionsAttachmentsList)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      listAttachments(xero, tenantId, 'bankTransaction', flags['bank-transaction-id']),
    )

    this.outputFormatted(result as unknown as Record<string, unknown>[], this.columns, flags)
  }
}
```

### Step 5.3 — Create `src/commands/bank-transactions/attachments/download.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {downloadAttachment} from '../../../lib/attachments.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

export default class BankTransactionsAttachmentsDownload extends BaseCommand {
  static override description = 'Download an attachment from a bank transaction'

  static override examples = [
    '<%= config.bin %> bank-transactions attachments download --bank-transaction-id abc-123 --attachment-id def-456',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'bank-transaction-id': Flags.string({description: 'Bank Transaction ID', required: true}),
    'attachment-id': Flags.string({description: 'Attachment ID', required: true}),
    output: Flags.string({description: 'Output path (file or directory). Defaults to current directory.'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(BankTransactionsAttachmentsDownload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      downloadAttachment(xero, tenantId, 'bankTransaction', flags['bank-transaction-id'], flags['attachment-id']),
    )

    const {fileName, data} = result as {fileName: string; data: Buffer}
    const outputPath = resolveOutputPath(flags.output, fileName)
    fs.writeFileSync(outputPath, data)
    this.log(`Saved: ${outputPath}`)
  }
}

function resolveOutputPath(output: string | undefined, fileName: string): string {
  if (!output) return path.join(process.cwd(), fileName)
  if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
    return path.join(output, fileName)
  }
  return output
}
```

### Step 5.4 — Commit

```bash
git add src/commands/bank-transactions/attachments/
git commit -m "feat: add bank transaction attachment commands (upload, list, download)"
```

---

## Task 6: Quotes attachment commands

**Files:**
- Create: `src/commands/quotes/attachments/upload.ts`
- Create: `src/commands/quotes/attachments/list.ts`
- Create: `src/commands/quotes/attachments/download.ts`

### Step 6.1 — Create `src/commands/quotes/attachments/upload.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {uploadAttachment} from '../../../lib/attachments.js'

export default class QuotesAttachmentsUpload extends BaseCommand {
  static override description = 'Upload an attachment to a quote'

  static override examples = [
    '<%= config.bin %> quotes attachments upload --quote-id abc-123 --file proposal.pdf',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'quote-id': Flags.string({description: 'Quote ID', required: true}),
    file: Flags.string({description: 'Path to file to upload', required: true}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(QuotesAttachmentsUpload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      uploadAttachment(xero, tenantId, 'quote', flags['quote-id'], flags.file, false),
    )

    const r = result as Record<string, unknown>
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Attachment uploaded: ${r.fileName} (${r.attachmentID})`)
    }
  }
}
```

### Step 6.2 — Create `src/commands/quotes/attachments/list.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {listAttachments} from '../../../lib/attachments.js'

export default class QuotesAttachmentsList extends BaseCommand {
  static override description = 'List attachments on a quote'

  static override examples = [
    '<%= config.bin %> quotes attachments list --quote-id abc-123',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'quote-id': Flags.string({description: 'Quote ID', required: true}),
  }

  private readonly columns = [
    {key: 'attachmentID', header: 'ID'},
    {key: 'fileName', header: 'File Name'},
    {key: 'mimeType', header: 'Type'},
    {key: 'contentLength', header: 'Size (bytes)'},
    {key: 'url', header: 'URL'},
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(QuotesAttachmentsList)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      listAttachments(xero, tenantId, 'quote', flags['quote-id']),
    )

    this.outputFormatted(result as unknown as Record<string, unknown>[], this.columns, flags)
  }
}
```

### Step 6.3 — Create `src/commands/quotes/attachments/download.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {downloadAttachment} from '../../../lib/attachments.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

export default class QuotesAttachmentsDownload extends BaseCommand {
  static override description = 'Download an attachment from a quote'

  static override examples = [
    '<%= config.bin %> quotes attachments download --quote-id abc-123 --attachment-id def-456',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'quote-id': Flags.string({description: 'Quote ID', required: true}),
    'attachment-id': Flags.string({description: 'Attachment ID', required: true}),
    output: Flags.string({description: 'Output path (file or directory). Defaults to current directory.'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(QuotesAttachmentsDownload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      downloadAttachment(xero, tenantId, 'quote', flags['quote-id'], flags['attachment-id']),
    )

    const {fileName, data} = result as {fileName: string; data: Buffer}
    const outputPath = resolveOutputPath(flags.output, fileName)
    fs.writeFileSync(outputPath, data)
    this.log(`Saved: ${outputPath}`)
  }
}

function resolveOutputPath(output: string | undefined, fileName: string): string {
  if (!output) return path.join(process.cwd(), fileName)
  if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
    return path.join(output, fileName)
  }
  return output
}
```

### Step 6.4 — Commit

```bash
git add src/commands/quotes/attachments/
git commit -m "feat: add quote attachment commands (upload, list, download)"
```

---

## Task 7: Contacts attachment commands

**Files:**
- Create: `src/commands/contacts/attachments/upload.ts`
- Create: `src/commands/contacts/attachments/list.ts`
- Create: `src/commands/contacts/attachments/download.ts`

### Step 7.1 — Create `src/commands/contacts/attachments/upload.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {uploadAttachment} from '../../../lib/attachments.js'

export default class ContactsAttachmentsUpload extends BaseCommand {
  static override description = 'Upload an attachment to a contact'

  static override examples = [
    '<%= config.bin %> contacts attachments upload --contact-id abc-123 --file contract.pdf',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'contact-id': Flags.string({description: 'Contact ID', required: true}),
    file: Flags.string({description: 'Path to file to upload', required: true}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ContactsAttachmentsUpload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      uploadAttachment(xero, tenantId, 'contact', flags['contact-id'], flags.file, false),
    )

    const r = result as Record<string, unknown>
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Attachment uploaded: ${r.fileName} (${r.attachmentID})`)
    }
  }
}
```

### Step 7.2 — Create `src/commands/contacts/attachments/list.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {listAttachments} from '../../../lib/attachments.js'

export default class ContactsAttachmentsList extends BaseCommand {
  static override description = 'List attachments on a contact'

  static override examples = [
    '<%= config.bin %> contacts attachments list --contact-id abc-123',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'contact-id': Flags.string({description: 'Contact ID', required: true}),
  }

  private readonly columns = [
    {key: 'attachmentID', header: 'ID'},
    {key: 'fileName', header: 'File Name'},
    {key: 'mimeType', header: 'Type'},
    {key: 'contentLength', header: 'Size (bytes)'},
    {key: 'url', header: 'URL'},
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(ContactsAttachmentsList)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      listAttachments(xero, tenantId, 'contact', flags['contact-id']),
    )

    this.outputFormatted(result as unknown as Record<string, unknown>[], this.columns, flags)
  }
}
```

### Step 7.3 — Create `src/commands/contacts/attachments/download.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {downloadAttachment} from '../../../lib/attachments.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

export default class ContactsAttachmentsDownload extends BaseCommand {
  static override description = 'Download an attachment from a contact'

  static override examples = [
    '<%= config.bin %> contacts attachments download --contact-id abc-123 --attachment-id def-456',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'contact-id': Flags.string({description: 'Contact ID', required: true}),
    'attachment-id': Flags.string({description: 'Attachment ID', required: true}),
    output: Flags.string({description: 'Output path (file or directory). Defaults to current directory.'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ContactsAttachmentsDownload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      downloadAttachment(xero, tenantId, 'contact', flags['contact-id'], flags['attachment-id']),
    )

    const {fileName, data} = result as {fileName: string; data: Buffer}
    const outputPath = resolveOutputPath(flags.output, fileName)
    fs.writeFileSync(outputPath, data)
    this.log(`Saved: ${outputPath}`)
  }
}

function resolveOutputPath(output: string | undefined, fileName: string): string {
  if (!output) return path.join(process.cwd(), fileName)
  if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
    return path.join(output, fileName)
  }
  return output
}
```

### Step 7.4 — Commit

```bash
git add src/commands/contacts/attachments/
git commit -m "feat: add contact attachment commands (upload, list, download)"
```

---

## Task 8: Accounts attachment commands

**Files:**
- Create: `src/commands/accounts/attachments/upload.ts`
- Create: `src/commands/accounts/attachments/list.ts`
- Create: `src/commands/accounts/attachments/download.ts`

### Step 8.1 — Create `src/commands/accounts/attachments/upload.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {uploadAttachment} from '../../../lib/attachments.js'

export default class AccountsAttachmentsUpload extends BaseCommand {
  static override description = 'Upload an attachment to an account'

  static override examples = [
    '<%= config.bin %> accounts attachments upload --account-id abc-123 --file statement.pdf',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'account-id': Flags.string({description: 'Account ID', required: true}),
    file: Flags.string({description: 'Path to file to upload', required: true}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AccountsAttachmentsUpload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      uploadAttachment(xero, tenantId, 'account', flags['account-id'], flags.file, false),
    )

    const r = result as Record<string, unknown>
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Attachment uploaded: ${r.fileName} (${r.attachmentID})`)
    }
  }
}
```

### Step 8.2 — Create `src/commands/accounts/attachments/list.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {listAttachments} from '../../../lib/attachments.js'

export default class AccountsAttachmentsList extends BaseCommand {
  static override description = 'List attachments on an account'

  static override examples = [
    '<%= config.bin %> accounts attachments list --account-id abc-123',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'account-id': Flags.string({description: 'Account ID', required: true}),
  }

  private readonly columns = [
    {key: 'attachmentID', header: 'ID'},
    {key: 'fileName', header: 'File Name'},
    {key: 'mimeType', header: 'Type'},
    {key: 'contentLength', header: 'Size (bytes)'},
    {key: 'url', header: 'URL'},
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(AccountsAttachmentsList)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      listAttachments(xero, tenantId, 'account', flags['account-id']),
    )

    this.outputFormatted(result as unknown as Record<string, unknown>[], this.columns, flags)
  }
}
```

### Step 8.3 — Create `src/commands/accounts/attachments/download.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {downloadAttachment} from '../../../lib/attachments.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

export default class AccountsAttachmentsDownload extends BaseCommand {
  static override description = 'Download an attachment from an account'

  static override examples = [
    '<%= config.bin %> accounts attachments download --account-id abc-123 --attachment-id def-456',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'account-id': Flags.string({description: 'Account ID', required: true}),
    'attachment-id': Flags.string({description: 'Attachment ID', required: true}),
    output: Flags.string({description: 'Output path (file or directory). Defaults to current directory.'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AccountsAttachmentsDownload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      downloadAttachment(xero, tenantId, 'account', flags['account-id'], flags['attachment-id']),
    )

    const {fileName, data} = result as {fileName: string; data: Buffer}
    const outputPath = resolveOutputPath(flags.output, fileName)
    fs.writeFileSync(outputPath, data)
    this.log(`Saved: ${outputPath}`)
  }
}

function resolveOutputPath(output: string | undefined, fileName: string): string {
  if (!output) return path.join(process.cwd(), fileName)
  if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
    return path.join(output, fileName)
  }
  return output
}
```

### Step 8.4 — Commit

```bash
git add src/commands/accounts/attachments/
git commit -m "feat: add account attachment commands (upload, list, download)"
```

---

## Task 9: Manual journals attachment commands

**Files:**
- Create: `src/commands/manual-journals/attachments/upload.ts`
- Create: `src/commands/manual-journals/attachments/list.ts`
- Create: `src/commands/manual-journals/attachments/download.ts`

### Step 9.1 — Create `src/commands/manual-journals/attachments/upload.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {uploadAttachment} from '../../../lib/attachments.js'

export default class ManualJournalsAttachmentsUpload extends BaseCommand {
  static override description = 'Upload an attachment to a manual journal'

  static override examples = [
    '<%= config.bin %> manual-journals attachments upload --manual-journal-id abc-123 --file backup.pdf',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'manual-journal-id': Flags.string({description: 'Manual Journal ID', required: true}),
    file: Flags.string({description: 'Path to file to upload', required: true}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ManualJournalsAttachmentsUpload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      uploadAttachment(xero, tenantId, 'manualJournal', flags['manual-journal-id'], flags.file, false),
    )

    const r = result as Record<string, unknown>
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Attachment uploaded: ${r.fileName} (${r.attachmentID})`)
    }
  }
}
```

### Step 9.2 — Create `src/commands/manual-journals/attachments/list.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {listAttachments} from '../../../lib/attachments.js'

export default class ManualJournalsAttachmentsList extends BaseCommand {
  static override description = 'List attachments on a manual journal'

  static override examples = [
    '<%= config.bin %> manual-journals attachments list --manual-journal-id abc-123',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'manual-journal-id': Flags.string({description: 'Manual Journal ID', required: true}),
  }

  private readonly columns = [
    {key: 'attachmentID', header: 'ID'},
    {key: 'fileName', header: 'File Name'},
    {key: 'mimeType', header: 'Type'},
    {key: 'contentLength', header: 'Size (bytes)'},
    {key: 'url', header: 'URL'},
  ]

  async run(): Promise<void> {
    const {flags} = await this.parse(ManualJournalsAttachmentsList)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      listAttachments(xero, tenantId, 'manualJournal', flags['manual-journal-id']),
    )

    this.outputFormatted(result as unknown as Record<string, unknown>[], this.columns, flags)
  }
}
```

### Step 9.3 — Create `src/commands/manual-journals/attachments/download.ts`

```typescript
import {Flags} from '@oclif/core'
import {BaseCommand} from '../../../base-command.js'
import {downloadAttachment} from '../../../lib/attachments.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

export default class ManualJournalsAttachmentsDownload extends BaseCommand {
  static override description = 'Download an attachment from a manual journal'

  static override examples = [
    '<%= config.bin %> manual-journals attachments download --manual-journal-id abc-123 --attachment-id def-456',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'manual-journal-id': Flags.string({description: 'Manual Journal ID', required: true}),
    'attachment-id': Flags.string({description: 'Attachment ID', required: true}),
    output: Flags.string({description: 'Output path (file or directory). Defaults to current directory.'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ManualJournalsAttachmentsDownload)

    const result = await this.xeroCall(flags, async (xero, tenantId) =>
      downloadAttachment(xero, tenantId, 'manualJournal', flags['manual-journal-id'], flags['attachment-id']),
    )

    const {fileName, data} = result as {fileName: string; data: Buffer}
    const outputPath = resolveOutputPath(flags.output, fileName)
    fs.writeFileSync(outputPath, data)
    this.log(`Saved: ${outputPath}`)
  }
}

function resolveOutputPath(output: string | undefined, fileName: string): string {
  if (!output) return path.join(process.cwd(), fileName)
  if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
    return path.join(output, fileName)
  }
  return output
}
```

### Step 9.4 — Commit

```bash
git add src/commands/manual-journals/attachments/
git commit -m "feat: add manual journal attachment commands (upload, list, download)"
```

---

## Task 10: Full test suite + build verification

### Step 10.1 — Run all tests

```bash
npm test
```

Expected: all existing tests PASS plus all new attachment tests PASS. Zero failures.

### Step 10.2 — Build

```bash
npm run build
```

Expected: exits 0, no TypeScript errors.

### Step 10.3 — Smoke test via dev mode

```bash
# List attachments on the most recent invoice (use an ID from earlier)
npm run dev -- invoices attachments list --invoice-id 182492f9-496e-4e8a-a8b3-a19b1f9dd6fc

# Upload a test file
echo "test" > /tmp/test-attach.txt
npm run dev -- invoices attachments upload --invoice-id 182492f9-496e-4e8a-a8b3-a19b1f9dd6fc --file /tmp/test-attach.txt

# List again to see the new attachment and note its ID
npm run dev -- invoices attachments list --invoice-id 182492f9-496e-4e8a-a8b3-a19b1f9dd6fc

# Download it (replace ATTACHMENT_ID with the ID from the list above)
npm run dev -- invoices attachments download --invoice-id 182492f9-496e-4e8a-a8b3-a19b1f9dd6fc --attachment-id <ATTACHMENT_ID> --output /tmp/
```

Expected: each command completes without error.

### Step 10.4 — Final commit

```bash
git add docs/superpowers/specs/2026-04-14-attachments-design.md
git commit -m "docs: update attachment spec (no delete, includeOnline for creditNote, SDK references)"
```

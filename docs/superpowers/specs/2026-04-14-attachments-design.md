# Attachment Commands Design

**Date:** 2026-04-14
**Status:** Approved

## Overview

Add `attachments` sub-commands to all Xero resource topics that support file attachments via the Xero API. Each resource gets three commands: `upload`, `list`, `download`. Delete is not supported by the Xero Accounting API.

## Resources in Scope

The following existing CLI topics will gain an `attachments` sub-topic:

- `invoices`
- `credit-notes`
- `bank-transactions`
- `quotes`
- `contacts`
- `accounts`
- `manual-journals`

## Command Structure

Each resource follows this pattern (shown for `invoices`):

```
xero invoices attachments upload   --invoice-id <ID> --file <path> [--include-online]
xero invoices attachments list     --invoice-id <ID>
xero invoices attachments download --invoice-id <ID> --attachment-id <ID> [--output <path>]
```

The ID flag name matches the resource (e.g. `--credit-note-id`, `--contact-id`, `--account-id`, etc.).

### upload

- `--<resource>-id <ID>` — required
- `--file <path>` — required, local filesystem path
- `--include-online` — optional flag (invoices and credit-notes only), exposes attachment in Xero's online invoice/credit note view

Filename stored in Xero = `path.basename(--file)`. No `--name` override.

Pre-flight validations (before API call):
1. File exists
2. File ≤ 25MB
3. Extension is a recognised MIME type

Prints returned `attachmentID` and `fileName` on success.

### list

- `--<resource>-id <ID>` — required

Table output columns: `attachmentID`, `fileName`, `mimeType`, `contentLength`, `url`

Supports `--json` and `--csv` output flags inherited from `BaseCommand.baseFlags`.

### download

- `--<resource>-id <ID>` — required
- `--attachment-id <ID>` — required
- `--output <path>` — optional, destination path. If omitted, saves to the current working directory using the attachment's original filename. If `--output` points to an existing directory, the file is saved inside it with the original filename. If `--output` is a full file path, it is used as-is.

The lib resolves the original filename by calling `listAttachments` internally before downloading (one extra API call). Prints saved path on success.

## Architecture

### Shared lib: `src/lib/attachments.ts`

All API logic lives here. Command files are thin (parse flags → call `this.xeroCall` → delegate to lib → format output).

Exports:

```ts
type AttachmentResource =
  'invoice' | 'creditNote' | 'bankTransaction' | 'quote' |
  'contact' | 'account' | 'manualJournal'

function uploadAttachment(
  xero: XeroClient,
  tenantId: string,
  resource: AttachmentResource,
  resourceId: string,
  filePath: string,
  includeOnline?: boolean,
): Promise<Attachment>

function listAttachments(
  xero: XeroClient,
  tenantId: string,
  resource: AttachmentResource,
  resourceId: string,
): Promise<Attachment[]>

function downloadAttachment(
  xero: XeroClient,
  tenantId: string,
  resource: AttachmentResource,
  resourceId: string,
  attachmentId: string,
): Promise<{ fileName: string; data: Buffer }>

```

Internally, a dispatch map routes each `AttachmentResource` to its corresponding `xero.accountingApi` SDK methods:

```ts
const dispatch: Record<AttachmentResource, ResourceMethods> = {
  invoice:         { upload: ..., list: ..., download: ... },
  creditNote:      { upload: ..., list: ..., download: ... },
  bankTransaction: { upload: ..., list: ..., download: ... },
  quote:           { upload: ..., list: ..., download: ... },
  contact:         { upload: ..., list: ..., download: ... },
  account:         { upload: ..., list: ..., download: ... },
  manualJournal:   { upload: ..., list: ..., download: ... },
}
```

### MIME detection

Implemented in `src/lib/attachments.ts` with no new npm dependencies. Uses `path.extname` + a lookup map:

| Extension | Content-Type |
|---|---|
| `.pdf` | `application/pdf` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.xml` | `application/xml` |
| `.csv` | `text/csv` |
| `.txt` | `text/plain` |

Unknown extensions throw before the API call.

### File structure

```
src/
  lib/
    attachments.ts                          ← shared logic
  commands/
    invoices/attachments/
      upload.ts / list.ts / download.ts
    credit-notes/attachments/
      upload.ts / list.ts / download.ts
    bank-transactions/attachments/
      upload.ts / list.ts / download.ts
    quotes/attachments/
      upload.ts / list.ts / download.ts
    contacts/attachments/
      upload.ts / list.ts / download.ts
    accounts/attachments/
      upload.ts / list.ts / download.ts
    manual-journals/attachments/
      upload.ts / list.ts / download.ts

test/
  lib/
    attachments.test.ts
```

Total: 1 lib file + 21 command files + 1 test file.

## SDK Method Reference

All methods are on `xero.accountingApi`. Confirmed from xero-node v13 type declarations.

| Resource | Upload | List | Download by ID |
|---|---|---|---|
| invoice | `createInvoiceAttachmentByFileName(tenantId, invoiceID, fileName, stream, includeOnline?)` | `getInvoiceAttachments(tenantId, invoiceID)` | `getInvoiceAttachmentById(tenantId, invoiceID, attachmentID, contentType)` |
| creditNote | `createCreditNoteAttachmentByFileName(tenantId, creditNoteID, fileName, stream, includeOnline?)` | `getCreditNoteAttachments(tenantId, creditNoteID)` | `getCreditNoteAttachmentById(tenantId, creditNoteID, attachmentID, contentType)` |
| bankTransaction | `createBankTransactionAttachmentByFileName(tenantId, bankTransactionID, fileName, stream)` | `getBankTransactionAttachments(tenantId, bankTransactionID)` | `getBankTransactionAttachmentById(tenantId, bankTransactionID, attachmentID, contentType)` |
| quote | `createQuoteAttachmentByFileName(tenantId, quoteID, fileName, stream)` | `getQuoteAttachments(tenantId, quoteID)` | `getQuoteAttachmentById(tenantId, quoteID, attachmentID, contentType)` |
| contact | `createContactAttachmentByFileName(tenantId, contactID, fileName, stream)` | `getContactAttachments(tenantId, contactID)` | `getContactAttachmentById(tenantId, contactID, attachmentID, contentType)` |
| account | `createAccountAttachmentByFileName(tenantId, accountID, fileName, stream)` | `getAccountAttachments(tenantId, accountID)` | `getAccountAttachmentById(tenantId, accountID, attachmentID, contentType)` |
| manualJournal | `createManualJournalAttachmentByFileName(tenantId, manualJournalID, fileName, stream)` | `getManualJournalAttachments(tenantId, manualJournalID)` | `getManualJournalAttachmentById(tenantId, manualJournalID, attachmentID, contentType)` |

- All `list` methods return `{body: Attachments}` where `Attachments` has an `attachments` array.
- All `getById` methods return `{body: Buffer}`.
- `includeOnline` is only available on `createInvoiceAttachmentByFileName` and `createCreditNoteAttachmentByFileName`.
- `downloadAttachment` calls `listAttachments` first internally to resolve `fileName` and `mimeType` from the given `attachmentId`, then calls `getById` with that `mimeType` as `contentType`.

## Error Handling

| Condition | Behaviour |
|---|---|
| File not found | Error before API call: `File not found: <path>` |
| File > 25MB | Error before API call: `File exceeds 25MB limit (actual: X MB)` |
| Unknown extension | Error before API call: `Unsupported file type: .xyz` |
| Output path not writable | Error after download attempt: `Cannot write to <path>` |
| Xero 404 | Handled by existing `withRetry` → `Resource not found.` |
| Xero validation error | Handled by existing `sanitizeApiError` |

## Testing

Tests in `test/lib/attachments.test.ts` (mirrors `src/lib/` pattern; no command-level tests per project convention). Xero SDK calls are mocked.

Test cases:
- MIME lookup: known extensions return correct Content-Type
- MIME lookup: unknown extension throws
- `uploadAttachment`: throws if file not found
- `uploadAttachment`: throws if file > 25MB
- `uploadAttachment`: calls correct SDK method per resource type with correct args
- `listAttachments`: returns mapped attachment array
- `downloadAttachment`: returns buffer + original filename

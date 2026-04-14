# Attachment Commands Design

**Date:** 2026-04-14
**Status:** Approved

## Overview

Add `attachments` sub-commands to all Xero resource topics that support file attachments via the Xero API. Each resource gets four commands: `upload`, `list`, `download`, `delete`.

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
xero invoices attachments delete   --invoice-id <ID> --attachment-id <ID>
```

The ID flag name matches the resource (e.g. `--credit-note-id`, `--contact-id`, `--account-id`, etc.).

### upload

- `--<resource>-id <ID>` — required
- `--file <path>` — required, local filesystem path
- `--include-online` — optional flag (invoices only), exposes attachment in Xero's online invoice view

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

### delete

- `--<resource>-id <ID>` — required
- `--attachment-id <ID>` — required

Prints confirmation on success. No output format flags.

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

function deleteAttachment(
  xero: XeroClient,
  tenantId: string,
  resource: AttachmentResource,
  resourceId: string,
  attachmentId: string,
): Promise<void>
```

Internally, a dispatch map routes each `AttachmentResource` to its corresponding `xero.accountingApi` SDK methods:

```ts
const dispatch: Record<AttachmentResource, ResourceMethods> = {
  invoice:         { upload: ..., list: ..., download: ..., delete: ... },
  creditNote:      { upload: ..., list: ..., download: ..., delete: ... },
  bankTransaction: { upload: ..., list: ..., download: ..., delete: ... },
  quote:           { upload: ..., list: ..., download: ..., delete: ... },
  contact:         { upload: ..., list: ..., download: ..., delete: ... },
  account:         { upload: ..., list: ..., download: ..., delete: ... },
  manualJournal:   { upload: ..., list: ..., download: ..., delete: ... },
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
      upload.ts / list.ts / download.ts / delete.ts
    credit-notes/attachments/
      upload.ts / list.ts / download.ts / delete.ts
    bank-transactions/attachments/
      upload.ts / list.ts / download.ts / delete.ts
    quotes/attachments/
      upload.ts / list.ts / download.ts / delete.ts
    contacts/attachments/
      upload.ts / list.ts / download.ts / delete.ts
    accounts/attachments/
      upload.ts / list.ts / download.ts / delete.ts
    manual-journals/attachments/
      upload.ts / list.ts / download.ts / delete.ts

test/
  lib/
    attachments.test.ts
```

Total: 1 lib file + 28 command files + 1 test file.

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
- `deleteAttachment`: calls correct SDK delete method per resource type

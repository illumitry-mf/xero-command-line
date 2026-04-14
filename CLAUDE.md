# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (no build step required)
npm run dev -- <command>        # e.g. npm run dev -- contacts list

# Build
npm run build                   # tsc -b

# Tests
npm test                        # vitest run (all tests)
npm run test:watch              # vitest in watch mode
npx vitest run test/lib/formatters.test.ts   # run a single test file
```

Tests live in `test/lib/` and mirror the `src/lib/` structure. No tests exist for commands — only for lib utilities.

## Architecture

This is an [oclif](https://oclif.io)-based CLI (`xero`) written in TypeScript (ESM). The entry point is `bin/run.js`; oclif auto-discovers commands from `dist/commands/` after a build. In dev mode, `bin/dev.js` + `ts-node` runs commands directly from `src/`.

### Command structure

All commands extend `BaseCommand` (`src/base-command.ts`), which provides:
- `static baseFlags` — shared flags: `--profile`, `--client-id`, `--json`, `--csv`, `--toon`
- `resolveCredentials(flags)` — resolves profile name + client ID (env var → flag → named profile → default profile)
- `xeroCall(flags, operation)` — wraps `withRetry`; the primary way commands call the API
- `outputFormatted(data, columns, flags)` — renders table/json/csv/toon output
- `readJsonFile(path)` — reads and parses a `--file` JSON payload

Commands follow the topic/verb layout: `src/commands/<topic>/<verb>.ts` (e.g. `src/commands/invoices/list.ts`). Topics are declared in `package.json` under `oclif.topics`.

### Data flow

```
Command.run()
  → this.xeroCall(flags, async (xero, tenantId) => { ... })
      → withRetry() in src/lib/xero-client.ts
          → createXeroClient() — loads cached token, refreshes if expired
          → operation(xero, tenantId)   ← actual xero-node API call
  → this.outputFormatted(results, columns, flags)
      → formatOutput() in src/lib/formatters.ts
```

### Key lib modules

| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | Read/write plaintext token cache (`~/.config/xero-command-line/tokens.json`); env var override via `XERO_ACCESS_TOKEN` etc. |
| `src/lib/oauth.ts` | PKCE OAuth flow: starts local callback server on `:8742`, exchanges code for tokens |
| `src/lib/profiles.ts` | Profile storage (client IDs), default profile tracking |
| `src/lib/formatters.ts` | `formatOutput()`, `formatDate()`, `formatCurrency()`, `formatStatus()` |
| `src/lib/validators.ts` | Zod schemas for `--file` JSON payloads |
| `src/lib/xero-client.ts` | `createXeroClient()`, `withRetry()` (handles 401 refresh, 429 rate limit, Xero validation errors) |
| `src/lib/get-client-headers.ts` | Injects `User-Agent` / version headers into every API request |

### Adding a new command

1. Create `src/commands/<topic>/<verb>.ts` extending `BaseCommand`.
2. Define `static flags = { ...BaseCommand.baseFlags, ... }` for topic-specific flags.
3. Use `this.xeroCall(flags, async (xero, tenantId) => { ... })` for API calls.
4. Use `this.outputFormatted(rows, columns, flags)` for output; define `columns` as `{key, header, format?}[]`. Dot-notation keys (e.g. `'contact.name'`) are supported for nested values.
5. If the command accepts `--file`, validate the parsed JSON with a Zod schema in `src/lib/validators.ts`.
6. Add the topic to `oclif.topics` in `package.json` if it's new.

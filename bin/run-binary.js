#!/usr/bin/env node

import {run} from '@oclif/core'
import {mkdirSync, writeFileSync, existsSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import pjson from '../package.json'
import manifest from '../oclif.manifest.json'

// Use a stable temp directory as the oclif root so it can find the manifest
const root = join(tmpdir(), 'xero-cli')
if (!existsSync(root)) mkdirSync(root, {recursive: true})
writeFileSync(join(root, 'oclif.manifest.json'), JSON.stringify(manifest))

// Strip external plugins — they can't be loaded from a single binary
const binaryPjson = {...pjson, oclif: {...pjson.oclif, plugins: []}}

await run(process.argv.slice(2), {root, pjson: binaryPjson, isRoot: true})

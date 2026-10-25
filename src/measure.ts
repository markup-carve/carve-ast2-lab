import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, toAstJson, fromAstJson, renderCarve } from '@markup-carve/carve'
import { Ajv2020 } from 'ajv/dist/2020.js'

export const SPEC_DIR = fileURLToPath(new URL('../spec/', import.meta.url))
export const CORPUS_DIR = join(SPEC_DIR, 'tests/corpus')

export function corpusFiles(dir = CORPUS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.crv'))
    .sort()
    .map((f) => join(dir, f))
}

export function loadValidator(schemaPath: string) {
  const ajv = new Ajv2020({ allErrors: false, strict: false })
  return ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')))
}

export interface DocResult {
  file: string
  valid: boolean
  schemaError?: string
  // `fmt` written from the serialized tree matches `fmt` written from the parse.
  fmtFromTree: boolean
  bytes: number
  nodes: number
  error?: string
}

export function countNodes(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countNodes(v), 0)
  if (value === null || typeof value !== 'object') return 0
  const self = typeof (value as { type?: unknown }).type === 'string' ? 1 : 0
  return self + Object.values(value).reduce((n: number, v) => n + countNodes(v), 0)
}

export function measureDoc(file: string, validate: ReturnType<typeof loadValidator>): DocResult {
  const source = readFileSync(file, 'utf8')
  try {
    const doc = parse(source)
    const json = toAstJson(doc)
    const valid = validate(json) as boolean
    const wire = JSON.stringify(json)
    const fmtFromTree = renderCarve(fromAstJson(JSON.parse(wire))) === renderCarve(doc)
    return {
      file,
      valid,
      schemaError: valid ? undefined : `${validate.errors?.[0]?.instancePath} ${validate.errors?.[0]?.message}`,
      fmtFromTree,
      bytes: Buffer.byteLength(wire),
      nodes: countNodes(json),
    }
  } catch (e) {
    return { file, valid: false, fmtFromTree: false, bytes: 0, nodes: 0, error: String(e) }
  }
}

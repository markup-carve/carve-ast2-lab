import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parse, toAstJson, fromAstJson, renderCarve } from '@markup-carve/carve'
import { corpusFiles, countNodes, loadValidator, SPEC_DIR } from './measure.ts'
import { upgrade } from './upgrade.ts'
import { downgrade } from './downgrade.ts'

const validate12 = loadValidator(join(SPEC_DIR, 'resources/ast-schema.json'))
const validate20 = loadValidator('schema/ast-schema-2.0.json')
const results = corpusFiles().map((file) => {
  try {
    const parsed = parse(readFileSync(file, 'utf8'))
    const original = toAstJson(parsed)
    const next = upgrade(original as any)
    const valid20 = validate20(next) as boolean
    const schemaError = valid20 ? undefined : `${validate20.errors?.[0]?.instancePath} ${validate20.errors?.[0]?.message}`
    const { tree: previous, losses } = downgrade(next)
    const valid12 = validate12(previous) as boolean
    const roundTripEqual = isDeepStrictEqual(previous, original)
    const fmtEqual = renderCarve(fromAstJson(previous as any)) === renderCarve(parsed)
    return { file: basename(file), valid20, schemaError, valid12, downgradeError: valid12 ? undefined : `${validate12.errors?.[0]?.instancePath} ${validate12.errors?.[0]?.message}`, roundTripEqual, fmtEqual, losses, bytes12: Buffer.byteLength(JSON.stringify(original)), bytes20: Buffer.byteLength(JSON.stringify(next)), nodes12: countNodes(original), nodes20: countNodes(next) }
  } catch (error) {
    return { file: basename(file), valid20: false, valid12: false, roundTripEqual: false, fmtEqual: false, error: String(error), bytes12: 0, bytes20: 0, nodes12: 0, nodes20: 0, losses: [] as string[] }
  }
})
const sum = (key: 'bytes12' | 'bytes20' | 'nodes12' | 'nodes20') => results.reduce((n, result) => n + result[key], 0)
const summary = {
  contract: '2.0-draft', documents: results.length,
  schemaValid: results.filter((r) => r.valid20).length,
  downgradeValid: results.filter((r) => r.valid12).length,
  roundTripEqual: results.filter((r) => r.roundTripEqual).length,
  fmtEqual: results.filter((r) => r.fmtEqual).length,
  totalBytes12: sum('bytes12'), totalBytes20: sum('bytes20'),
  totalNodes12: sum('nodes12'), totalNodes20: sum('nodes20'),
  invalid20: results.filter((r) => !r.valid20).map((r) => ({ file: r.file, why: r.error ?? r.schemaError })),
  invalid12: results.filter((r) => !r.valid12).map((r) => ({ file: r.file, why: r.error ?? r.downgradeError })),
  roundTripMismatch: results.filter((r) => !r.roundTripEqual).map((r) => ({ file: r.file, why: r.error ?? 'tree differs' })),
  fmtMismatch: results.filter((r) => !r.fmtEqual).map((r) => ({ file: r.file, why: r.error ?? 'fmt differs' })),
  losses: results.filter((r) => r.losses.length).map((r) => ({ file: r.file, paths: r.losses })),
}
mkdirSync('results', { recursive: true })
writeFileSync('results/measure-2.0-draft.json', JSON.stringify(summary, null, 2) + '\n')
const { invalid20, invalid12, roundTripMismatch, fmtMismatch, losses, ...head } = summary
console.log(head, { invalid20: invalid20.length, invalid12: invalid12.length, roundTripMismatch: roundTripMismatch.length, fmtMismatch: fmtMismatch.length, losses: losses.length })

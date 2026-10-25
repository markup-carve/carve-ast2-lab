// Measures the 1.2 contract over the pinned corpus, as the reference every 2.0 draft is compared with.
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { corpusFiles, loadValidator, measureDoc, SPEC_DIR } from './measure.ts'

const validate = loadValidator(join(SPEC_DIR, 'resources/ast-schema.json'))
const results = corpusFiles().map((f) => measureDoc(f, validate))

const summary = {
  contract: '1.2',
  documents: results.length,
  schemaValid: results.filter((r) => r.valid).length,
  fmtFromTree: results.filter((r) => r.fmtFromTree).length,
  errors: results.filter((r) => r.error).length,
  totalBytes: results.reduce((n, r) => n + r.bytes, 0),
  totalNodes: results.reduce((n, r) => n + r.nodes, 0),
  invalid: results.filter((r) => !r.valid).map((r) => ({ file: basename(r.file), why: r.error ?? r.schemaError })),
  fmtMismatch: results.filter((r) => !r.fmtFromTree && !r.error).map((r) => basename(r.file)),
}

mkdirSync('results', { recursive: true })
writeFileSync('results/baseline-1.2.json', JSON.stringify(summary, null, 2) + '\n')
const { invalid, fmtMismatch, ...head } = summary
console.log(head, { invalid: invalid.length, fmtMismatch: fmtMismatch.length })

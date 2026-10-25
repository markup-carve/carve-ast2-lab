import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse, toAstJson, fromAstJson, renderCarve } from '@markup-carve/carve'
import { corpusFiles, loadValidator, measureDoc, SPEC_DIR } from '../src/measure.ts'

const validate = loadValidator(join(SPEC_DIR, 'resources/ast-schema.json'))

describe('1.2 harness', () => {
  it('finds the pinned corpus', () => {
    expect(corpusFiles().length).toBeGreaterThan(3000)
  })

  it('measures a corpus document as valid and fmt-stable', () => {
    const r = measureDoc(corpusFiles()[0], validate)
    expect(r).toMatchObject({ valid: true, fmtFromTree: true })
    expect(r.nodes).toBeGreaterThan(0)
  })

  // Negative controls: a harness that cannot fail proves nothing.
  it('rejects an unknown field', () => {
    const json = toAstJson(parse('# Title\n')) as unknown as { children: Record<string, unknown>[] }
    json.children[0].bogus = true
    expect(validate(json)).toBe(false)
  })

  it('sees fmt drift when a spelling field is dropped', () => {
    const source = '* a\n* b\n'
    const json = toAstJson(parse(source)) as unknown as { children: Record<string, unknown>[] }
    expect(json.children[0].bulletChar).toBe('*')
    delete json.children[0].bulletChar
    expect(renderCarve(fromAstJson(json))).not.toBe(renderCarve(parse(source)))
  })
})

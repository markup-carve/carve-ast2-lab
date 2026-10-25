import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { coverage, slots20 } from '../src/consumers/walk.ts'
import { toPandoc, validatePandoc } from '../src/consumers/pandoc.ts'
import { toDocx, validateDocx } from '../src/consumers/docx.ts'
import { parse, toAstJson } from '@markup-carve/carve'
import { upgrade } from '../src/upgrade.ts'

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0
if (!hasPandoc) console.warn('pandoc is missing; Pandoc and DOCX consumer tests are skipped')
const text = (value: string) => ({ type: 'text', value })
const paragraph = (value: string) => ({ type: 'paragraph', children: [text(value)] })
const document = (children: any[]) => ({ type: 'document', children })
const table = { type: 'table', caption: { type: 'caption', children: [paragraph('Caption text')] }, columns: [{ type: 'table_column', resolvedAlign: 'right' }], children: [{ type: 'table_head', children: [{ type: 'table_row', children: [{ type: 'table_cell', children: [{ type: 'cell_paragraph', children: [text('Header')] }] }] }] }, { type: 'table_body', children: [{ type: 'table_row', children: [{ type: 'table_cell', children: [{ type: 'cell_paragraph', children: [text('Body')] }] }] }] }] }

describe('consumer walker', () => {
  it('reaches secondary caption and column slots', () => {
    const result = coverage(document([table]), slots20)
    expect(result.missing).toEqual([])
    expect(result.childrenReached).toBeLessThan(result.total)
  })
  it('fails coverage when a secondary slot is hidden', () => {
    const broken = { ...slots20, table: ['children'] }
    expect(coverage(document([table]), broken).missing).toContain('/children/0/caption')
  })
})

describe.skipIf(!hasPandoc)('Pandoc consumers', () => {
  it('accepts tables and preserves constructors', () => {
    const checked = validatePandoc(toPandoc(document([table])).doc)
    expect(checked.ok).toBe(true)
    expect(checked.native).toContain('Table')
    expect(checked.native).toContain('Header')
  })
  it('writes a referenced footnote as a Pandoc Note', () => {
    const tree = document([paragraph('Before'), { type: 'footnote', key: 'a', children: [paragraph('Footnote body')] }, { type: 'paragraph', children: [{ type: 'footnote_ref', key: 'a' }] }])
    const result = toPandoc(tree)
    expect(result.losses).toEqual([])
    expect(validatePandoc(result.doc).native).toContain('Note')
  })
  it('rejects a broken Pandoc document', () => {
    expect(validatePandoc({ 'pandoc-api-version': [1, 23, 1], meta: {}, blocks: [{ t: 'Bogus' }] }).ok).toBe(false)
  })
  it('reads DOCX tables and captions', () => {
    const checked = validateDocx(toDocx(document([table])).bytes)
    expect(checked.ok).toBe(true)
    expect(JSON.stringify(checked.json)).toContain('Header')
    expect(JSON.stringify(checked.json)).toContain('Caption')
    expect(JSON.stringify(checked.json)).toContain('text')
  })
  it('preserves a colspan through the DOCX read', () => {
    const wide = document([{ type: 'table', children: [{ type: 'table_body', children: [{ type: 'table_row', children: [
      { type: 'table_cell', colspan: 2, children: [{ type: 'cell_paragraph', children: [text('wide')] }] },
      { type: 'table_cell', span: 'colspan', children: [] },
    ] }] }] }])
    const checked = validateDocx(toDocx(wide).bytes)
    expect(checked.ok).toBe(true)
    expect(checked.json?.blocks[0].c[4][0][3][0][1][0][3]).toBe(2)
  })
  it('rejects corrupt DOCX XML', () => {
    const bytes = toDocx(document([paragraph('Hi')])).bytes
    const broken = Buffer.from(bytes)
    const index = broken.indexOf('<w:document')
    expect(index).toBeGreaterThan(0)
    broken[index + 1] = 0
    expect(validateDocx(broken).ok).toBe(false)
  })
})

describe('trial writer review fixes', () => {
  it('DOCX reports inline markup it cannot write', () => {
    const tree = upgrade(toAstJson(parse('|= A |\n| *bold* |\n')) as any)
    expect(toDocx(tree).losses.some((l: any) => l.type === 'strong')).toBe(true)
  })

  it('Pandoc keeps the source column of a cell after a span marker', () => {
    const tree = upgrade(toAstJson(parse('|= A |= B |= C |\n| x |< | y |\n')) as any)
    tree.children[0].columns[1].resolvedAlign = 'right'
    tree.children[0].columns[2].resolvedAlign = 'center'
    const found: any[] = []
    const visit = (x: any) => {
      if (!Array.isArray(x)) { if (x && typeof x === 'object') Object.values(x).forEach(visit); return }
      if (x.length === 5 && typeof x[1]?.t === 'string' && x[1].t.startsWith('Align') && JSON.stringify(x[4]).includes('"y"')) found.push(x[1].t)
      x.forEach(visit)
    }
    visit(toPandoc(tree).doc)
    expect(found).toEqual(['AlignCenter'])
  })
})

describe('DOCX cell alignment', () => {
  it('sits on the paragraph holding the cell text', () => {
    const tree = upgrade(toAstJson(parse('|= A |\n| x |\n')) as any)
    tree.children[0].columns[0].resolvedAlign = 'right'
    const xml = toDocx(tree).bytes.toString('latin1')
    expect(xml).toMatch(/<w:jc w:val="right"\/><\/w:pPr><w:r><w:t xml:space="preserve">x</)
  })
})

describe('DOCX image placeholder', () => {
  it('is reported as a loss', () => {
    const tree = upgrade(toAstJson(parse('![a](x.png)\n^ Caption\n')) as any)
    expect(toDocx(tree).losses.some((l: any) => l.type === 'image')).toBe(true)
  })
})

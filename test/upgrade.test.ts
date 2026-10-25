import { describe, expect, it } from 'vitest'
import { parse, toAstJson, fromAstJson, renderCarve } from '@markup-carve/carve'
import { loadValidator } from '../src/measure.ts'
import { upgrade } from '../src/upgrade.ts'
import { downgrade } from '../src/downgrade.ts'

const validate20 = loadValidator('schema/ast-schema-2.0.json')
const validate12 = loadValidator('spec/resources/ast-schema.json')

function types(value: any): string[] {
  if (Array.isArray(value)) return value.flatMap(types)
  if (!value || typeof value !== 'object') return []
  return [...(value.type ? [value.type] : []), ...Object.values(value).flatMap(types)]
}

const cases: [string, string, string[]][] = [
  ['list', '* a\n* b\n', ['list', 'list_item']],
  ['task items', '- [ ] todo\n- [x] done\n', ['list', 'list_item']],
  ['table header defaults', '|=> a |\n|= b |\n| 1 |\n', ['table', 'table_column', 'table_head', 'table_body', 'table_cell']],
  ['table spans', '|= Wide|<|= Last|\n|a|b|c|\n', ['table', 'table_cell']],
  ['figure and caption', '![Apollo 11](apollo.jpg)\n^ Figure 1: First moon landing\n', ['figure', 'caption']],
  ['footnote', 'See[^n].\n\n[^n]: Note.\n', ['footnote', 'footnote_ref']],
  ['inline footnote', 'A note^[see *later*] inline.\n', ['inline_footnote']],
  ['reference', 'Read [intro][x].\n\n[x]: https://example.com\n', ['link_reference_definition', 'link']],
  ['abbreviation', 'The HTML spec.\n\n*[HTML]: HyperText Markup Language\n', ['abbreviation_def', 'abbreviation']],
  ['comment', 'Visible.\n\n%% hidden\n', ['comment']],
  ['math', 'Inline $`E = mc^2`.\n', ['math']],
  ['code block', '```python\nprint("hi")\n```\n', ['code_block']],
  ['image with alt', '![Apollo](apollo.jpg)\n', ['image']],
  ['image without alt', '![](apollo.jpg)\n', ['image']],
  ['extension', ':_[x]\n', ['inline_extension']],
]

describe('2.0 upgrade and downgrade', () => {
  for (const [name, source, expected] of cases) it(name, () => {
    const parsed = parse(source)
    const original = toAstJson(parsed)
    const next = upgrade(original as any)
    expect(validate20(next), JSON.stringify(validate20.errors?.[0])).toBe(true)
    for (const type of expected) expect(types(next)).toContain(type)
    const previous = downgrade(next)
    expect(previous.losses).toEqual([])
    expect(validate12(previous.tree)).toBe(true)
    expect(previous.tree).toEqual(original)
    expect(renderCarve(fromAstJson(previous.tree as any))).toBe(renderCarve(parsed))
  })

  it('preserves schema-valid 1.2 optional-field presence', () => {
    const original = toAstJson(parse('- a\n\n%% comment\n')) as any
    const list = original.children[0]
    list.bulletChar = '-'
    const comment = original.children.find((node: any) => node.type === 'comment')
    delete comment.form
    expect(validate12(original)).toBe(true)
    const next = upgrade(original)
    expect(validate20(next), JSON.stringify(validate20.errors?.[0])).toBe(true)
    expect(downgrade(next).tree).toEqual(original)
  })

  it('reports foreign data removed by downgrade', () => {
    const next = upgrade(toAstJson(parse('Text.\n')) as any)
    next.children[0].data = { 'org.example.editor': { cursor: 1 } }
    next.children[0].dir = 'rtl'
    expect(validate20(next)).toBe(true)
    const result = downgrade(next)
    expect(result.losses).toContain('/children/0/data/org.example.editor')
    expect(result.losses).toContain('/children/0/dir')
    expect(validate12(result.tree)).toBe(true)
  })

  it('rejects unknown core fields', () => {
    const next = upgrade(toAstJson(parse('# Title\n')) as any)
    next.children[0].bogus = true
    expect(validate20(next)).toBe(false)
  })

  it('rejects a 1.2 list slot', () => {
    const next = upgrade(toAstJson(parse('- a\n')) as any)
    next.children[0].items = next.children[0].children
    delete next.children[0].children
    expect(validate20(next)).toBe(false)
  })

  it('rejects a contradictory list marker', () => {
    const next = upgrade(toAstJson(parse('- a\n')) as any)
    next.children[0].marker.delimiter = '.'
    expect(validate20(next)).toBe(false)
  })

  it('rejects cell_wrap in a heading', () => {
    const next = upgrade(toAstJson(parse('# Title\n')) as any)
    next.children[0].children = [{ type: 'cell_wrap', line: 1 }]
    expect(validate20(next)).toBe(false)
  })
})

describe('reference namespace', () => {
  it('appears only with a key', () => {
    const tree = upgrade(toAstJson(parse('![a](x.png)\n')) as any)
    expect(JSON.stringify(tree)).not.toContain('"namespace"')
    expect(validate20(tree)).toBe(true)
    const image = JSON.parse(JSON.stringify(tree).replace('"type":"image"', '"type":"image","namespace":"link"'))
    expect(JSON.stringify(image)).toContain('"namespace":"link"')
    expect(validate20(image)).toBe(false)
  })
})

describe('table row groups', () => {
  it('are recounted from the current groups on downgrade', () => {
    const source = '{header-rows=2 footer-rows=1}\n| Region | Q1 |\n| Detail | EUR |\n|= North | 11 |\n|= South | 22 |\n| All | 33 |\n'
    expect(JSON.stringify(toAstJson(parse(source)))).toContain('"rowGroups"')
    const tree = upgrade(toAstJson(parse(source)) as any)
    const body = tree.children[0].children.find((g: any) => g.type === 'table_body')
    body.children.pop()
    const back = downgrade(tree).tree as any
    expect(validate12(back)).toBe(true)
    const groups = back.children[0].rowGroups
    const counted = groups.headRows + groups.footRows + groups.bodies.reduce((n: number, b: any) => n + b.headRows + b.bodyRows, 0)
    expect(back.children[0].rows.length).toBe(4)
    expect(counted).toBe(4)
  })
})

describe('downgrade of 2.0-only shapes', () => {
  it('reports a non-heading cross-reference as a loss', () => {
    const tree = upgrade(toAstJson(parse('# Intro {#intro}\n\nSee </#intro>.\n')) as any)
    const text = JSON.stringify(tree)
    expect(text).toContain('"type":"xref"')
    expect(text).toContain('"namespace":"heading"')
    expect(downgrade(tree).losses).toEqual([])
    const edited = JSON.parse(text.replace('"namespace":"heading"', '"namespace":"figure"'))
    expect(downgrade(edited).losses.some((l: string) => l.endsWith('/namespace'))).toBe(true)
  })

  it('keeps authored groups of a table that had no rowGroups', () => {
    const tree = upgrade(toAstJson(parse('|= a |= b |\n| 1 | 2 |\n')) as any)
    const table = tree.children[0]
    const body = table.children.find((g: any) => g.type === 'table_body')
    body.attrs = { classes: ['totals'] }
    const back = downgrade(tree).tree as any
    expect(validate12(back)).toBe(true)
    expect(back.children[0].rowGroups?.bodies?.[0]?.attrs).toEqual({ classes: ['totals'] })
  })
})

describe('caption downgrade', () => {
  it('reports fields on the caption paragraph', () => {
    const tree = upgrade(toAstJson(parse('![a](x.png)\n^ A caption\n')) as any)
    expect(downgrade(tree).losses).toEqual([])
    tree.children[0].caption.children[0].attrs = { id: 'cap' }
    expect(downgrade(tree).losses.some((l: string) => l.endsWith('/caption/children/0/attrs'))).toBe(true)
  })
})

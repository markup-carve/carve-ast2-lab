import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Tree } from '../upgrade.ts'

export interface Loss { type: string, path: string }
const item = (t: string, c?: unknown): any => c === undefined ? { t } : { t, c }
const attr = (node: Tree): any[] => [node.attrs?.id ?? '', node.attrs?.classes ?? [], Object.entries(node.attrs?.keyValues ?? {})]
const align = (value?: string) => item(value === 'left' ? 'AlignLeft' : value === 'right' ? 'AlignRight' : value === 'center' ? 'AlignCenter' : 'AlignDefault')
export function toPandoc(tree: Tree): { doc: Tree, losses: Loss[] } {
  const losses: Loss[] = []
  const footnotes = new Map<string, { node: Tree, path: string }>()
  const usedFootnotes = new Set<string>()
  const activeFootnotes = new Set<string>()
  function index(value: any, path: string) {
    if (Array.isArray(value)) { value.forEach((child, i) => index(child, `${path}/${i}`)); return }
    if (!value || typeof value !== 'object') return
    if (value.type === 'footnote' && value.key && !footnotes.has(value.key)) footnotes.set(value.key, { node: value, path })
    for (const [key, child] of Object.entries(value)) index(child, `${path}/${key}`)
  }
  index(tree, '')
  const loss = (node: Tree, path: string) => { losses.push({ type: node.type, path }); return [] }
  const inlineList = (nodes: Tree[] = [], path: string): any[] => nodes.flatMap((node, i) => inline(node, `${path}/${i}`))
  const blocks = (nodes: Tree[] = [], path: string): any[] => nodes.flatMap((node, i) => block(node, `${path}/${i}`))
  function inline(node: Tree, path: string): any[] {
    const content = () => inlineList(node.children, `${path}/children`)
    switch (node.type) {
      case 'text': case 'escaped_text': case 'literal_inline': return [item('Str', node.value ?? '')]
      case 'soft_break': return [item('SoftBreak')]
      case 'hard_break': return [item('LineBreak')]
      case 'non_breaking_space': return [item('Str', '\u00a0')]
      case 'smart_punctuation': return [item('Str', node.glyph ?? node.source ?? '')]
      case 'code': return [item('Code', [attr(node), node.value ?? ''])]
      case 'emphasis': return [item('Emph', content())]
      case 'strong': return [item('Strong', content())]
      case 'underline': return [item('Underline', content())]
      case 'strike': case 'delete': return [item('Strikeout', content())]
      case 'highlight': return [item('Span', [['', ['mark'], []], content()])]
      case 'superscript': return [item('Superscript', content())]
      case 'subscript': return [item('Subscript', content())]
      case 'small_caps': return [item('SmallCaps', content())]
      case 'span': return [item('Span', [attr(node), content()])]
      case 'link': return [item('Link', [attr(node), content(), [node.href ?? '', node.tooltip ?? '']])]
      case 'image': return [item('Image', [attr(node), node.decorative ? [] : [item('Str', node.alt ?? '')], [node.src ?? '', node.tooltip ?? '']])]
      case 'autolink': return [item('Link', [attr(node), [item('Str', node.text ?? node.href ?? '')], [node.href ?? '', '']])]
      case 'raw_inline': return [item('RawInline', [node.format ?? '', node.value ?? ''])]
      case 'math': return [item('Math', [item(node.display ? 'DisplayMath' : 'InlineMath'), node.value ?? ''])]
      case 'inline_footnote': return [item('Note', [item('Para', content())])]
      case 'footnote_ref': {
        const entry = footnotes.get(node.key)
        if (!entry || activeFootnotes.has(node.key)) return loss(node, path)
        activeFootnotes.add(node.key)
        usedFootnotes.add(node.key)
        const body = blocks(entry.node.children, `${entry.path}/children`)
        activeFootnotes.delete(node.key)
        return [item('Note', body)]
      }
      default: return loss(node, path)
    }
  }
  const cell = (node: Tree, path: string, column: Tree | undefined) => [attr(node), align(node.align ?? column?.resolvedAlign), node.rowspan ?? 1, node.colspan ?? 1, blocks(node.children, `${path}/children`)]
  const row = (node: Tree, path: string, columns: Tree[]) => [attr(node), (node.children ?? []).flatMap((child: Tree, i: number) => child.span ? [] : [cell(child, `${path}/children/${i}`, columns[i])])]
  function caption(node?: Tree, path = ''): any[] { return [node?.short ? inlineList(node.short, `${path}/short`) : null, node ? blocks(node.children, `${path}/children`) : []] }
  function table(node: Tree, path: string): any {
    const columns = node.columns ?? []
    const groups = node.children ?? []
    const allRows = groups.flatMap((group: Tree) => group.children ?? [])
    const width = Math.max(columns.length, ...allRows.map((r: Tree) => r.children?.length ?? 0), 0)
    const specs = Array.from({ length: width }, (_, i) => [align(columns[i]?.resolvedAlign), item('ColWidthDefault')])
    const head = groups.find((group: Tree) => group.type === 'table_head')
    const foot = groups.find((group: Tree) => group.type === 'table_foot')
    const heads = [attr(head ?? {}), (head?.children ?? []).map((r: Tree, i: number) => row(r, `${path}/children/head/${i}`, columns))]
    const bodies = groups.filter((group: Tree) => group.type === 'table_body').map((group: Tree, i: number) => [attr(group), group.rowHeadColumns ?? 0, (group.children ?? []).slice(0, group.headRows ?? 0).map((r: Tree, j: number) => row(r, `${path}/children/body/${i}/head/${j}`, columns)), (group.children ?? []).slice(group.headRows ?? 0).map((r: Tree, j: number) => row(r, `${path}/children/body/${i}/rows/${j}`, columns))])
    const feet = [attr(foot ?? {}), (foot?.children ?? []).map((r: Tree, i: number) => row(r, `${path}/children/foot/${i}`, columns))]
    return item('Table', [attr(node), caption(node.caption, `${path}/caption`), specs, heads, bodies, feet])
  }
  function block(node: Tree, path: string): any[] {
    const content = () => blocks(node.children, `${path}/children`)
    switch (node.type) {
      case 'paragraph': return [item('Para', inlineList(node.children, `${path}/children`))]
      case 'cell_paragraph': return [item('Plain', inlineList(node.children, `${path}/children`))]
      case 'heading': return [item('Header', [node.level ?? 1, attr(node), inlineList(node.children, `${path}/children`)])]
      case 'code_block': {
        const title = (node.title ?? []).map((part: Tree, i: number) => {
          if (part.type === 'text') return part.value ?? ''
          loss(part, `${path}/title/${i}`)
          return ''
        }).join('')
        const attrs = attr({ attrs: { ...node.attrs, classes: [node.syntax, ...(node.attrs?.classes ?? [])].filter(Boolean) } })
        if (title) attrs[2].push(['title', title])
        return [item('CodeBlock', [attrs, node.value ?? ''])]
      }
      case 'block_quote': return [item('BlockQuote', content())]
      case 'section': case 'div': return [item('Div', [attr(node), content()])]
      case 'admonition': return [item('Div', [[node.attrs?.id ?? '', [node.kind ?? 'admonition', ...(node.attrs?.classes ?? [])], Object.entries(node.attrs?.keyValues ?? {})], [...(node.title?.length ? [item('Para', inlineList(node.title, `${path}/title`))] : []), ...content()]])]
      case 'list': {
        const items = (node.children ?? []).map((child: Tree, i: number) => {
          const content = blocks(child.children, `${path}/children/${i}/children`)
          if (!child.task) return content
          const mark = item('Str', `[${child.task.mark}]`)
          if (content[0]?.t === 'Para' || content[0]?.t === 'Plain') content[0].c.unshift(mark, item('Space'))
          else content.unshift(item('Plain', [mark]))
          return content
        })
        if (node.marker?.kind === 'bullet') return [item('BulletList', items)]
        const styles: Record<string, string> = { '1': 'Decimal', a: 'LowerAlpha', A: 'UpperAlpha', i: 'LowerRoman', I: 'UpperRoman' }
        const delimiters: Record<string, string> = { '.': 'Period', ')': 'OneParen', '()': 'TwoParens' }
        return [item('OrderedList', [[node.marker?.start ?? 1, item(styles[node.marker?.style] ?? 'DefaultStyle'), item(delimiters[node.marker?.delimiter] ?? 'DefaultDelim')], items])]
      }
      case 'definition_list': {
        const entries: any[] = []
        for (const child of node.children ?? []) {
          if (child.type === 'definition_term') entries.push([inlineList(child.children, `${path}/children`), []])
          else if (child.type === 'definition_description' && entries.length) entries.at(-1)[1].push(blocks(child.children, `${path}/children`))
          else loss(child, `${path}/children`)
        }
        return [item('DefinitionList', entries)]
      }
      case 'table': return [table(node, path)]
      case 'figure': return [item('Figure', [attr(node), caption(node.caption, `${path}/caption`), content()])]
      case 'footnote': return []
      case 'raw_block': return [item('RawBlock', [node.format ?? '', node.value ?? ''])]
      case 'thematic_break': return [item('HorizontalRule')]
      case 'line_block': return [item('LineBlock', (node.children ?? []).map((child: Tree, i: number) => inlineList(child.children, `${path}/children/${i}/children`)))]
      case 'image': return [item('Para', inline(node, path))]
      default: return loss(node, path)
    }
  }
  const converted = blocks(tree.children, '/children')
  for (const [key, entry] of footnotes) if (!usedFootnotes.has(key)) loss(entry.node, entry.path)
  return { doc: { 'pandoc-api-version': [1, 23, 1], meta: {}, blocks: converted }, losses }
}
export function validatePandoc(doc: Tree): { ok: boolean, native: string, error: string } {
  const dir = mkdtempSync(join(tmpdir(), 'carve-pandoc-'))
  const path = join(dir, 'trial.json')
  try {
    writeFileSync(path, JSON.stringify(doc))
    const run = spawnSync('pandoc', ['-f', 'json', '-t', 'native', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10000 })
    return { ok: run.status === 0, native: run.stdout ?? '', error: run.stderr ?? run.error?.message ?? '' }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

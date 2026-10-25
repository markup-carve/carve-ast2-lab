import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parse, toAstJson } from '@markup-carve/carve'
import { corpusFiles } from './measure.ts'
import { upgrade, type Tree } from './upgrade.ts'

const names = [
  'paragraph blockImage', 'cell_paragraph wrappers', 'caption nodes', 'table group nodes',
  'compatibility data and declaration', 'root stages and extensions', 'reference namespace',
  'discriminated marker spacing task', 'renamed keys',
] as const
const saved = Object.fromEntries(names.map((name) => [name, 0])) as Record<string, number>
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const copy = (value: Tree) => structuredClone(value)
function transform(tree: Tree, cause: string) {
  if (cause === 'root stages and extensions') {
    delete tree.stages
    delete tree.extensions
  }
  if (cause === 'compatibility data and declaration') {
    tree.extensions = tree.extensions?.filter((entry: Tree) => entry.name !== 'org.markup-carve.ast12')
    if (!tree.extensions?.length) delete tree.extensions
  }
  function visit(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const node = value as Tree
    if (cause === 'paragraph blockImage' && node.type === 'paragraph' && node.blockImage === false) delete node.blockImage
    if (cause === 'cell_paragraph wrappers' && node.type === 'table_cell') node.children = node.children?.flatMap((child: Tree) => child.type === 'cell_paragraph' ? child.children : [child])
    if (cause === 'caption nodes' && node.caption?.type === 'caption') {
      const caption = node.caption
      node.caption = caption.children?.flatMap((child: Tree) => child.type === 'paragraph' ? child.children : [child]) ?? []
      if (caption.short) node.shortCaption = caption.short
    }
    if (cause === 'table group nodes' && node.type === 'table') node.children = node.children?.flatMap((group: Tree) => group.children ?? [])
    if (cause === 'compatibility data and declaration' && node.data) {
      delete node.data['org.markup-carve.ast12']
      if (!Object.keys(node.data).length) delete node.data
    }
    if (cause === 'reference namespace') delete node.namespace
    if (cause === 'discriminated marker spacing task') {
      if (node.type === 'list') {
        node.ordered = node.marker?.kind === 'ordered'
        node.tight = node.spacing === 'tight'
        if (node.marker?.char) node.bulletChar = node.marker.char
        if (node.marker?.style) node.olType = node.marker.style
        if (node.marker?.delimiter) node.delim = node.marker.delimiter
        if (node.marker?.start) node.start = node.marker.start
        delete node.marker; delete node.spacing
      } else if (node.type === 'definition_list') { node.loose = node.spacing === 'loose'; delete node.spacing }
      else if (node.type === 'list_item' && node.task) { node.checked = node.task.status === 'done'; node.taskState = node.task.mark; delete node.task }
    }
    if (cause === 'renamed keys') {
      const type = node.type
      const changes: [string, string][] = []
      if (['list', 'definition_list', 'citation_group'].includes(type)) changes.push(['children', 'items'])
      if (type === 'table') changes.push(['children', 'rows'])
      if (type === 'table_row') changes.push(['children', 'cells'])
      if (type === 'figure') changes.push(['children', 'target'])
      if (type === 'inline_footnote') changes.push(['children', 'inline'])
      if (['code_block', 'math', 'raw_block', 'raw_inline', 'literal_inline', 'frontmatter', 'comment'].includes(type)) changes.push(['value', 'content'])
      if (type === 'critic_comment') changes.push(['value', 'text'])
      if (type === 'smart_punctuation') changes.push(['source', 'value'])
      if (['div', 'admonition', 'directive', 'code_block'].includes(type)) changes.push(['groupLabel', 'label'])
      if (type === 'math') changes.push(['numberPrefix', 'label'])
      if (['link', 'image'].includes(type)) changes.push(['tooltip', 'title'], ['key', 'ref'])
      if (['abbreviation', 'abbreviation_def'].includes(type)) changes.push(['key', 'abbr'])
      if (['footnote', 'footnote_ref', 'link_reference_definition'].includes(type)) changes.push(['key', 'label'])
      if (type === 'xref') changes.push(['key', 'target'])
      if (type === 'mention') changes.push(['target', 'user'])
      for (const [from, to] of changes) if (from in node) { node[to] = node[from]; delete node[from] }
    }
    Object.values(node).forEach(visit)
  }
  visit(tree)
  return tree
}
let total12 = 0
let total20 = 0
for (const file of corpusFiles()) {
  const original = toAstJson(parse(readFileSync(file, 'utf8'))) as Tree
  const next = upgrade(original)
  total12 += bytes(original)
  total20 += bytes(next)
  for (const cause of names) saved[cause] += bytes(next) - bytes(transform(copy(next), cause))
}
const delta = total20 - total12
const causes = names.map((cause) => ({ cause, bytes: saved[cause], share: delta ? saved[cause] / delta : 0 }))
const result = { documents: corpusFiles().length, totalBytes12: total12, totalBytes20: total20, delta, causes, unexplained: { bytes: delta - causes.reduce((n, row) => n + row.bytes, 0), share: delta ? 1 - causes.reduce((n, row) => n + row.bytes, 0) / delta : 0 }, method: 'Each ablation starts from the unmodified 2.0 tree. Overlap is retained in each cause; the remainder subtracts their sum and can be negative.' }
mkdirSync('results', { recursive: true })
writeFileSync('results/size-breakdown.json', JSON.stringify(result, null, 2) + '\n')
console.log(result)

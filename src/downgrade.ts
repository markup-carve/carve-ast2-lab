import { readFileSync } from 'node:fs'
import type { Tree } from './upgrade.ts'

const schema12 = JSON.parse(readFileSync(new URL('../spec/resources/ast-schema.json', import.meta.url), 'utf8'))
const allowed = Object.fromEntries(Object.entries(schema12.$defs).map(([name, def]) => [name, new Set(Object.keys((def as Tree).properties ?? {}))])) as Record<string, Set<string>>

export interface DowngradeResult {
  tree: Tree
  losses: string[]
}

const refs: Record<string, string> = {
  abbreviation: 'abbr', abbreviation_def: 'abbr', footnote: 'label',
  footnote_ref: 'label', link_reference_definition: 'label', citation: 'key',
  citation_definition: 'key', link: 'ref', image: 'ref',
}

function move(node: Tree, from: string, to: string) {
  if (from in node) {
    node[to] = node[from]
    delete node[from]
  }
}

export function downgrade(tree20: Tree): DowngradeResult {
  const losses: string[] = []
  function unpackCaption(caption: Tree, path: string): any[] {
    // 1.2 captions are bare inline arrays: only the inlines of one paragraph survive.
    for (const key of Object.keys(caption)) if (!['type', 'children', 'short'].includes(key)) losses.push(`${path}/${key}`)
    if (caption.children.length !== 1 || caption.children[0].type !== 'paragraph') {
      losses.push(`${path}/children`)
    }
    const index = caption.children.findIndex((child: Tree) => child.type === 'paragraph')
    if (index < 0) return []
    const paragraph = caption.children[index]
    for (const key of Object.keys(paragraph)) if (!['type', 'children', 'blockImage'].includes(key)) losses.push(`${path}/children/${index}/${key}`)
    return paragraph.children
  }
  function visit(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => visit(v, `${path}/${i}`))
    if (value === null || typeof value !== 'object') return value
    const node: Tree = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, `${path}/${k}`)]))
    if (!node.type) return node
    const legacy = node.data?.['org.markup-carve.ast12']
    const sourceVersion = node.type === 'document' ? legacy?.astVersion : undefined
    if (node.data) {
      for (const key of Object.keys(node.data)) if (key !== 'org.markup-carve.ast12') losses.push(`${path}/data/${key}`)
      delete node.data
    }
    for (const key of ['segments', 'dir', 'metadata']) if (key in node) {
      losses.push(`${path}/${key}`)
      delete node[key]
    }
    if ('lang' in node && node.type !== 'code_block') {
      losses.push(`${path}/lang`)
      delete node.lang
    }
    switch (node.type) {
      case 'document':
        if (node.extensions?.some((extension: Tree) => extension.required || extension.version !== '0')) losses.push(`${path}/extensions`)
        if (node.srcByteLength === undefined) losses.push(`${path}/srcByteLength`)
        delete node.stages
        delete node.extensions
        if (sourceVersion) node.astVersion = sourceVersion
        else delete node.astVersion
        break
      case 'list': {
        const marker = node.marker
        node.ordered = marker.kind === 'ordered'
        node.tight = node.spacing === 'tight'
        move(node, 'children', 'items')
        if (node.ordered) {
          if (marker.style !== undefined) node.olType = marker.style
          if (marker.delimiter !== undefined || legacy?.delimPresent) node.delim = marker.delimiter ?? '.'
          if (marker.start !== undefined) node.start = marker.start
          if (marker.bare !== undefined) node.bareMarker = marker.bare
        } else if (marker.char !== '-' || legacy?.bulletCharPresent) node.bulletChar = marker.char
        if (legacy?.listFields) {
          for (const key of ['start', 'olType', 'delim', 'bareMarker', 'bulletChar']) {
            delete node[key]
            if (legacy.listFields[key] !== undefined) node[key] = legacy.listFields[key]
          }
        }
        delete node.marker
        delete node.spacing
        break
      }
      case 'definition_list':
        move(node, 'children', 'items')
        if (node.spacing === 'loose') node.loose = true
        delete node.spacing
        break
      case 'list_item':
        if (node.task) {
          node.checked = node.task.mark === 'x'
          if (node.task.mark !== (node.checked ? 'x' : ' ') || legacy?.taskStatePresent) node.taskState = node.task.mark
        }
        delete node.task
        break
      case 'table': {
        const groups = node.children
        node.rows = groups.flatMap((g: Tree) => g.children)
        // 1.2 can spell any grouping through `rowGroups`; only the shape the upgrader infers for an ungrouped table omits it.
        const inferred = groups.every((g: Tree, i: number) => !g.attrs && g.headRows === undefined && g.rowHeadColumns === undefined
          && (g.type === 'table_head' ? i === 0 : g.type === 'table_body' && i === groups.length - 1))
        if (legacy?.rowGroupsPresent || !inferred) {
          const head = groups.find((g: Tree) => g.type === 'table_head')
          const foot = groups.find((g: Tree) => g.type === 'table_foot')
          node.rowGroups = {
            headRows: head?.children.length ?? 0,
            ...(head?.attrs ? { headAttrs: head.attrs } : {}),
            bodies: groups.filter((g: Tree) => g.type === 'table_body').map((g: Tree) => ({ headRows: g.headRows ?? 0, bodyRows: g.children.length - (g.headRows ?? 0), ...(g.rowHeadColumns === undefined ? {} : { rowHeadColumns: g.rowHeadColumns }), ...(g.attrs ? { attrs: g.attrs } : {}) })),
            footRows: foot?.children.length ?? 0,
            ...(foot?.attrs ? { footAttrs: foot.attrs } : {}),
          }
        }
        delete node.children
        if (node.columns) {
          node.columns = node.columns.filter((column: Tree) => column.authored).map(({ type, resolvedAlign, authored, ...column }: Tree) => column)
          if (!node.columns.length && !legacy?.columnsPresent) delete node.columns
        }
        if (node.caption) {
          node.shortCaption = node.caption.short
          node.caption = unpackCaption(node.caption, `${path}/caption`)
          if (legacy?.captionAbsent) delete node.caption
          if (node.shortCaption === undefined) delete node.shortCaption
        }
        break
      }
      case 'table_row':
        move(node, 'children', 'cells')
        break
      case 'table_cell':
        if (node.sourceContent === 'inline') {
          const wrapper = node.children[0]
          if (node.children.length !== 1 || wrapper?.type !== 'cell_paragraph') losses.push(`${path}/children`)
          for (const key of ['attrs', 'pos', 'segments', 'metadata', 'dir', 'lang']) {
            if (key in (wrapper ?? {})) losses.push(`${path}/children/0/${key}`)
          }
          node.children = wrapper?.children ?? []
        }
        else move(node, 'children', 'blocks')
        delete node.sourceContent
        break
      case 'figure':
        if (node.kind !== undefined) losses.push(`${path}/kind`)
        if (node.children.length !== 1) losses.push(`${path}/children`)
        node.target = node.children[0]
        delete node.children
        node.shortCaption = node.caption.short
        node.caption = unpackCaption(node.caption, `${path}/caption`)
        if (node.shortCaption === undefined) delete node.shortCaption
        delete node.kind
        break
      case 'figure_group':
        if (node.caption) node.caption = unpackCaption(node.caption, `${path}/caption`)
        break
      case 'citation_group':
        move(node, 'children', 'items')
        break
      case 'inline_footnote':
        move(node, 'children', 'inline')
        break
      case 'comment':
        node.block = node.form === 'block'
        if (node.form === 'braced') node.delimited = true
        move(node, 'value', 'content')
        if (legacy?.formPresent === false) delete node.form
        if (legacy?.delimitedPresent) node.delimited = legacy.delimitedValue
        break
      case 'critic_comment':
        move(node, 'value', 'text')
        break
      case 'smart_punctuation':
        move(node, 'source', 'value')
        break
      case 'code_block':
        move(node, 'value', 'content')
        move(node, 'syntax', 'lang')
        if (node.title !== undefined) {
          node.header = node.title.map((part: Tree) => part.value ?? '').join('')
          if (node.title.some((part: Tree) => part.type !== 'text')) losses.push(`${path}/title`)
          delete node.title
        }
        move(node, 'groupLabel', 'label')
        break
      case 'math':
        move(node, 'value', 'content')
        move(node, 'numberPrefix', 'label')
        break
      case 'raw_block': case 'raw_inline': case 'literal_inline': case 'frontmatter':
        move(node, 'value', 'content')
        break
      case 'link': case 'image':
        move(node, 'tooltip', 'title')
        if (legacy?.resolved !== undefined) node.resolved = legacy.resolved
        if (!((node.type === 'link' ? 'href' : 'src') in node)) node[node.type === 'link' ? 'href' : 'src'] = ''
        break
      case 'xref':
        if (node.form !== undefined) losses.push(`${path}/form`)
        if (node.namespace !== 'heading') losses.push(`${path}/namespace`)
        node.type = 'heading_ref'
        move(node, 'key', 'target')
        delete node.namespace
        delete node.form
        break
      case 'mention':
        if (node.kind !== 'user') losses.push(`${path}/kind`)
        if (node.label !== undefined) losses.push(`${path}/label`)
        move(node, 'target', 'user')
        delete node.kind
        delete node.label
        break
      case 'div': case 'admonition': case 'directive':
        move(node, 'groupLabel', 'label')
        break
      case 'critic_substitution':
        node.type = 'substitution'
        break
      case 'paragraph':
        if (node.blockImage === false) delete node.blockImage
        break
      case 'ruby':
        node.pairs = node.pairs.map(({ type, ...pair }: Tree) => pair)
        break
      case 'inline_extension':
        move(node, 'children', 'content')
        if (node.fallback?.type !== 'text' || node.fallback?.value !== '') losses.push(`${path}/fallback`)
        delete node.fallback
        if (legacy?.name !== undefined) node.name = legacy.name
        break
      case 'block_extension':
        if (node.payload) {
          if (node.payload.length > 1) losses.push(`${path}/payload`)
          node.payload = node.payload[0]
          if (legacy?.payloadValueAbsent) delete node.payload.value
        }
        if (legacy?.name !== undefined) node.name = legacy.name
        break
    }
    if (node.type === 'image' && node.alt === undefined) {
      node.alt = ''
      losses.push(`${path}/alt`)
    }
    if (node.type === 'document' && node.srcByteLength === undefined) node.srcByteLength = 0
    if (node.type === 'inline_extension' && node.content === undefined) node.content = []
    const ref = refs[node.type]
    if (ref) {
      move(node, 'key', ref)
      delete node.namespace
    }
    const fields = allowed[node.type]
    if (fields) for (const key of Object.keys(node)) if (!fields.has(key)) {
      losses.push(`${path}/${key}`)
      delete node[key]
    }
    return node
  }
  return { tree: visit(tree20, ''), losses }
}

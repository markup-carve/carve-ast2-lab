export type Tree = Record<string, any>

const refs: Record<string, [string, string]> = {
  abbreviation: ['abbr', 'abbr'], abbreviation_def: ['abbr', 'abbr'],
  footnote: ['label', 'footnote'], footnote_ref: ['label', 'footnote'],
  link_reference_definition: ['label', 'link'], citation: ['key', 'citation'],
  citation_definition: ['key', 'citation'], link: ['ref', 'link'], image: ['ref', 'link'],
}

const statuses: Record<string, string> = {
  ' ': 'todo', x: 'done', '-': 'cancelled', _: 'partial', '>': 'partial', '?': 'other',
}

function move(node: Tree, from: string, to: string) {
  if (from in node) {
    node[to] = node[from]
    delete node[from]
  }
}

function caption(inline: unknown[], short?: unknown[]) {
  return {
    type: 'caption',
    children: [{ type: 'paragraph', children: inline }],
    ...(short === undefined ? {} : { short }),
  }
}

export function upgrade(tree12: Tree): Tree {
  function visit(value: any): any {
    if (Array.isArray(value)) return value.map(visit)
    if (value === null || typeof value !== 'object') return value
    const node: Tree = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]))
    if (!node.type) return node
    const original = value as Tree
    switch (node.type) {
      case 'document':
        node.astVersion = '2.0'
        if (original.astVersion !== undefined) node.data = { 'org.markup-carve.ast12': { astVersion: original.astVersion } }
        const names = new Set<string>()
        const scan = (value: any) => {
          if (Array.isArray(value)) {
            value.forEach(scan)
            return
          }
          if (!value || typeof value !== 'object') return
          if (value.data?.['org.markup-carve.ast12']) names.add('org.markup-carve.ast12')
          if (value.type === 'inline_extension' || value.type === 'block_extension') names.add(value.name)
          Object.values(value).forEach(scan)
        }
        node.children.forEach(scan)
        if (node.data) names.add('org.markup-carve.ast12')
        if (names.size) node.extensions = [...names].sort().map((name) => ({ name, version: '0', required: false }))
        node.stages = ['blockImagePromotion', 'referenceResolution', 'tableAlignment']
        if (node.srcByteLength === 0 && original.srcByteLength === undefined) delete node.srcByteLength
        break
      case 'list': {
        const ordered = node.ordered
        node.marker = ordered
          ? { kind: 'ordered', ...(node.olType === undefined ? {} : { style: node.olType }),
              ...(node.delim === undefined ? {} : { delimiter: node.delim }),
              ...(node.start === undefined ? {} : { start: node.start }),
              ...(node.bareMarker === undefined ? {} : { bare: node.bareMarker }) }
          : { kind: 'bullet', char: node.bulletChar ?? '-' }
        node.spacing = node.tight ? 'tight' : 'loose'
        const markerFields = ['start', 'olType', 'delim', 'bareMarker', 'bulletChar']
        if (original.bulletChar === '-' || original.delim === '.' || (!ordered && markerFields.some((key) => key !== 'bulletChar' && original[key] !== undefined)) || (ordered && original.bulletChar !== undefined)) {
          node.data = { 'org.markup-carve.ast12': { listFields: Object.fromEntries(markerFields.filter((key) => original[key] !== undefined).map((key) => [key, original[key]])) } }
        }
        move(node, 'items', 'children')
        for (const key of ['ordered', 'tight', 'olType', 'delim', 'start', 'bareMarker', 'bulletChar']) delete node[key]
        break
      }
      case 'definition_list':
        move(node, 'items', 'children')
        node.spacing = node.loose ? 'loose' : 'tight'
        delete node.loose
        break
      case 'list_item':
        if (node.checked !== undefined || node.taskState !== undefined) {
          const mark = node.taskState ?? (node.checked ? 'x' : ' ')
          node.task = { mark, status: statuses[mark] }
          if (original.taskState !== undefined) node.data = { 'org.markup-carve.ast12': { taskStatePresent: true } }
        }
        delete node.checked
        delete node.taskState
        break
      case 'table': {
        const rows = node.rows
        delete node.rows
        const groups = node.rowGroups
        delete node.rowGroups
        let cursor = 0
        node.children = []
        const take = (count: number) => {
          const part = rows.slice(cursor, cursor + count)
          cursor += count
          return part
        }
        if (groups) {
          if (groups.headRows) node.children.push({ type: 'table_head', children: take(groups.headRows), ...(groups.headAttrs ? { attrs: groups.headAttrs } : {}) })
          for (const body of groups.bodies) node.children.push({ type: 'table_body', children: take(body.headRows + body.bodyRows), headRows: body.headRows, ...(body.rowHeadColumns === undefined ? {} : { rowHeadColumns: body.rowHeadColumns }), ...(body.attrs ? { attrs: body.attrs } : {}) })
          if (groups.footRows) node.children.push({ type: 'table_foot', children: take(groups.footRows), ...(groups.footAttrs ? { attrs: groups.footAttrs } : {}) })
        } else {
          let headRows = 0
          while (headRows < rows.length && rows[headRows].children?.length && rows[headRows].children.every((cell: Tree) => cell.header)) headRows++
          if (headRows) node.children.push({ type: 'table_head', children: rows.slice(0, headRows) })
          if (headRows < rows.length || !headRows) node.children.push({ type: 'table_body', children: rows.slice(headRows) })
        }
        if (groups) node.data = { ...node.data, 'org.markup-carve.ast12': { ...node.data?.['org.markup-carve.ast12'], rowGroupsPresent: true } }
        const authoredColumns = node.columns ?? []
        const width = Math.max(authoredColumns.length, ...rows.map((row: Tree) => row.children?.length ?? 0), 0)
        const columns = Array.from({ length: width }, (_, i) => ({ type: 'table_column', ...(authoredColumns[i] ? { authored: true, ...authoredColumns[i] } : {}) }))
        const firstHeader = rows.find((row: Tree) => row.children?.some((cell: Tree) => cell.header))
        firstHeader?.children.forEach((cell: Tree, i: number) => {
          if (cell.header && cell.align && !cell.span && !cell.colspan && columns[i]) (columns[i] as Tree).resolvedAlign = cell.align
        })
        for (let i = 0; i < columns.length; i++) {
          const column = columns[i] as Tree
          if (!column.resolvedAlign && column.align) column.resolvedAlign = column.align
        }
        node.columns = columns
        if (original.columns !== undefined) node.data = { ...node.data, 'org.markup-carve.ast12': { ...node.data?.['org.markup-carve.ast12'], columnsPresent: true } }
        if (node.caption !== undefined || node.shortCaption !== undefined) {
          if (node.caption === undefined) node.data = { ...node.data, 'org.markup-carve.ast12': { ...node.data?.['org.markup-carve.ast12'], captionAbsent: true } }
          node.caption = caption(node.caption ?? [], node.shortCaption)
          delete node.shortCaption
        }
        break
      }
      case 'table_row':
        move(node, 'cells', 'children')
        break
      case 'table_cell':
        if (node.blocks !== undefined) {
          move(node, 'blocks', 'children')
          node.sourceContent = 'blocks'
        } else {
          node.children = [{ type: 'cell_paragraph', children: node.children }]
          node.sourceContent = 'inline'
        }
        break
      case 'figure':
        node.children = [node.target]
        delete node.target
        node.caption = caption(node.caption, node.shortCaption)
        delete node.shortCaption
        break
      case 'figure_group':
        if (node.caption !== undefined) {
          node.caption = caption(node.caption)
        }
        break
      case 'citation_group':
        move(node, 'items', 'children')
        break
      case 'inline_footnote':
        move(node, 'inline', 'children')
        break
      case 'comment':
        if (original.form === undefined || original.delimited === false) node.data = { 'org.markup-carve.ast12': { formPresent: original.form !== undefined, delimitedPresent: original.delimited !== undefined, ...(original.delimited === undefined ? {} : { delimitedValue: original.delimited }) } }
        node.form = node.form ?? (node.block ? 'block' : node.delimited ? 'braced' : 'line')
        delete node.block
        delete node.delimited
        move(node, 'content', 'value')
        break
      case 'critic_comment':
        move(node, 'text', 'value')
        break
      case 'smart_punctuation':
        move(node, 'value', 'source')
        break
      case 'code_block':
        move(node, 'content', 'value')
        move(node, 'lang', 'syntax')
        if (node.header !== undefined) {
          node.title = [{ type: 'text', value: node.header }]
          delete node.header
        }
        move(node, 'label', 'groupLabel')
        break
      case 'math':
        move(node, 'content', 'value')
        move(node, 'label', 'numberPrefix')
        break
      case 'raw_block': case 'raw_inline': case 'literal_inline': case 'frontmatter':
        move(node, 'content', 'value')
        break
      case 'link': case 'image':
        if (node.ref !== undefined && node[node.type === 'link' ? 'href' : 'src'] === '' && node.resolved !== true) delete node[node.type === 'link' ? 'href' : 'src']
        if (node.resolved !== undefined) node.data = { 'org.markup-carve.ast12': { resolved: node.resolved } }
        delete node.resolved
        move(node, 'title', 'tooltip')
        break
      case 'heading_ref':
        node.type = 'xref'
        move(node, 'target', 'key')
        node.namespace = 'heading'
        break
      case 'mention':
        move(node, 'user', 'target')
        node.kind = 'user'
        break
      case 'div': case 'admonition': case 'directive':
        move(node, 'label', 'groupLabel')
        break
      case 'substitution':
        node.type = 'critic_substitution'
        break
      case 'ruby':
        node.pairs = node.pairs.map((pair: Tree) => ({ type: 'ruby_pair', ...pair }))
        break
      case 'inline_extension':
        node.data = { 'org.markup-carve.ast12': { name: node.name } }
        if (!/^[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)+$/.test(node.name)) node.name = `org.markup-carve.legacy.x${Buffer.from(node.name).toString('hex')}`
        move(node, 'content', 'children')
        node.fallback = { type: 'text', value: '' }
        break
      case 'block_extension':
        node.data = { 'org.markup-carve.ast12': { name: node.name } }
        if (!/^[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)+$/.test(node.name)) node.name = `org.markup-carve.legacy.x${Buffer.from(node.name).toString('hex')}`
        if (node.payload !== undefined) {
          if (node.payload.value === undefined) {
            node.data['org.markup-carve.ast12'].payloadValueAbsent = true
            node.payload.value = null
          }
          node.payload = [node.payload]
        }
        break
    }
    if (node.type === 'paragraph' && node.blockImage === undefined) node.blockImage = false
    const ref = refs[original.type]
    if (ref) {
      move(node, ref[0], 'key')
      if (node.key !== undefined) node.namespace = ref[1]
    }
    return node
  }
  return visit(tree12)
}

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { Tree } from '../upgrade.ts'
import type { Loss } from './pandoc.ts'

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0 })
function crc(data: Buffer) { let n = 0xffffffff; for (const byte of data) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0 }
function zip(entries: Record<string, string>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(entries)) {
    const file = Buffer.from(name)
    const data = Buffer.from(content)
    const sum = crc(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(sum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(file.length, 26)
    local.push(header, file, data)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(sum, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(file.length, 28); directory.writeUInt32LE(offset, 42)
    central.push(directory, file)
    offset += header.length + file.length + data.length
  }
  const middle = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(middle.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, middle, end])
}
export function toDocx(tree: Tree): { bytes: Buffer, losses: Loss[] } {
  const losses: Loss[] = []
  const lost = (node: Tree, path: string) => { losses.push({ type: node.type, path }); return '' }
  const inlines = (nodes: Tree[] = [], path: string): string => nodes.map((node, i) => {
    const here = `${path}/${i}`
    if (['text', 'escaped_text', 'literal_inline', 'code'].includes(node.type)) return `<w:r><w:t xml:space="preserve">${esc(node.value)}</w:t></w:r>`
    if (node.type === 'soft_break') return '<w:r><w:br/></w:r>'
    if (node.type === 'hard_break') return '<w:r><w:br w:type="textWrapping"/></w:r>'
    if (node.type === 'image') { losses.push({ type: node.type, path: here }); return `<w:r><w:t>[Image: ${esc(node.alt ?? node.src ?? '')}]</w:t></w:r>` }
    // The trial writes no run properties or hyperlinks: the text survives, the markup is a loss.
    if (node.children) { losses.push({ type: node.type, path: here }); return inlines(node.children, `${here}/children`) }
    return lost(node, here)
  }).join('')
  const para = (nodes: Tree[] = [], path: string, style?: string, align?: string) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${esc(style)}"/>` : ''}${align ? `<w:jc w:val="${esc(align)}"/>` : ''}</w:pPr>${inlines(nodes, path)}</w:p>`
  const caption = (node: Tree | undefined, path: string, label: string) => node ? `<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>${label} </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ ${label} \\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>: </w:t></w:r>${(node.children ?? []).map((child: Tree, i: number) => child.type === 'paragraph' ? inlines(child.children, `${path}/children/${i}/children`) : lost(child, `${path}/children/${i}`)).join('')}</w:p>` : ''
  const blocks = (nodes: Tree[] = [], path: string): string => nodes.map((node, i) => block(node, `${path}/${i}`)).join('')
  function table(node: Tree, path: string): string {
    const rows = (node.children ?? []).flatMap((group: Tree, gi: number) => (group.children ?? []).map((row: Tree, ri: number) => ({ row, group, path: `${path}/children/${gi}/children/${ri}` })))
    const width = Math.max(node.columns?.length ?? 0, ...rows.map(({ row }: any) => row.children?.length ?? 0), 1)
    const grid = `<w:tblGrid>${Array.from({ length: width }, () => '<w:gridCol w:w="2400"/>').join('')}</w:tblGrid>`
    const content = rows.map(({ row, group, path: rowPath }: any) => `<w:tr>${group.type === 'table_head' ? '<w:trPr><w:tblHeader w:val="true"/></w:trPr>' : ''}${(row.children ?? []).map((cell: Tree, ci: number) => {
      const cp = `${rowPath}/children/${ci}`
      if (cell.span === 'colspan') return ''
      const span = cell.colspan ? `<w:gridSpan w:val="${cell.colspan}"/>` : ''
      const merge = cell.span === 'rowspan' ? '<w:vMerge w:val="continue"/>' : cell.rowspan ? '<w:vMerge w:val="restart"/>' : ''
      const alignment = cell.align ?? node.columns?.[ci]?.resolvedAlign
      const body = (cell.children ?? []).map((child: Tree, bi: number) => ['paragraph', 'cell_paragraph'].includes(child.type)
        ? para(child.children, `${cp}/children/${bi}/children`, undefined, alignment)
        : block(child, `${cp}/children/${bi}`)).join('')
      return `<w:tc><w:tcPr>${span}${merge}</w:tcPr>${body || '<w:p/>'}</w:tc>`
    }).join('')}</w:tr>`).join('')
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${content}</w:tbl>${caption(node.caption, `${path}/caption`, 'Table')}`
  }
  function block(node: Tree, path: string): string {
    switch (node.type) {
      case 'paragraph': case 'cell_paragraph': return para(node.children, `${path}/children`)
      case 'heading': return para(node.children, `${path}/children`, `Heading${Math.min(node.level ?? 1, 6)}`)
      case 'table': return table(node, path)
      case 'figure': return blocks(node.children, `${path}/children`) + caption(node.caption, `${path}/caption`, 'Figure')
      case 'image': return para([{ type: 'image', ...node }], path)
      default: return lost(node, path)
    }
  }
  const body = blocks(tree.children, '/children')
  const entries = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/></w:style>' + Array.from({ length: 6 }, (_, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/></w:style>`).join('') + '</w:styles>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  }
  return { bytes: zip(entries), losses }
}
export function validateDocx(bytes: Buffer): { ok: boolean, json: Tree | null, error: string } {
  const dir = mkdtempSync(join(tmpdir(), 'carve-docx-'))
  const path = join(dir, 'trial.docx')
  try {
    writeFileSync(path, bytes)
    const run = spawnSync('pandoc', ['-f', 'docx', '-t', 'json', path], { maxBuffer: 64 * 1024 * 1024, timeout: 10000 })
    return { ok: run.status === 0, json: run.status === 0 ? JSON.parse(run.stdout.toString()) : null, error: run.stderr?.toString() ?? run.error?.message ?? '' }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
export function writeDocx(path: string, tree: Tree) { const result = toDocx(tree); writeFileSync(path, result.bytes); return result }

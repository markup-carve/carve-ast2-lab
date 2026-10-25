import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parse, toAstJson } from '@markup-carve/carve'
import { corpusFiles } from '../measure.ts'
import { upgrade, type Tree } from '../upgrade.ts'
import { toPandoc, validatePandoc } from './pandoc.ts'
import { toDocx, validateDocx } from './docx.ts'

const files = corpusFiles()
const lossCounts: Record<string, number> = {}
const pandocFailures: { file: string, error: string }[] = []
const docxFailures: { file: string, error: string }[] = []
const structuralFailures: { file: string, reason: string }[] = []
let pandocAccepted = 0
let pandocLossless = 0
let docxAttempted = 0
let docxAccepted = 0
let tableCount = 0
let figureCount = 0
let docxLosses = 0
const batch: { file: string, doc: Tree, hasTable: boolean, hasFigure: boolean, cells: number }[] = []
function nodes(tree: Tree, type: string): Tree[] {
  const found: Tree[] = []
  function visit(value: any) {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    if (value.type === type) found.push(value)
    Object.values(value).forEach(visit)
  }
  visit(tree)
  return found
}
function flush() {
  if (!batch.length) return
  const combined = { 'pandoc-api-version': [1, 23, 1], meta: {}, blocks: batch.flatMap(({ file, doc }) => [{ t: 'Div', c: [[file, [], []], doc.blocks] }]) }
  const checked = validatePandoc(combined)
  if (checked.ok) {
    pandocAccepted += batch.length
    for (const entry of batch) {
      if (entry.hasTable && !checked.native.includes('Table')) structuralFailures.push({ file: entry.file, reason: 'Table constructor absent' })
      if (entry.hasFigure && !checked.native.includes('Figure')) structuralFailures.push({ file: entry.file, reason: 'Figure constructor absent' })
    }
  } else {
    for (const entry of batch) {
      const single = validatePandoc(entry.doc)
      if (single.ok) pandocAccepted++
      else pandocFailures.push({ file: entry.file, error: single.error.trim() })
      if (entry.hasTable && !single.native.includes('Table')) structuralFailures.push({ file: entry.file, reason: 'Table constructor absent' })
      if (entry.hasFigure && !single.native.includes('Figure')) structuralFailures.push({ file: entry.file, reason: 'Figure constructor absent' })
    }
  }
  batch.length = 0
}
for (const file of files) {
  const tree = upgrade(toAstJson(parse(readFileSync(file, 'utf8'))) as Tree)
  const tables = nodes(tree, 'table')
  const figures = nodes(tree, 'figure')
  tableCount += tables.length
  figureCount += figures.length
  const converted = toPandoc(tree)
  const pandocTables: any[] = []
  const pandocFigures: any[] = []
  function collectConstructors(value: any) {
    if (Array.isArray(value)) { value.forEach(collectConstructors); return }
    if (!value || typeof value !== 'object') return
    if (value.t === 'Table') pandocTables.push(value)
    if (value.t === 'Figure') pandocFigures.push(value)
    Object.values(value).forEach(collectConstructors)
  }
  collectConstructors(converted.doc)
  if (pandocTables.length < tables.length) structuralFailures.push({ file: basename(file), reason: `Pandoc tables ${pandocTables.length}/${tables.length}` })
  if (pandocFigures.length < figures.length) structuralFailures.push({ file: basename(file), reason: `Pandoc figures ${pandocFigures.length}/${figures.length}` })
  for (let ti = 0; ti < Math.min(tables.length, pandocTables.length); ti++) {
    const expected = nodes(tables[ti], 'table_cell').filter((cell) => !cell.span).length
    const parts = pandocTables[ti].c
    const rows = [...(parts[3]?.[1] ?? []), ...(parts[4] ?? []).flatMap((body: any) => [...body[2], ...body[3]]), ...(parts[5]?.[1] ?? [])]
    const actual = rows.reduce((count: number, row: any) => count + (row[1]?.length ?? 0), 0)
    if (actual !== expected) structuralFailures.push({ file: basename(file), reason: `Pandoc cells ${actual}/${expected}` })
  }
  if (!converted.losses.length) pandocLossless++
  for (const loss of converted.losses) lossCounts[loss.type] = (lossCounts[loss.type] ?? 0) + 1
  batch.push({ file: basename(file), doc: converted.doc, hasTable: !!tables.length, hasFigure: !!figures.length, cells: tables.flatMap((table) => nodes(table, 'table_cell')).filter((cell) => !cell.span).length })
  if (batch.length === 25) flush()
  if (tables.length || figures.length) {
    docxAttempted++
    const docx = toDocx(tree)
    docxLosses += docx.losses.length
    const checked = validateDocx(docx.bytes)
    if (checked.ok) docxAccepted++
    else docxFailures.push({ file: basename(file), error: checked.error.trim() })
    if (checked.ok) {
      const emittedTables = JSON.stringify(checked.json).match(/"t":"Table"/g)?.length ?? 0
      if (emittedTables < tables.length) structuralFailures.push({ file: basename(file), reason: `DOCX tables ${emittedTables}/${tables.length}` })
      const outputTables: any[] = []
      function collectPandoc(value: any) {
        if (Array.isArray(value)) { value.forEach(collectPandoc); return }
        if (!value || typeof value !== 'object') return
        if (value.t === 'Table') outputTables.push(value)
        Object.values(value).forEach(collectPandoc)
      }
      collectPandoc(checked.json)
      for (let ti = 0; ti < Math.min(tables.length, outputTables.length); ti++) {
        const sourceCells = nodes(tables[ti], 'table_cell').filter((cell) => !cell.span)
        const tableParts = outputTables[ti].c
        const outputRows = [
          ...(tableParts[3]?.[1] ?? []),
          ...(tableParts[4] ?? []).flatMap((body: any) => [...body[2], ...body[3]]),
          ...(tableParts[5]?.[1] ?? []),
        ]
        const outputCells = outputRows.flatMap((row: any) => row[1] ?? [])
        if (outputCells.length !== sourceCells.length) structuralFailures.push({ file: basename(file), reason: `DOCX cells ${outputCells.length}/${sourceCells.length}` })
        for (let ci = 0; ci < Math.min(sourceCells.length, outputCells.length); ci++) {
          const source = sourceCells[ci]
          const output = outputCells[ci]
          if ((source.rowspan ?? 1) !== output[2] || (source.colspan ?? 1) !== output[3]) structuralFailures.push({ file: basename(file), reason: `DOCX span mismatch in table ${ti}, cell ${ci}` })
          const sourceWords = nodes(source, 'text').map((part) => String(part.value ?? '')).join('').trim().split(/\s+/).filter(Boolean)
          const outputText = JSON.stringify(output[4])
          if (sourceWords.some((word) => !outputText.includes(word))) structuralFailures.push({ file: basename(file), reason: `DOCX cell text missing in table ${ti}, cell ${ci}` })
        }
      }

    }

  }
}
flush()
const result = { documents: files.length, pandoc: { accepted: pandocAccepted, lossless: pandocLossless, lossCounts: Object.fromEntries(Object.entries(lossCounts).sort(([a], [b]) => a.localeCompare(b))), failures: pandocFailures }, docx: { attempted: docxAttempted, accepted: docxAccepted, tables: tableCount, figures: figureCount, losses: docxLosses, failures: docxFailures }, structuralFailures }
mkdirSync('results', { recursive: true })
writeFileSync(join('results', 'consumer-formats.json'), JSON.stringify(result, null, 2) + '\n')
console.log({ pandoc: { accepted: pandocAccepted, lossless: pandocLossless, failures: pandocFailures.length }, docx: { attempted: docxAttempted, accepted: docxAccepted, failures: docxFailures.length }, structuralFailures: structuralFailures.length })

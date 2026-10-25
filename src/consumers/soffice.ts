import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse, toAstJson } from '@markup-carve/carve'
import { corpusFiles } from '../measure.ts'
import { upgrade, type Tree } from '../upgrade.ts'
import { toDocx } from './docx.ts'

function hasTarget(value: any): boolean {
  if (Array.isArray(value)) return value.some(hasTarget)
  if (!value || typeof value !== 'object') return false
  return value.type === 'table' || value.type === 'figure' || Object.values(value).some(hasTarget)
}
const dir = mkdtempSync(join(tmpdir(), 'carve-soffice-'))
const failures: { file: string, error: string }[] = []
let attempted = 0
let converted = 0
try {
  const paths: string[] = []
  for (const file of corpusFiles()) {
    const tree = upgrade(toAstJson(parse(readFileSync(file, 'utf8'))) as Tree)
    if (!hasTarget(tree)) continue
    const path = join(dir, basename(file, '.crv') + '.docx')
    writeFileSync(path, toDocx(tree).bytes)
    paths.push(path)
    attempted++
  }
  for (let i = 0; i < paths.length; i += 20) {
    const batch = paths.slice(i, i + 20)
    const run = spawnSync('soffice', ['-env:UserInstallation=file://' + join(dir, 'profile'), '--headless', '--convert-to', 'pdf', '--outdir', dir, ...batch], { encoding: 'utf8', timeout: 120000 })
    for (const path of batch) {
      const pdf = path.slice(0, -5) + '.pdf'
      if (run.status === 0 && existsSync(pdf)) converted++
      else failures.push({ file: basename(path), error: (run.stderr || run.error?.message || `status ${run.status}`).trim() })
    }
  }
  console.log({ attempted, converted, failures: failures.length })
  if (failures.length) { console.log(failures.slice(0, 10)); process.exitCode = 1 }
} finally { rmSync(dir, { recursive: true, force: true }) }

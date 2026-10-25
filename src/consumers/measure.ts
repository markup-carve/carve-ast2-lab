import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parse, toAstJson } from '@markup-carve/carve'
import { corpusFiles } from '../measure.ts'
import { upgrade, type Tree } from '../upgrade.ts'
import { coverage, slots12, slots20 } from './walk.ts'

const totals = { '1.2': { total: 0, reached: 0, childrenReached: 0, missing: 0, slotNames: new Set<string>() }, '2.0': { total: 0, reached: 0, childrenReached: 0, missing: 0, slotNames: new Set<string>() } }
const failures: { file: string, version: string, missing: string[] }[] = []
for (const file of corpusFiles()) {
  const old = toAstJson(parse(readFileSync(file, 'utf8'))) as Tree
  const newer = upgrade(old)
  for (const [version, tree, slots] of [['1.2', old, slots12], ['2.0', newer, slots20]] as const) {
    const result = coverage(tree, slots)
    const total = totals[version]
    total.total += result.total
    total.reached += result.reached
    total.childrenReached += result.childrenReached
    total.missing += result.missing.length
    if (result.missing.length) failures.push({ file: file.split('/').at(-1)!, version, missing: result.missing })
    for (const [type, keys] of Object.entries(slots)) if (keys.some((key) => tree.type === type && key in tree)) keys.forEach((key) => total.slotNames.add(key))
  }
}
const result = { documents: corpusFiles().length, versions: Object.fromEntries(Object.entries(totals).map(([version, total]) => [version, { totalNodes: total.total, reached: total.reached, childrenReached: total.childrenReached, childrenShare: total.childrenReached / total.total, missing: total.missing, schemaSlotNames: [...new Set(Object.values(version === '1.2' ? slots12 : slots20).flat())].sort() }])), failures }
mkdirSync('results', { recursive: true })
writeFileSync('results/consumer-walk.json', JSON.stringify(result, null, 2) + '\n')
console.log(Object.fromEntries(Object.entries(result.versions).map(([version, row]) => [version, { ...row, schemaSlotNames: row.schemaSlotNames.length }])), { failures: failures.length })
if (totals['2.0'].missing) process.exitCode = 1

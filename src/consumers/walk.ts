import { readFileSync } from 'node:fs'
import type { Tree } from '../upgrade.ts'

export type Slots = Record<string, string[]>
const schema = JSON.parse(readFileSync(new URL('../../schema/ast-schema-2.0.json', import.meta.url), 'utf8'))
const roles = JSON.parse(readFileSync(new URL('../../spec/resources/node-roles.json', import.meta.url), 'utf8'))
function nodeSlot(def: any): boolean {
  if (!def || typeof def !== 'object') return false
  if (def.$ref) {
    const name = def.$ref.split('/').at(-1)
    const target = schema.$defs[name]
    return ['blockNode', 'inlineNode', 'cellInlineNode'].includes(name) || !!target?.properties?.type?.const
  }
  if (def.items) return nodeSlot(def.items)
  if (def.additionalProperties) return nodeSlot(def.additionalProperties)
  if (def.anyOf || def.oneOf) return (def.anyOf ?? def.oneOf).some(nodeSlot)
  return false
}
export const slots20: Slots = Object.fromEntries(Object.entries(schema.$defs).filter(([, def]: any) => def.properties && def.properties.type?.const).map(([name, def]: any) => [def.properties.type.const, Object.entries(def.properties).filter(([, value]) => nodeSlot(value)).map(([key]) => key).sort()]))
export const slots12: Slots = Object.fromEntries(Object.entries(roles.roles).map(([name, values]: any) => [name, Object.entries(values).filter(([key, value]: any) => value.role === 'node-sequence' || value.role === 'node' || value.role === 'single-node' || (value.role === 'record-sequence' && ['pairs'].includes(key))).map(([key]) => key).sort()]))
export function walk(tree: Tree, slots: Slots, visit: (node: Tree, path: string) => void) {
  function traverse(node: Tree, path: string) {
    visit(node, path)
    for (const key of slots[node.type] ?? []) {
      const value = node[key]
      if (Array.isArray(value)) value.forEach((child, i) => { if (child?.type) traverse(child, `${path}/${key}/${i}`) })
      else if (value?.type) traverse(value, `${path}/${key}`)
      else if (value && typeof value === 'object') for (const [name, entries] of Object.entries(value)) {
        if (Array.isArray(entries)) entries.forEach((child, i) => { if (child?.type) traverse(child, `${path}/${key}/${name}/${i}`) })
      }
    }
  }
  traverse(tree, '')
}
export function jsonNodePaths(tree: Tree): string[] {
  const found: string[] = []
  function traverse(value: any, path: string) {
    if (!value || typeof value !== 'object') return
    if (typeof value.type === 'string') found.push(path)
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child)) child.forEach((entry, i) => traverse(entry, `${path}/${key}/${i}`))
      else traverse(child, `${path}/${key}`)
    }
  }
  traverse(tree, '')
  return found
}
export function coverage(tree: Tree, slots: Slots) {
  const paths: string[] = []
  const childrenPaths: string[] = []
  walk(tree, slots, (_, path) => paths.push(path))
  walk(tree, Object.fromEntries(Object.keys(slots).map((type) => [type, ['children']])), (_, path) => childrenPaths.push(path))
  const all = jsonNodePaths(tree)
  return { total: all.length, reached: paths.length, childrenReached: childrenPaths.length, missing: all.filter((path) => !paths.includes(path)) }
}

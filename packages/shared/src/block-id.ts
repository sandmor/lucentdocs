import type { JsonObject, JsonValue } from './json.js'

export const BLOCK_ID_ATTR = 'id' as const

/** Node types that carry a stable block id attribute. */
export const BLOCK_ID_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'code_block',
  'horizontal_rule',
  'image',
  'bullet_list',
  'ordered_list',
  'list_item',
])

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function generateBlockId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}

function readBlockId(attrs: JsonObject | undefined): string | null {
  if (!attrs) return null
  const id = attrs[BLOCK_ID_ATTR]
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Ensures every block node in a ProseMirror JSON tree has a unique non-null id.
 * Duplicate ids are reassigned so anchors remain unambiguous.
 */
export function ensureBlockIds(pmJson: JsonObject): JsonObject {
  const seen = new Set<string>()

  const visit = (node: JsonObject): JsonObject => {
    const type = node.type
    const attrs = isRecord(node.attrs) ? { ...node.attrs } : {}
    let nextNode: JsonObject = node

    if (typeof type === 'string' && BLOCK_ID_NODE_TYPES.has(type)) {
      let id = readBlockId(attrs)
      if (!id || seen.has(id)) {
        id = generateBlockId()
      }
      seen.add(id)
      attrs[BLOCK_ID_ATTR] = id
      nextNode = { ...node, attrs }
    }

    const content = node.content
    if (!Array.isArray(content)) {
      return nextNode
    }

    return {
      ...nextNode,
      content: content.map((child) => (isRecord(child) ? visit(child) : child)),
    }
  }

  return visit(pmJson)
}

export function mergeBlockIdIntoDomAttrs(
  domAttrs: Record<string, string>,
  blockId: string | null | undefined
): Record<string, string> {
  if (!blockId) return domAttrs
  return { ...domAttrs, 'data-block-id': blockId }
}

export function readBlockIdFromDom(dom: HTMLElement): string | null {
  const value = dom.getAttribute('data-block-id')
  return value && value.length > 0 ? value : null
}

export function collectTopLevelBlockIds(pmJson: JsonObject): string[] {
  if (!isRecord(pmJson) || pmJson.type !== 'doc' || !Array.isArray(pmJson.content)) {
    return []
  }

  const ids: string[] = []
  for (const child of pmJson.content) {
    if (!isRecord(child)) continue
    const id = readBlockId(isRecord(child.attrs) ? child.attrs : undefined)
    if (id) ids.push(id)
  }
  return ids
}

export function isJsonBlockNode(value: unknown): value is JsonObject {
  return isRecord(value) && typeof value.type === 'string' && BLOCK_ID_NODE_TYPES.has(value.type)
}

export type { JsonValue }

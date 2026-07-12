import {
  ensureBlockIds,
  type JsonObject,
} from '@lucentdocs/shared'
import { markdownToProseMirrorDoc } from '../../core/markdown/native.js'

const NOTE_MARKER_TYPE = 'note_marker'
const BLOCK_ID_ATTR = 'id'

export interface DocumentEditMergeWarning {
  code: 'orphaned_block_notes' | 'marker_notes_at_risk'
  message: string
  anchorIds?: string[]
}

export interface DocumentEditMergeResult {
  doc: JsonObject
  warnings: DocumentEditMergeWarning[]
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBlockId(node: JsonObject): string | null {
  const attrs = node.attrs
  if (!isRecord(attrs)) return null
  const id = attrs[BLOCK_ID_ATTR]
  return typeof id === 'string' && id.length > 0 ? id : null
}

function copyBlockId(node: JsonObject, blockId: string): JsonObject {
  const attrs = isRecord(node.attrs) ? { ...node.attrs, [BLOCK_ID_ATTR]: blockId } : { [BLOCK_ID_ATTR]: blockId }
  return { ...node, attrs }
}

interface MarkerSlot {
  afterContentIndex: number
  node: JsonObject
}

function collectMarkerSlots(children: JsonObject[]): MarkerSlot[] {
  const slots: MarkerSlot[] = []
  let contentIndex = -1

  for (const child of children) {
    if (!isRecord(child) || typeof child.type !== 'string') continue
    if (child.type === NOTE_MARKER_TYPE) {
      slots.push({ afterContentIndex: contentIndex, node: child })
      continue
    }
    contentIndex += 1
  }

  return slots
}

function splitContentBlocks(children: JsonObject[]): JsonObject[] {
  return children.filter(
    (child) => isRecord(child) && typeof child.type === 'string' && child.type !== NOTE_MARKER_TYPE
  )
}

function mergeContentBlocks(
  originalBlocks: JsonObject[],
  newBlocks: JsonObject[]
): { blocks: JsonObject[]; removedBlockIds: string[] } {
  const blocks = newBlocks.map((block, index) => {
    if (index >= originalBlocks.length) return block
    const blockId = readBlockId(originalBlocks[index])
    if (!blockId) return block
    return copyBlockId(block, blockId)
  })

  const removedBlockIds = originalBlocks
    .slice(newBlocks.length)
    .flatMap((block) => {
      const blockId = readBlockId(block)
      return blockId ? [blockId] : []
    })

  return { blocks, removedBlockIds }
}

function interleaveMarkers(mergedBlocks: JsonObject[], markerSlots: MarkerSlot[]): JsonObject[] {
  const slotsByAfter = new Map<number, JsonObject[]>()
  for (const slot of markerSlots) {
    const existing = slotsByAfter.get(slot.afterContentIndex) ?? []
    existing.push(slot.node)
    slotsByAfter.set(slot.afterContentIndex, existing)
  }

  const rebuilt: JsonObject[] = []
  const leading = slotsByAfter.get(-1)
  if (leading) rebuilt.push(...leading)

  for (let index = 0; index < mergedBlocks.length; index += 1) {
    rebuilt.push(mergedBlocks[index])
    const after = slotsByAfter.get(index)
    if (after) rebuilt.push(...after)
  }

  return rebuilt
}

export function mergeEditedManuscript(
  originalDoc: JsonObject,
  editedManuscript: string,
  options: {
    blockAnchoredIds: ReadonlySet<string>
    markerAnchoredIds: ReadonlySet<string>
  }
): DocumentEditMergeResult {
  const parsed = markdownToProseMirrorDoc(editedManuscript)
  if (!parsed.ok) {
    throw new Error('Failed to parse edited manuscript markdown.')
  }

  const originalChildren = Array.isArray(originalDoc.content)
    ? originalDoc.content.filter(isRecord)
    : []
  const markerSlots = collectMarkerSlots(originalChildren)
  const originalContentBlocks = splitContentBlocks(originalChildren)

  const editedChildren = Array.isArray(parsed.value.content)
    ? parsed.value.content.filter(isRecord)
    : []
  const newContentBlocks = splitContentBlocks(editedChildren)

  const { blocks: mergedBlocks, removedBlockIds } = mergeContentBlocks(
    originalContentBlocks,
    newContentBlocks
  )

  const warnings: DocumentEditMergeWarning[] = []
  const orphanedBlockIds = removedBlockIds.filter((blockId) => options.blockAnchoredIds.has(blockId))
  if (orphanedBlockIds.length > 0) {
    warnings.push({
      code: 'orphaned_block_notes',
      message:
        'Some block-anchored author annotations may no longer attach to manuscript text after this edit.',
      anchorIds: orphanedBlockIds,
    })
  }

  const rebuiltContent = interleaveMarkers(mergedBlocks, markerSlots)
  const mergedDoc = ensureBlockIds({
    type: 'doc',
    content: rebuiltContent,
  })

  const rebuiltMarkerIds = new Set(
    rebuiltContent
      .filter((child) => isRecord(child) && child.type === NOTE_MARKER_TYPE)
      .flatMap((child) => {
        const blockId = readBlockId(child)
        return blockId ? [blockId] : []
      })
  )

  if (options.markerAnchoredIds.size > 0) {
    const stillPresent = [...options.markerAnchoredIds].filter((anchorId) =>
      rebuiltMarkerIds.has(anchorId)
    )
    if (stillPresent.length === 0) {
      throw new Error(
        'Edit would remove all note marker anchors that still have author annotations. Narrow the edit or preserve surrounding structure.'
      )
    }
  }

  return {
    doc: mergedDoc,
    warnings,
  }
}

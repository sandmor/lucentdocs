import { ensureBlockIds, schema, type JsonObject } from '@lucentdocs/shared'
import { Fragment, Slice, type Node as ProseMirrorNode } from 'prosemirror-model'
import { Transform } from 'prosemirror-transform'
import { markdownToProseMirrorDoc } from '../../core/markdown/native.js'
import { serializeTopLevelBlock } from './document-manuscript.js'
import { EditToolError } from './edit-errors.js'
import {
  projectDocumentEntries,
  resolveManuscriptRangeToDocRange,
  sliceTopLevelEntries,
  type ManuscriptTopLevelEntry,
} from './manuscript-projection.js'

const NOTE_MARKER_TYPE = 'note_marker'

export interface BlockIdMigration {
  from: string
  to: string
}

export interface DocumentEditPlanResult {
  changed: boolean
  nextDoc: ProseMirrorNode
  replacements: number
  deletedBlockIds: string[]
  blockIdMigrations: BlockIdMigration[]
  warnings: string[]
}

interface SingleRangeEditResult {
  nextDoc: ProseMirrorNode
  deletedBlockIds: string[]
  blockIdMigrations: BlockIdMigration[]
  warnings: string[]
}

function readBlockId(node: ProseMirrorNode): string | null {
  const id = node.attrs.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function copyBlockId(node: ProseMirrorNode, blockId: string): ProseMirrorNode {
  return node.type.create({ ...node.attrs, id: blockId }, node.content, node.marks)
}

function parseReplacementBlocks(markdown: string): ProseMirrorNode[] {
  const parsed = markdownToProseMirrorDoc(markdown)
  if (!parsed.ok) {
    throw new EditToolError('not_found', 'Failed to parse replacement markdown.', {
      hint: 'Provide valid manuscript markdown for new_string.',
    })
  }

  const parsedDoc = schema.nodeFromJSON(parsed.value)
  const blocks: ProseMirrorNode[] = []
  parsedDoc.forEach((child) => {
    if (child.type.name === NOTE_MARKER_TYPE) return
    blocks.push(child)
  })
  return blocks
}

function replacementInlineSlice(markdown: string): Slice {
  const parsed = markdownToProseMirrorDoc(markdown)
  if (!parsed.ok) {
    throw new EditToolError('not_found', 'Failed to parse replacement markdown.', {
      hint: 'Provide valid manuscript markdown for new_string.',
    })
  }

  const parsedDoc = schema.nodeFromJSON(parsed.value)
  const firstBlock = parsedDoc.child(0)
  if (!firstBlock) {
    return new Slice(Fragment.empty, 0, 0)
  }

  return new Slice(firstBlock.content, 0, 0)
}

function assignBlockIdsToReplacement(
  originalBlocks: ProseMirrorNode[],
  replacementBlocks: ProseMirrorNode[]
): { blocks: ProseMirrorNode[]; deletedBlockIds: string[]; migrations: BlockIdMigration[] } {
  const migrations: BlockIdMigration[] = []
  const originalIds = originalBlocks
    .map(readBlockId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (replacementBlocks.length === 0) {
    return { blocks: [], deletedBlockIds: originalIds, migrations }
  }

  const leadingId = originalIds[0] ?? null
  const blocks = replacementBlocks.map((block, index) => {
    const sourceId = originalIds[index] ?? null
    if (!sourceId) return block
    return copyBlockId(block, sourceId)
  })

  if (replacementBlocks.length < originalBlocks.length && leadingId) {
    for (const removedId of originalIds.slice(replacementBlocks.length)) {
      migrations.push({ from: removedId, to: leadingId })
    }
  }

  const preservedIds = new Set(
    blocks.map(readBlockId).filter((id): id is string => typeof id === 'string' && id.length > 0)
  )
  const deletedBlockIds = originalIds.filter((id) => !preservedIds.has(id))

  return { blocks, deletedBlockIds, migrations }
}

function collectMarkerSlots(
  sliceEntries: ManuscriptTopLevelEntry[]
): Array<{ afterContentIndex: number; node: ProseMirrorNode }> {
  const slots: Array<{ afterContentIndex: number; node: ProseMirrorNode }> = []
  let contentIndex = -1

  for (const entry of sliceEntries) {
    if (entry.kind === 'marker') {
      slots.push({ afterContentIndex: contentIndex, node: entry.node })
      continue
    }
    contentIndex += 1
  }

  return slots
}

function interleaveMarkersInSlice(
  replacementBlocks: ProseMirrorNode[],
  markers: Array<{ afterContentIndex: number; node: ProseMirrorNode }>
): ProseMirrorNode[] {
  const slots = new Map<number, ProseMirrorNode[]>()
  for (const marker of markers) {
    const existing = slots.get(marker.afterContentIndex) ?? []
    existing.push(marker.node)
    slots.set(marker.afterContentIndex, existing)
  }

  const rebuilt: ProseMirrorNode[] = []
  const leading = slots.get(-1)
  if (leading) rebuilt.push(...leading)

  for (let index = 0; index < replacementBlocks.length; index += 1) {
    rebuilt.push(replacementBlocks[index])
    const after = slots.get(index)
    if (after) rebuilt.push(...after)
  }

  return rebuilt
}

function applySingleRangeEdit(
  doc: ProseMirrorNode,
  start: number,
  end: number,
  newString: string
): SingleRangeEditResult {
  const projection = projectDocumentEntries(doc)
  const { from, to, entries: affectedContent } = resolveManuscriptRangeToDocRange(projection, start, end)
  const sliceEntries = sliceTopLevelEntries(projection, affectedContent)
  const warnings: string[] = []

  if (affectedContent.length === 1) {
    const entry = affectedContent[0]
    const blockText = serializeTopLevelBlock(entry.node)
    const localStart = start - (entry.textStart ?? 0)
    const localEnd = end - (entry.textStart ?? 0)
    const isFullBlock = localStart === 0 && localEnd === blockText.length

    if (!isFullBlock) {
      const tr = new Transform(doc)
      tr.replaceRange(from, to, replacementInlineSlice(newString))
      return {
        nextDoc: tr.doc,
        deletedBlockIds: [],
        blockIdMigrations: [],
        warnings,
      }
    }
  }

  const sliceFrom = sliceEntries[0].pos
  const sliceTo = sliceEntries[sliceEntries.length - 1].pos + sliceEntries[sliceEntries.length - 1].nodeSize
  const originalContent = sliceEntries
    .filter((entry) => entry.kind === 'content')
    .map((entry) => entry.node)
  const markerSlots = collectMarkerSlots(sliceEntries)
  const replacementBlocks = parseReplacementBlocks(newString)
  const assigned = assignBlockIdsToReplacement(originalContent, replacementBlocks)
  const rebuiltNodes = interleaveMarkersInSlice(assigned.blocks, markerSlots)

  if (assigned.deletedBlockIds.length > 0) {
    warnings.push(
      'Some block-anchored author annotations may need to be reattached after this structural edit.'
    )
  }

  const tr = new Transform(doc)
  tr.replace(sliceFrom, sliceTo, new Slice(Fragment.from(rebuiltNodes), 0, 0))

  return {
    nextDoc: tr.doc,
    deletedBlockIds: assigned.deletedBlockIds,
    blockIdMigrations: assigned.migrations,
    warnings,
  }
}

export function applyDocumentManuscriptEdits(
  doc: ProseMirrorNode,
  ranges: Array<{ start: number; end: number }>,
  newString: string,
  options: { replaceAll: boolean }
): DocumentEditPlanResult {
  const selected = options.replaceAll ? ranges : [ranges[0]]
  const ordered = [...selected].sort((left, right) => right.start - left.start)

  let nextDoc = doc
  let replacements = 0
  const deletedBlockIds = new Set<string>()
  const blockIdMigrations: BlockIdMigration[] = []
  const warnings: string[] = []

  for (const range of ordered) {
    const result = applySingleRangeEdit(nextDoc, range.start, range.end, newString)
    nextDoc = result.nextDoc
    replacements += 1
    for (const id of result.deletedBlockIds) deletedBlockIds.add(id)
    blockIdMigrations.push(...result.blockIdMigrations)
    warnings.push(...result.warnings)
  }

  const ensured = ensureBlockIds(nextDoc.toJSON() as JsonObject)

  return {
    changed: !schema.nodeFromJSON(ensured).eq(doc),
    nextDoc: schema.nodeFromJSON(ensured),
    replacements,
    deletedBlockIds: [...deletedBlockIds],
    blockIdMigrations,
    warnings,
  }
}

export function assertMarkerAnchorsPreserved(
  beforeDoc: ProseMirrorNode,
  afterDoc: ProseMirrorNode,
  markerAnchoredIds: ReadonlySet<string>
) {
  if (markerAnchoredIds.size === 0) return

  const afterMarkerIds = new Set<string>()
  afterDoc.forEach((node) => {
    if (node.type.name !== NOTE_MARKER_TYPE) return
    const id = readBlockId(node)
    if (id) afterMarkerIds.add(id)
  })

  const stillPresent = [...markerAnchoredIds].filter((anchorId) => afterMarkerIds.has(anchorId))
  if (stillPresent.length === 0) {
    throw new EditToolError(
      'unsafe_anchor_change',
      'Edit would remove all note marker anchors that still have author annotations. Narrow the edit or preserve surrounding structure.',
      { hint: 'Re-read the file and include more surrounding manuscript context in old_string.' }
    )
  }
}

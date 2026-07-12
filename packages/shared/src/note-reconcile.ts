import type { Node as ProseMirrorNode } from 'prosemirror-model'

export function readTopLevelBlockId(node: ProseMirrorNode): string | null {
  const id = node.attrs.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function collectTopLevelBlockIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>()
  doc.forEach((node) => {
    const id = readTopLevelBlockId(node)
    if (id) ids.add(id)
  })
  return ids
}

export function collectDeletedTopLevelBlockIds(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode
): string[] {
  const oldIds = collectTopLevelBlockIds(oldDoc)
  const newIds = collectTopLevelBlockIds(newDoc)
  return [...oldIds].filter((id) => !newIds.has(id))
}

export function collectTopLevelMarkerIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>()
  doc.forEach((node) => {
    if (node.type.name !== 'note_marker') return
    const id = readTopLevelBlockId(node)
    if (id) ids.add(id)
  })
  return ids
}

import { Plugin, PluginKey } from 'prosemirror-state'
import { Fragment, Slice, type Node } from 'prosemirror-model'

export const noteMarkerClipboardPluginKey = new PluginKey('note-marker-clipboard')

function stripNoteMarkersFromSlice(slice: Slice): Slice {
  const children: Node[] = []
  slice.content.forEach((node) => {
    if (node.type.name !== 'note_marker') {
      children.push(node)
    }
  })
  if (children.length === slice.content.childCount) return slice
  return new Slice(Fragment.from(children), slice.openStart, slice.openEnd)
}

export function createNoteMarkerClipboardPlugin(): Plugin {
  return new Plugin({
    key: noteMarkerClipboardPluginKey,
    props: {
      transformPasted(slice) {
        return stripNoteMarkersFromSlice(slice)
      },
      transformCopied(slice) {
        return stripNoteMarkersFromSlice(slice)
      },
    },
  })
}

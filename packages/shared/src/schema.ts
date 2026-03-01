import { Schema } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'

const listNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')
const extendedMarks = basicSchema.spec.marks.append({
  ai_zone: {
    attrs: {
      id: {},
      streaming: { default: false },
      session: { default: null },
      deletedSlice: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span[data-ai-zone-id]',
        getAttrs(dom) {
          const el = dom as HTMLElement
          return {
            id: el.getAttribute('data-ai-zone-id'),
            streaming: el.getAttribute('data-ai-zone-streaming') === 'true',
            session: el.getAttribute('data-ai-zone-session'),
            deletedSlice: el.getAttribute('data-ai-zone-deleted-slice'),
          }
        },
      },
    ],
    toDOM(mark) {
      const attrs = mark.attrs as {
        id: string
        streaming?: boolean
        session?: string | null
        deletedSlice?: string | null
      }

      return [
        'span',
        {
          class: 'ai-generating-text',
          'data-ai-zone-id': attrs.id,
          'data-ai-zone-streaming': String(attrs.streaming === true),
          'data-ai-zone-session': attrs.session ?? '',
          'data-ai-zone-deleted-slice': attrs.deletedSlice ?? '',
        },
        0,
      ]
    },
  },
})

export const schema: Schema = new Schema({
  nodes: listNodes,
  marks: extendedMarks,
})

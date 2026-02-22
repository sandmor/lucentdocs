import { Schema } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'

const listNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')
const extendedMarks = basicSchema.spec.marks.append({
  ai_zone: {
    attrs: {
      id: {},
      mode: { default: 'insert' },
      streaming: { default: false },
      choices: { default: null },
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
            mode: el.getAttribute('data-ai-zone-mode') ?? 'insert',
            streaming: el.getAttribute('data-ai-zone-streaming') === 'true',
            choices: el.getAttribute('data-ai-zone-choices'),
            deletedSlice: el.getAttribute('data-ai-zone-deleted-slice'),
          }
        },
      },
    ],
    toDOM(mark) {
      const attrs = mark.attrs as {
        id: string
        mode?: string
        streaming?: boolean
        choices?: string | null
        deletedSlice?: string | null
      }

      return [
        'span',
        {
          class: 'ai-generating-text',
          'data-ai-zone-id': attrs.id,
          'data-ai-zone-mode': attrs.mode ?? 'insert',
          'data-ai-zone-streaming': String(attrs.streaming === true),
          'data-ai-zone-choices': attrs.choices ?? '',
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

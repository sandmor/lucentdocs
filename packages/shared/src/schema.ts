import { Schema } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'

const listNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')
const extendedNodes = listNodes.append({
  ai_zone: {
    inline: true,
    group: 'inline',
    content: 'inline*',
    marks: '_',
    selectable: false,
    attrs: {
      id: {},
      streaming: { default: false },
      sessionId: { default: null },
      originalSlice: { default: null },
    },
    parseDOM: [
      {
        tag: 'span[data-ai-zone-id]',
        getAttrs(dom) {
          const el = dom as HTMLElement
          return {
            id: el.getAttribute('data-ai-zone-id'),
            streaming: el.getAttribute('data-ai-zone-streaming') === 'true',
            sessionId: el.getAttribute('data-ai-zone-session-id'),
            originalSlice: el.getAttribute('data-ai-zone-original-slice'),
          }
        },
      },
    ],
    toDOM(node) {
      const attrs = node.attrs as {
        id: string
        streaming?: boolean
        sessionId?: string | null
        originalSlice?: string | null
      }

      return [
        'span',
        {
          class: 'ai-generating-text',
          'data-ai-zone-id': attrs.id,
          'data-ai-zone-streaming': String(attrs.streaming === true),
          'data-ai-zone-session-id': attrs.sessionId ?? '',
          'data-ai-zone-original-slice': attrs.originalSlice ?? '',
        },
        0,
      ]
    },
  },
})

export const schema: Schema = new Schema({
  nodes: extendedNodes,
  marks: basicSchema.spec.marks,
})

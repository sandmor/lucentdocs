import { Schema, type DOMOutputSpec, type NodeSpec } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'
import { mergeBlockIdIntoDomAttrs, readBlockIdFromDom } from './block-id.js'

const BLOCK_ID_ATTR_SPEC = { id: { default: null } }

function mergeDomAttrs(output: unknown, blockId: string | null | undefined): DOMOutputSpec {
  if (!blockId) return output as DOMOutputSpec

  if (!Array.isArray(output)) {
    // Non-array spec (DOM node or {dom, contentDOM}) — can't inject attrs safely, return as-is.
    return output as DOMOutputSpec
  }

  const [tag, second, ...rest] = output

  // If index 1 is already a plain attrs object, merge into it.
  if (typeof second === 'object' && second !== null && !Array.isArray(second)) {
    return [tag, mergeBlockIdIntoDomAttrs(second as Record<string, string>, blockId), ...rest] as DOMOutputSpec
  }

  // Otherwise (index 1 is 0 content hole, or missing), insert attrs at position 1 and preserve the rest.
  const tail = second !== undefined ? [second, ...rest] : []
  return [tag, mergeBlockIdIntoDomAttrs({}, blockId), ...tail] as DOMOutputSpec
}

function withBlockId(spec: NodeSpec): NodeSpec {
  if (!spec.group?.includes('block')) {
    return spec
  }

  const existingAttrs = spec.attrs ?? {}
  const existingToDOM = spec.toDOM
  const existingParseDOM = spec.parseDOM ?? []

  return {
    ...spec,
    attrs: {
      ...existingAttrs,
      ...BLOCK_ID_ATTR_SPEC,
    },
    parseDOM: existingParseDOM.map((rule) => ({
      ...rule,
      getAttrs: (dom, ...args: unknown[]) => {
        const base =
          typeof rule.getAttrs === 'function'
            ? rule.getAttrs(dom as HTMLElement, ...(args as []))
            : (rule.getAttrs ?? {})
        // false means "reject this match" — preserve it unchanged
        if (base === false) return false
        const blockId = readBlockIdFromDom(dom as HTMLElement)
        const attrs = typeof base === 'object' && base !== null ? { ...base } : {}
        return blockId ? { ...attrs, id: blockId } : attrs
      },
    })),
    toDOM: (node) => {
      const blockId = node.attrs.id as string | null | undefined
      if (!existingToDOM) {
        return mergeDomAttrs(['div', 0], blockId)
      }

      const output = typeof existingToDOM === 'function' ? existingToDOM(node) : existingToDOM
      return mergeDomAttrs(output, blockId)
    },
  }
}

const listNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')

const nodesWithBlockIds = listNodes
  .update('code_block', withBlockId(listNodes.get('code_block')!))
  .update('paragraph', withBlockId(listNodes.get('paragraph')!))
  .update('heading', withBlockId(listNodes.get('heading')!))
  .update('blockquote', withBlockId(listNodes.get('blockquote')!))
  .update('horizontal_rule', withBlockId(listNodes.get('horizontal_rule')!))
  .update('image', withBlockId(listNodes.get('image')!))
  .update('bullet_list', withBlockId(listNodes.get('bullet_list')!))
  .update('ordered_list', withBlockId(listNodes.get('ordered_list')!))
  .update('list_item', withBlockId(listNodes.get('list_item')!))

const extendedNodes = nodesWithBlockIds
  .update('code_block', {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    attrs: { language: { default: '' }, id: { default: null } },
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs(dom) {
          const el = dom as HTMLElement
          const blockId = readBlockIdFromDom(el)
          return {
            language: el.getAttribute('data-language') || '',
            ...(blockId ? { id: blockId } : {}),
          }
        },
      },
    ],
    toDOM(node) {
      const attrs = mergeBlockIdIntoDomAttrs(
        { 'data-language': node.attrs.language as string },
        node.attrs.id as string | null | undefined
      )
      return ['pre', attrs, ['code', 0]]
    },
  })
  .append({
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

const extendedMarks = basicSchema.spec.marks.update('code', {
  ...basicSchema.spec.marks.get('code')!,
  inclusive: false,
})

export const schema: Schema = new Schema({
  nodes: extendedNodes,
  marks: extendedMarks,
})

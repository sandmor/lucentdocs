import { Schema } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'

/**
 * ProseMirror schema.
 *
 * Basic schema (paragraph, heading, blockquote, code_block, horizontal_rule,
 * hard_break, image) + list support.
 */
const listNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')

export const schema = new Schema({
  nodes: listNodes,
  marks: basicSchema.spec.marks,
})

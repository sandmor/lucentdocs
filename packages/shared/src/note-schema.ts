import { Schema } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { schema } from './schema.js'

const marks = basicSchema.spec.marks.update('code', {
  ...basicSchema.spec.marks.get('code')!,
  inclusive: false,
})

/** Compact schema for note body editors, with inline equations only. */
export const noteSchema: Schema = new Schema({
  nodes: basicSchema.spec.nodes.append({
    math_inline: schema.nodes.math_inline.spec,
  }),
  marks,
})

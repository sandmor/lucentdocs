import { Schema } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'

const marks = basicSchema.spec.marks.update('code', {
  ...basicSchema.spec.marks.get('code')!,
  inclusive: false,
})

/** Compact schema for note body editors (paragraph + inline marks + links). */
export const noteSchema: Schema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks,
})

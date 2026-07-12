export type EditErrorCode =
  | 'not_found'
  | 'ambiguous'
  | 'stale_read'
  | 'unsafe_anchor_change'
  | 'input_too_large'
  | 'reserved_markup'
  | 'no_changes'

export class EditToolError extends Error {
  readonly code: EditErrorCode
  readonly hint?: string
  readonly nearLine?: number
  readonly nearOffset?: number

  constructor(
    code: EditErrorCode,
    message: string,
    options: { hint?: string; nearLine?: number; nearOffset?: number } = {}
  ) {
    super(message)
    this.name = 'EditToolError'
    this.code = code
    this.hint = options.hint
    this.nearLine = options.nearLine
    this.nearOffset = options.nearOffset
  }
}

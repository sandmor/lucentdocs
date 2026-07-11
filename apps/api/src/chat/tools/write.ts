import { tool } from 'ai'
import {
  inlineZoneChoicesToolInputSchema,
  inlineZoneWriteToolInputSchema,
  normalizeInlineZoneChoices,
  type InlineZoneChoicesAction,
  type InlineZoneReplaceAction,
  type InlineZoneWriteAction,
} from '@lucentdocs/shared'

interface BuildInlineToolsOptions {
  onWriteAction: (action: InlineZoneWriteAction) => void | Promise<void>
}

export function buildInlineZoneWriteTools(options: BuildInlineToolsOptions) {
  return {
    write_zone: tool({
      description:
        'Write text only inside the active AI zone. Use fromOffset/toOffset relative to the zone text. Set fromOffset == toOffset to insert.',
      inputSchema: inlineZoneWriteToolInputSchema,
      execute: async ({ fromOffset, toOffset, content }) => {
        const normalizedFrom = fromOffset ?? 0
        const normalizedTo = toOffset ?? normalizedFrom
        const action: InlineZoneReplaceAction = {
          type: 'replace_range',
          fromOffset: normalizedFrom,
          toOffset: normalizedTo,
          content,
        }
        await options.onWriteAction(action)
        return {
          ok: true,
          applied: action,
        }
      },
    }),
    write_zone_choices: tool({
      description:
        'Set candidate alternatives for the active AI zone. This replaces the whole zone with user-selectable options.',
      inputSchema: inlineZoneChoicesToolInputSchema,
      execute: async ({ choices }) => {
        const normalizedChoices = normalizeInlineZoneChoices(choices)
        const action: InlineZoneChoicesAction = {
          type: 'set_choices',
          choices: normalizedChoices,
        }
        await options.onWriteAction(action)
        return {
          ok: true,
          applied: action,
        }
      },
    }),
  }
}

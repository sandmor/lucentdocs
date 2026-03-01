import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey, getAIZones } from '../writer-plugin'
import { parseMarkdownishToSlice } from '../../prosemirror/markdownish'
import { createZoneMarkAttrs, getAIZoneMarkType } from './zone-marks'

export function insertChunk(view: EditorView, generatedText: string): void {
  const pluginState = aiWriterPluginKey.getState(view.state)
  if (
    !pluginState?.active ||
    !pluginState.zoneId ||
    pluginState.from === null ||
    pluginState.to === null ||
    pluginState.from > pluginState.to
  ) {
    return
  }

  const $from = view.state.doc.resolve(pluginState.from)
  const $to = view.state.doc.resolve(pluginState.to)
  const content = parseMarkdownishToSlice(generatedText, {
    openStart: $from.parent.inlineContent,
    openEnd: $to.parent.inlineContent,
  })

  const tr = view.state.tr
  tr.replaceRange(pluginState.from, pluginState.to, content)

  const markType = getAIZoneMarkType(view)
  const zoneFrom = tr.mapping.map(pluginState.from, -1)
  const zoneTo = tr.mapping.map(pluginState.to, 1)
  const activeZone = getAIZones(view).find((zone) => zone.id === pluginState.zoneId)
  if (markType && zoneTo > zoneFrom) {
    tr.addMark(
      zoneFrom,
      zoneTo,
      markType.create(
        createZoneMarkAttrs(
          pluginState.zoneId,
          true,
          activeZone?.sessionId ?? null,
          pluginState.deletedSlice ? JSON.stringify(pluginState.deletedSlice.toJSON()) : null
        )
      )
    )
  }

  tr.setMeta(aiWriterPluginKey, { type: 'chunk' })
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === 'string' && body.message.trim()) {
        return body.message
      }
    }

    const text = await response.text()
    if (text.trim()) {
      return text
    }
  } catch {
    return `AI request failed with status ${response.status}`
  }

  return `AI request failed with status ${response.status}`
}

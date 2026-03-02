import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey, getAIZones } from '../writer-plugin'
import { parseMarkdownishToSlice } from '../../prosemirror/markdownish'
import { replaceZoneContent } from './zone-marks'

export function insertChunk(view: EditorView, generatedText: string): void {
  const pluginState = aiWriterPluginKey.getState(view.state)
  if (!pluginState?.active || !pluginState.zoneId) {
    return
  }

  const activeZone = getAIZones(view).find((zone) => zone.id === pluginState.zoneId)
  if (!activeZone || activeZone.nodeFrom > activeZone.nodeTo) {
    return
  }

  const $from = view.state.doc.resolve(activeZone.nodeFrom)
  const $to = view.state.doc.resolve(activeZone.nodeTo)
  const content = parseMarkdownishToSlice(generatedText, {
    openStart: $from.parent.inlineContent,
    openEnd: $to.parent.inlineContent,
  })

  replaceZoneContent(view, activeZone.id, content, {
    streaming: true,
    metaType: 'chunk',
    addToHistory: false,
  })
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

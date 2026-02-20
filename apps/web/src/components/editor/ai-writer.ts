import { EditorView } from 'prosemirror-view'
import { toast } from 'sonner'
import { aiWriterPluginKey } from './ai-writer-plugin'

type StreamingHandler = (streaming: boolean) => void
interface AIWriterControllerOptions {
  onStreamingChange?: StreamingHandler
}

export interface AIWriterController {
  startAIContinuation: (view: EditorView) => void
  startAIPrompt: (view: EditorView, prompt: string) => void
  acceptAI: (view: EditorView) => void
  rejectAI: (view: EditorView) => void
  isAIActive: (view: EditorView) => boolean
  cancelAI: () => void
}

export function createAIWriterController(
  options: AIWriterControllerOptions = {}
): AIWriterController {
  let abortController: AbortController | null = null
  let currentRequestId = 0
  const onStreamingChange = options.onStreamingChange ?? null

  function setStreamingState(streaming: boolean): void {
    onStreamingChange?.(streaming)
  }

  async function streamAI(view: EditorView, payload: StreamPayload): Promise<void> {
    abortController?.abort()
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    const requestId = ++currentRequestId
    setStreamingState(true)

    try {
      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: requestAbortController.signal,
      })

      if (!response.ok) {
        const message = await response.text()
        handleAIError(view, message)
        return
      }

      if (!response.body) {
        handleAIError(view, 'No stream returned from AI endpoint')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (abortController === requestAbortController && !requestAbortController.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        if (value && !requestAbortController.signal.aborted) {
          const chunk = decoder.decode(value, { stream: true })
          insertChunk(view, chunk)
        }

        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState?.active) break
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      const message = error instanceof Error ? error.message : 'AI streaming error'
      handleAIError(view, message)
    } finally {
      if (requestId === currentRequestId && abortController === requestAbortController) {
        abortController = null
        setStreamingState(false)
      }
    }
  }

  function handleAIError(view: EditorView, message: string): void {
    toast.error('AI generation failed', { description: message })

    const pluginState = aiWriterPluginKey.getState(view.state)
    const isEmpty = !pluginState?.active || pluginState.from === pluginState.to

    if (isEmpty) {
      stopAI(view)
    } else {
      setStreamingState(false)
      abortController = null
    }
  }

  function stopAI(view: EditorView): void {
    setStreamingState(false)
    const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'stop' })
    view.dispatch(tr)
  }

  function startAIContinuation(view: EditorView): void {
    const pluginState = aiWriterPluginKey.getState(view.state)
    if (pluginState?.active) {
      return
    }

    const pos = view.state.selection.from

    const tr = view.state.tr
    tr.setMeta(aiWriterPluginKey, { type: 'start', pos })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)

    const context = getDocumentContext(view)
    void streamAI(view, { mode: 'continue', context })
  }

  function startAIPrompt(view: EditorView, prompt: string): void {
    const pluginState = aiWriterPluginKey.getState(view.state)
    if (pluginState?.active) {
      return
    }

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      return
    }

    const pos = view.state.selection.from

    const tr = view.state.tr
    tr.setMeta(aiWriterPluginKey, { type: 'start', pos })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)

    const context = getDocumentContext(view)
    void streamAI(view, { mode: 'prompt', context, prompt: trimmedPrompt })
  }

  function acceptAI(view: EditorView): void {
    const pluginState = aiWriterPluginKey.getState(view.state)
    if (!pluginState?.active) return

    abortController?.abort()
    abortController = null
    setStreamingState(false)

    const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'accept' })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)
  }

  function rejectAI(view: EditorView): void {
    const pluginState = aiWriterPluginKey.getState(view.state)
    if (!pluginState?.active) return

    abortController?.abort()
    abortController = null
    setStreamingState(false)

    const { from, to } = pluginState

    if (from !== null && to !== null && from < to) {
      const tr = view.state.tr
      tr.delete(from, to)
      tr.setMeta(aiWriterPluginKey, { type: 'reject' })
      tr.setMeta('addToHistory', true)
      view.dispatch(tr)
    } else {
      const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'reject' })
      tr.setMeta('addToHistory', true)
      view.dispatch(tr)
    }
  }

  function isAIActive(view: EditorView): boolean {
    const pluginState = aiWriterPluginKey.getState(view.state)
    return pluginState?.active ?? false
  }

  function cancelAI(): void {
    abortController?.abort()
    abortController = null
    setStreamingState(false)
  }

  return {
    startAIContinuation,
    startAIPrompt,
    acceptAI,
    rejectAI,
    isAIActive,
    cancelAI,
  }
}

function getDocumentContext(view: EditorView): string {
  const caretPos = view.state.selection.from
  return view.state.doc.textBetween(0, caretPos, '\n\n', '\n')
}

interface StreamPayload {
  mode: 'continue' | 'prompt'
  context: string
  prompt?: string
}

function insertChunk(view: EditorView, chunk: string): void {
  const pluginState = aiWriterPluginKey.getState(view.state)
  if (
    !pluginState?.active ||
    pluginState.from === null ||
    pluginState.to === null ||
    pluginState.from > pluginState.to
  ) {
    return
  }

  const tr = view.state.tr
  tr.insertText(chunk, pluginState.to)
  tr.setMeta(aiWriterPluginKey, { type: 'chunk' })
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

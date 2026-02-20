import { EditorView } from 'prosemirror-view'
import { toast } from 'sonner'
import { aiWriterPluginKey } from './ai-writer-plugin'
import { StuckDetector } from './ai-writer-stuck-detector'
import { parseMarkdownishToSlice } from './markdownish'

type StreamingHandler = (streaming: boolean) => void
interface AIWriterControllerOptions {
  onStreamingChange?: StreamingHandler
  getIncludeAfterContext?: () => boolean
}

export interface AIWriterController {
  startAIContinuation: (view: EditorView) => void
  startAIPrompt: (view: EditorView, prompt: string) => void
  acceptAI: (view: EditorView) => void
  rejectAI: (view: EditorView) => void
  isAIActive: (view: EditorView) => boolean
  cancelAI: (view?: EditorView) => void
}

export function createAIWriterController(
  options: AIWriterControllerOptions = {}
): AIWriterController {
  let abortController: AbortController | null = null
  let currentRequestId = 0
  let streamedText = ''
  const onStreamingChange = options.onStreamingChange ?? null
  const getIncludeAfterContext = options.getIncludeAfterContext ?? (() => false)
  let currentView: EditorView | null = null

  const stuckDetector = new StuckDetector({
    onStuckStart() {
      if (!currentView) return
      const tr = currentView.state.tr.setMeta(aiWriterPluginKey, { type: 'stuck_start' })
      currentView.dispatch(tr)
    },
    onStuckStop() {
      if (!currentView) return
      const tr = currentView.state.tr.setMeta(aiWriterPluginKey, { type: 'stuck_stop' })
      currentView.dispatch(tr)
    },
  })

  function setStreamingState(streaming: boolean, view?: EditorView): void {
    onStreamingChange?.(streaming)
    if (!streaming && view) {
      stuckDetector.reset()
      currentView = null
      const tr = view.state.tr.setMeta(aiWriterPluginKey, { type: 'streaming_stop' })
      view.dispatch(tr)
    }
  }

  async function streamAI(view: EditorView, payload: StreamPayload): Promise<void> {
    abortController?.abort()
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    const requestId = ++currentRequestId
    currentView = view
    stuckDetector.reset()
    setStreamingState(true)

    try {
      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: requestAbortController.signal,
      })

      if (!response.ok) {
        const message = await readErrorMessage(response)
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
          if (chunk) {
            streamedText += chunk
            stuckDetector.onChunk()
            insertChunk(view, streamedText)
          }
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
        setStreamingState(false, view)
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
      setStreamingState(false, view)
      abortController = null
    }
  }

  function stopAI(view: EditorView): void {
    stuckDetector.reset()
    currentView = null
    setStreamingState(false)
    streamedText = ''
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
    streamedText = ''

    const { contextBefore, contextAfter } = getDocumentContext(view, getIncludeAfterContext())
    void streamAI(view, { mode: 'continue', contextBefore, contextAfter })
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
    streamedText = ''

    const { contextBefore, contextAfter } = getDocumentContext(view, getIncludeAfterContext())
    void streamAI(view, {
      mode: 'prompt',
      contextBefore,
      contextAfter,
      prompt: trimmedPrompt,
    })
  }

  function acceptAI(view: EditorView): void {
    const pluginState = aiWriterPluginKey.getState(view.state)
    if (!pluginState?.active) return

    abortController?.abort()
    abortController = null
    streamedText = ''
    stuckDetector.reset()
    currentView = null
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
    streamedText = ''
    stuckDetector.reset()
    currentView = null
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

  function cancelAI(view?: EditorView): void {
    abortController?.abort()
    abortController = null
    streamedText = ''
    stuckDetector.reset()
    currentView = null
    if (view) {
      setStreamingState(false, view)
    } else {
      setStreamingState(false)
    }
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

function getDocumentContext(
  view: EditorView,
  includeAfter: boolean
): { contextBefore: string; contextAfter?: string } {
  const caretPos = view.state.selection.from
  const docEnd = view.state.doc.content.size

  const contextBefore = view.state.doc.textBetween(0, caretPos, '\n\n', '\n')

  if (!includeAfter || caretPos >= docEnd) {
    return { contextBefore }
  }

  const contextAfter = view.state.doc.textBetween(caretPos, docEnd, '\n\n', '\n')
  return { contextBefore, contextAfter }
}

interface StreamPayload {
  mode: 'continue' | 'prompt'
  contextBefore: string
  contextAfter?: string
  prompt?: string
}

function insertChunk(view: EditorView, generatedText: string): void {
  const pluginState = aiWriterPluginKey.getState(view.state)
  if (
    !pluginState?.active ||
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
  tr.setMeta(aiWriterPluginKey, { type: 'chunk' })
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

async function readErrorMessage(response: Response): Promise<string> {
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

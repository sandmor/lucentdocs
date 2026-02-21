import { EditorView } from 'prosemirror-view'
import { toast } from 'sonner'
import { aiWriterPluginKey, type AIMode } from './ai-writer-plugin'
import { StuckDetector } from './ai-writer-stuck-detector'
import { parseMarkdownishToSlice } from './markdownish'
import { setAIChoices } from './ai-writer-store'

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

  async function streamAIPrompt(view: EditorView, payload: PromptStreamPayload): Promise<void> {
    abortController?.abort()
    const requestAbortController = new AbortController()
    abortController = requestAbortController
    const requestId = ++currentRequestId
    currentView = view
    stuckDetector.reset()
    setStreamingState(true)

    let detectedMode: AIMode | null = null
    let insertIndex: number | null = null
    const choices: string[] = []
    let bufferedContent = ''
    let selectionDeleted = false
    let deletedSlice: import('prosemirror-model').Slice | null = null

    const deleteSelection = () => {
      if (selectionDeleted) return
      const { selectionFrom, selectionTo } = payload
      if (selectionFrom < selectionTo) {
        deletedSlice = view.state.doc.slice(selectionFrom, selectionTo)
        const tr = view.state.tr.delete(selectionFrom, selectionTo)
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
        selectionDeleted = true
      }
    }

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

      const modeHeader = response.headers.get('X-AI-Mode')
      const insertIndexHeader = response.headers.get('X-AI-Insert-Index')

      if (modeHeader && ['replace', 'insert', 'choices'].includes(modeHeader)) {
        detectedMode = modeHeader as AIMode
        if (insertIndexHeader) {
          const parsedInsertIndex = Number.parseInt(insertIndexHeader, 10)
          insertIndex = Number.isFinite(parsedInsertIndex) ? parsedInsertIndex : null
        } else {
          insertIndex = null
        }

        const tr = view.state.tr.setMeta(aiWriterPluginKey, {
          type: 'mode_detected',
          mode: detectedMode,
          insertIndex,
        })
        view.dispatch(tr)

        if (detectedMode === 'replace') {
          deleteSelection()
          const pluginState = aiWriterPluginKey.getState(view.state)
          const pos = pluginState?.originalSelectionFrom ?? payload.selectionFrom
          const zoneTr = view.state.tr.setMeta(aiWriterPluginKey, {
            type: 'zone_start',
            pos,
            deletedSlice,
            deletedFrom: deletedSlice ? pos : null,
          })
          view.dispatch(zoneTr)
        } else if (detectedMode === 'insert') {
          const pluginState = aiWriterPluginKey.getState(view.state)
          const currentFrom = pluginState?.originalSelectionFrom ?? payload.selectionFrom
          const currentTo = pluginState?.originalSelectionTo ?? payload.selectionTo
          const selectionLength = currentTo - currentFrom

          let insertPos: number
          if (insertIndex === null || insertIndex === 0) insertPos = currentFrom
          else if (insertIndex < 0) insertPos = currentTo
          else insertPos = currentFrom + Math.min(insertIndex, selectionLength)

          const zoneTr = view.state.tr.setMeta(aiWriterPluginKey, {
            type: 'zone_start',
            pos: insertPos,
            deletedSlice: null,
            deletedFrom: null,
          })
          view.dispatch(zoneTr)
        }
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (abortController === requestAbortController && !requestAbortController.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        if (value && !requestAbortController.signal.aborted) {
          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue

            try {
              const parsed = JSON.parse(line)
              stuckDetector.onChunk()

              if (detectedMode === 'replace' || detectedMode === 'insert') {
                bufferedContent += parsed
                insertChunk(view, bufferedContent)
              } else if (detectedMode === 'choices') {
                choices.push(parsed)
                setAIChoices(view, [...choices])
              }
            } catch {
              console.warn('Failed to parse AI stream chunk payload from AI endpoint', { line })
            }
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

    const { from, to, empty } = view.state.selection
    const selectedText = empty ? undefined : view.state.doc.textBetween(from, to, '\n\n', '\n')

    const tr = view.state.tr
    tr.setMeta(aiWriterPluginKey, {
      type: 'start',
      pos: from,
      deletedSlice: null,
      selectionFrom: from,
      selectionTo: empty ? from : to,
    })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)
    streamedText = ''

    const { contextBefore, contextAfter } = getDocumentContext(view, getIncludeAfterContext())
    void streamAIPrompt(view, {
      mode: 'prompt',
      contextBefore,
      contextAfter,
      prompt: trimmedPrompt,
      selectedText,
      selectionFrom: from,
      selectionTo: empty ? from : to,
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
    setAIChoices(view, null)

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
    setAIChoices(view, null)

    const { from, to, mode, deletedSlice, deletedFrom } = pluginState

    const tr = view.state.tr

    if (mode === 'replace') {
      if (from !== null && to !== null && from < to) {
        tr.delete(from, to)
      }
      if (deletedSlice && deletedFrom !== null) {
        tr.replace(deletedFrom, deletedFrom, deletedSlice)
      }
    } else if (mode === 'insert') {
      if (from !== null && to !== null && from < to) {
        tr.delete(from, to)
      }
    }

    tr.setMeta(aiWriterPluginKey, { type: 'reject' })
    tr.setMeta('addToHistory', true)
    view.dispatch(tr)
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
      setAIChoices(view, null)
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
  const pos = view.state.selection.from
  const docEnd = view.state.doc.content.size

  const contextBefore = view.state.doc.textBetween(0, pos, '\n\n', '\n')

  if (!includeAfter || pos >= docEnd) {
    return { contextBefore }
  }

  const contextAfter = view.state.doc.textBetween(pos, docEnd, '\n\n', '\n')
  return { contextBefore, contextAfter }
}

interface StreamPayload {
  mode: 'continue' | 'prompt'
  contextBefore: string
  contextAfter?: string
  prompt?: string
  selectedText?: string
}

interface PromptStreamPayload extends StreamPayload {
  mode: 'prompt'
  prompt: string
  selectionFrom: number
  selectionTo: number
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

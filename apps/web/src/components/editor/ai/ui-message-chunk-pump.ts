import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'

interface CreateUIMessageChunkPumpOptions {
  isScopeActive: (scopeId: string) => boolean
  onMessage: (message: UIMessage) => void
  onGeneratingChange?: (generating: boolean) => void
  onError?: (error: unknown) => void
  emitIntervalMs?: number
}

export interface UIMessageChunkPump {
  getGenerationId: () => string | null
  getLatestMessage: () => UIMessage | null
  start: (generationId: string, seedMessage: UIMessage | null, scopeId: string) => void
  enqueue: (chunk: UIMessageChunk) => void
  stop: () => void
}

export function createUIMessageChunkPump(
  options: CreateUIMessageChunkPumpOptions
): UIMessageChunkPump {
  let latestMessage: UIMessage | null = null
  let activeGenerationId: string | null = null
  let activeScopeId: string | null = null
  let streamController: ReadableStreamDefaultController<UIMessageChunk> | null = null
  let pendingMessage: UIMessage | null = null
  let emitTimer: ReturnType<typeof setTimeout> | null = null
  const emitIntervalMs = Math.max(0, Math.round(options.emitIntervalMs ?? 48))

  const clearEmitTimer = () => {
    if (emitTimer !== null) {
      clearTimeout(emitTimer)
      emitTimer = null
    }
  }

  const flushPendingMessage = () => {
    if (!pendingMessage) return
    if (!activeScopeId || !options.isScopeActive(activeScopeId)) {
      pendingMessage = null
      return
    }

    const nextMessage = pendingMessage
    pendingMessage = null
    latestMessage = nextMessage
    options.onGeneratingChange?.(true)
    options.onMessage(nextMessage)
  }

  const scheduleMessageFlush = () => {
    if (emitIntervalMs === 0) {
      flushPendingMessage()
      return
    }
    if (emitTimer !== null) return
    emitTimer = setTimeout(() => {
      emitTimer = null
      flushPendingMessage()
    }, emitIntervalMs)
  }

  const stop = () => {
    clearEmitTimer()
    flushPendingMessage()
    if (streamController) {
      try {
        streamController.close()
      } catch {
        // ignore double-close races
      }
    }
    streamController = null
    pendingMessage = null
    latestMessage = null
    activeGenerationId = null
    activeScopeId = null
  }

  const start = (generationId: string, seedMessage: UIMessage | null, scopeId: string) => {
    stop()
    latestMessage = seedMessage
    activeGenerationId = generationId
    activeScopeId = scopeId

    const chunkStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        streamController = controller
      },
    })

    void (async () => {
      let current = seedMessage
      for await (const nextMessage of readUIMessageStream<UIMessage>({
        message: current ?? undefined,
        stream: chunkStream,
        terminateOnError: false,
        onError: (error) => {
          options.onError?.(error)
        },
      })) {
        if (!options.isScopeActive(scopeId)) {
          continue
        }
        current = nextMessage
        pendingMessage = nextMessage
        scheduleMessageFlush()
      }
      clearEmitTimer()
      flushPendingMessage()
    })().catch((error) => {
      options.onError?.(error)
    })
  }

  return {
    getGenerationId: () => activeGenerationId,
    getLatestMessage: () => latestMessage,
    start,
    enqueue(chunk: UIMessageChunk) {
      try {
        streamController?.enqueue(chunk)
      } catch (error) {
        options.onError?.(error)
      }
    },
    stop,
  }
}

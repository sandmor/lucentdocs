import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'

interface CreateUIMessageChunkPumpOptions {
  isScopeActive: (scopeId: string) => boolean
  onMessage: (message: UIMessage) => void
  onGeneratingChange?: (generating: boolean) => void
  onError?: (error: unknown) => void
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
  let streamController: ReadableStreamDefaultController<UIMessageChunk> | null = null

  const stop = () => {
    if (streamController) {
      try {
        streamController.close()
      } catch {
        // ignore double-close races
      }
    }
    streamController = null
    latestMessage = null
    activeGenerationId = null
  }

  const start = (generationId: string, seedMessage: UIMessage | null, scopeId: string) => {
    stop()
    latestMessage = seedMessage
    activeGenerationId = generationId

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
        latestMessage = nextMessage
        options.onGeneratingChange?.(true)
        options.onMessage(nextMessage)
      }
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

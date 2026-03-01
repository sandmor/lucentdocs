import { useCallback, useRef, type MutableRefObject } from 'react'
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { upsertAssistantMessage } from './message-utils'

interface UseChatStreamPumpOptions {
  isThreadActive: (chatId: string) => boolean
  onAssistantMessage: (updater: (previous: UIMessage[]) => UIMessage[]) => void
  onGeneratingChange: (generating: boolean) => void
}

interface ChatStreamPump {
  streamAssistantRef: MutableRefObject<UIMessage | null>
  streamGenerationIdRef: MutableRefObject<string | null>
  streamChunkControllerRef: MutableRefObject<ReadableStreamDefaultController<UIMessageChunk> | null>
  stopStreamChunkPump: () => void
  startStreamChunkPump: (generationId: string, seedAssistant: UIMessage | null, chatId: string) => void
}

export function useChatStreamPump({
  isThreadActive,
  onAssistantMessage,
  onGeneratingChange,
}: UseChatStreamPumpOptions): ChatStreamPump {
  const streamAssistantRef = useRef<UIMessage | null>(null)
  const streamGenerationIdRef = useRef<string | null>(null)
  const streamChunkControllerRef = useRef<ReadableStreamDefaultController<UIMessageChunk> | null>(null)

  const stopStreamChunkPump = useCallback(() => {
    if (streamChunkControllerRef.current) {
      try {
        streamChunkControllerRef.current.close()
      } catch {
        // ignore double-close races
      }
    }
    streamChunkControllerRef.current = null
    streamAssistantRef.current = null
    streamGenerationIdRef.current = null
  }, [])

  const startStreamChunkPump = useCallback(
    (generationId: string, seedAssistant: UIMessage | null, chatId: string) => {
      stopStreamChunkPump()
      streamAssistantRef.current = seedAssistant
      streamGenerationIdRef.current = generationId

      const chunkStream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          streamChunkControllerRef.current = controller
        },
      })

      void (async () => {
        let latestAssistant = seedAssistant
        for await (const nextMessage of readUIMessageStream<UIMessage>({
          message: latestAssistant ?? undefined,
          stream: chunkStream,
          terminateOnError: false,
          onError: (error) => {
            console.warn('Failed to read chat UI stream chunk', { error })
          },
        })) {
          if (!isThreadActive(chatId)) {
            continue
          }
          latestAssistant = nextMessage
          streamAssistantRef.current = nextMessage
          onGeneratingChange(true)
          onAssistantMessage((previous) => upsertAssistantMessage(previous, nextMessage))
        }
      })().catch((error) => {
        console.warn('Chat stream chunk pump failed', { error })
      })
    },
    [isThreadActive, onAssistantMessage, onGeneratingChange, stopStreamChunkPump]
  )

  return {
    streamAssistantRef,
    streamGenerationIdRef,
    streamChunkControllerRef,
    stopStreamChunkPump,
    startStreamChunkPump,
  }
}

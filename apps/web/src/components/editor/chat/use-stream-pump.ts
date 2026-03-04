import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { UIMessage, UIMessageChunk } from 'ai'
import { cloneUIMessage, upsertAssistantMessage } from './message-utils'
import { createUIMessageChunkPump, type UIMessageChunkPump } from '../ai/ui-message-chunk-pump'

interface UseChatStreamPumpOptions {
  isThreadActive: (chatId: string) => boolean
  onAssistantMessage: (updater: (previous: UIMessage[]) => UIMessage[]) => void
  onGeneratingChange: (generating: boolean) => void
}

interface ChatStreamPump {
  streamAssistantRef: MutableRefObject<UIMessage | null>
  streamGenerationIdRef: MutableRefObject<string | null>
  enqueueStreamChunk: (chunk: UIMessageChunk) => void
  stopStreamChunkPump: () => void
  startStreamChunkPump: (
    generationId: string,
    seedAssistant: UIMessage | null,
    chatId: string
  ) => void
}

export function useChatStreamPump({
  isThreadActive,
  onAssistantMessage,
  onGeneratingChange,
}: UseChatStreamPumpOptions): ChatStreamPump {
  const streamAssistantRef = useRef<UIMessage | null>(null)
  const streamGenerationIdRef = useRef<string | null>(null)
  const pumpRef = useRef<UIMessageChunkPump | null>(null)
  const isThreadActiveRef = useRef(isThreadActive)
  const onAssistantMessageRef = useRef(onAssistantMessage)
  const onGeneratingChangeRef = useRef(onGeneratingChange)

  useEffect(() => {
    isThreadActiveRef.current = isThreadActive
  }, [isThreadActive])

  useEffect(() => {
    onAssistantMessageRef.current = onAssistantMessage
  }, [onAssistantMessage])

  useEffect(() => {
    onGeneratingChangeRef.current = onGeneratingChange
  }, [onGeneratingChange])

  useEffect(() => {
    const pump = createUIMessageChunkPump({
      // Keep chat responsive while reducing render pressure during fast token streams.
      emitIntervalMs: 32,
      isScopeActive: (chatId) => isThreadActiveRef.current(chatId),
      onMessage: (nextMessage) => {
        const generationId = streamGenerationIdRef.current
        const nextMessageClone = cloneUIMessage(nextMessage)
        if (generationId) {
          nextMessageClone.id = `assistant-${generationId}`
        }
        streamAssistantRef.current = nextMessageClone
        onAssistantMessageRef.current((previous) =>
          upsertAssistantMessage(previous, nextMessageClone)
        )
      },
      onGeneratingChange: (generating) => onGeneratingChangeRef.current(generating),
      onError: (error) => {
        console.warn('Chat stream chunk pump failed', { error })
      },
    })

    pumpRef.current = pump
    return () => {
      pump.stop()
      if (pumpRef.current === pump) {
        pumpRef.current = null
      }
    }
  }, [])

  const stopStreamChunkPump = useCallback(() => {
    pumpRef.current?.stop()
    streamAssistantRef.current = null
    streamGenerationIdRef.current = null
  }, [])

  const startStreamChunkPump = useCallback(
    (generationId: string, seedAssistant: UIMessage | null, chatId: string) => {
      stopStreamChunkPump()
      streamAssistantRef.current = seedAssistant
      streamGenerationIdRef.current = generationId
      pumpRef.current?.start(generationId, seedAssistant, chatId)
    },
    [stopStreamChunkPump]
  )

  return {
    streamAssistantRef,
    streamGenerationIdRef,
    enqueueStreamChunk: (chunk) => pumpRef.current?.enqueue(chunk),
    stopStreamChunkPump,
    startStreamChunkPump,
  }
}

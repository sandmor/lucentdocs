import { useEffect, useRef } from 'react'
import type { UIMessageChunk } from 'ai'
import { getTrpcProxyClient } from '@/lib/trpc'
import { useEditorStore } from '@/lib/editor-store'
import type { AIBubblePresenceStore } from '../collaboration/ai-bubble-presence'
import { createUIMessageChunkPump } from '../ai/ui-message-chunk-pump'
import {
  settleInlineGenerationWait,
  settleInlineGenerationWaitsForSession,
} from './inline-generation-wait'
import { emitInlineStreamActivity } from './inline-stream-activity'
import { getAssistantSeedMessage, previewFromUIMessage } from './inline-message-preview'
import {
  effectsFromInlineSnapshot,
  shouldStartChunkPumpForGeneration,
} from './inline-session-observer-state'

interface UseInlineSessionObserverOptions {
  projectId?: string
  documentId: string
  sessionIds: readonly string[]
  resolveZoneIdForSession: (sessionId: string) => string | null
  getBubblePresence?: () => AIBubblePresenceStore | null
}

type SessionSubscription = {
  unsubscribe: () => void
  lastSeq: number
  chunkPump: ReturnType<typeof createUIMessageChunkPump>
  activeGenerationId: string | null
}

function settleGenerationFromEffects(
  sessionId: string,
  settleGeneration: { generationId: string; error?: string } | undefined,
  fallbackError?: string | null
): void {
  if (settleGeneration) {
    settleInlineGenerationWait(sessionId, settleGeneration.generationId, {
      error: settleGeneration.error,
    })
    return
  }

  settleInlineGenerationWaitsForSession(sessionId, {
    error: fallbackError ?? undefined,
  })
}

function failInlineSessionSubscription(
  sessionId: string,
  subscription: SessionSubscription,
  error: unknown
): void {
  subscription.chunkPump.stop()
  subscription.activeGenerationId = null

  const message = error instanceof Error ? error.message : 'Inline stream subscription failed'
  settleInlineGenerationWaitsForSession(sessionId, { error: message })

  const store = useEditorStore.getState()
  store.setSessionPreviewById(sessionId, null)
  store.setSessionStreamMetaById(sessionId, null)
}

export function useInlineSessionObserver({
  projectId,
  documentId,
  sessionIds,
  resolveZoneIdForSession,
  getBubblePresence,
}: UseInlineSessionObserverOptions): void {
  const sessionIdsKey = sessionIds.join('\u0000')
  const subscriptionsRef = useRef<Map<string, SessionSubscription>>(new Map())
  const resolveZoneIdForSessionRef = useRef(resolveZoneIdForSession)
  const getBubblePresenceRef = useRef(getBubblePresence)

  useEffect(() => {
    resolveZoneIdForSessionRef.current = resolveZoneIdForSession
    getBubblePresenceRef.current = getBubblePresence
  }, [getBubblePresence, resolveZoneIdForSession])

  useEffect(() => {
    const subscriptions = subscriptionsRef.current

    if (!projectId || !documentId) {
      for (const subscription of subscriptions.values()) {
        subscription.chunkPump.stop()
        subscription.unsubscribe()
      }
      subscriptions.clear()
      return
    }

    const trpcClient = getTrpcProxyClient()
    const requestedIds = new Set(sessionIds)

    for (const sessionId of requestedIds) {
      if (subscriptions.has(sessionId)) continue

      const chunkPump = createUIMessageChunkPump({
        emitIntervalMs: 48,
        isScopeActive: (scopeId) => scopeId === sessionId,
        onMessage: (message) => {
          const generationId = chunkPump.getGenerationId()
          if (!generationId) return
          useEditorStore
            .getState()
            .setSessionPreviewById(sessionId, previewFromUIMessage(generationId, message))
        },
        onError: (error) => {
          console.warn('Inline session preview chunk pump failed', { sessionId, error })
        },
      })

      const subscription = trpcClient.inline.observeSession.subscribe(
        { projectId, documentId, sessionId },
        {
          onData: (event) => {
            const current = subscriptions.get(sessionId)
            if (!current) return
            if (event.seq <= current.lastSeq) return

            if (current.lastSeq > 0 && event.seq > current.lastSeq + 1) {
              console.warn('Inline stream sequence gap detected', {
                previousSeq: current.lastSeq,
                nextSeq: event.seq,
                sessionId,
              })
            }
            current.lastSeq = event.seq
            emitInlineStreamActivity(sessionId)

            if (event.type === 'stream-chunk') {
              if (
                shouldStartChunkPumpForGeneration(
                  current.activeGenerationId,
                  chunkPump.getGenerationId(),
                  event.generationId
                )
              ) {
                current.activeGenerationId = event.generationId
                const seed = getAssistantSeedMessage(
                  useEditorStore.getState().inlineSessionsById[sessionId] ?? null
                )
                chunkPump.start(event.generationId, seed, sessionId)
              }

              chunkPump.enqueue(event.chunk as UIMessageChunk)
              return
            }

            if (!current.activeGenerationId && event.generating && event.generationId) {
              current.activeGenerationId = event.generationId
            }

            const effects = effectsFromInlineSnapshot({
              type: 'snapshot',
              sessionId: event.sessionId,
              seq: event.seq,
              session: event.session ?? null,
              generating: event.generating,
              generationId: event.generationId ?? null,
              draftText: event.draftText,
              error: event.error,
            })

            const store = useEditorStore.getState()
            store.setSessionById(sessionId, effects.session)
            store.setSessionStreamMetaById(sessionId, effects.streamMeta)

            if (effects.clearPreview) {
              chunkPump.stop()
              settleGenerationFromEffects(sessionId, effects.settleGeneration, event.error)
              current.activeGenerationId = null
              store.setSessionPreviewById(sessionId, null)
            }

            if (event.generating && event.generationId) {
              const zoneId = resolveZoneIdForSessionRef.current(sessionId)
              const bubblePresence = getBubblePresenceRef.current?.() ?? null
              const draftText = event.draftText?.trim() ?? ''
              // Keep the last non-empty overlay while generating. Snapshots with a null
              // draftText would otherwise hide the overlay and flash the stale zone body.
              if (zoneId && bubblePresence && draftText.length > 0) {
                bubblePresence.publish({
                  sessionId,
                  zoneId,
                  generationId: event.generationId,
                  seq: event.seq,
                  text: draftText,
                  updatedAt: Date.now(),
                })
              }
            } else {
              const bubblePresence = getBubblePresenceRef.current?.() ?? null
              if (bubblePresence) {
                // Defer clearing the overlay so Yjs can apply the committed zone first.
                void Promise.resolve()
                  .then(() => Promise.resolve())
                  .then(() => {
                    bubblePresence.clear(sessionId)
                  })
              }
            }
          },
          onError: (error) => {
            console.warn('Inline session observe subscription failed', { sessionId, error })
            const current = subscriptions.get(sessionId)
            if (!current) return
            failInlineSessionSubscription(sessionId, current, error)
          },
        }
      )

      subscriptions.set(sessionId, {
        unsubscribe: subscription.unsubscribe,
        lastSeq: 0,
        chunkPump,
        activeGenerationId: null,
      })
    }

    for (const [sessionId, subscription] of [...subscriptions.entries()]) {
      if (requestedIds.has(sessionId)) continue
      subscription.chunkPump.stop()
      subscription.unsubscribe()
      subscriptions.delete(sessionId)
      useEditorStore.getState().setSessionPreviewById(sessionId, null)
      useEditorStore.getState().setSessionStreamMetaById(sessionId, null)
    }

    return () => {
      for (const subscription of subscriptions.values()) {
        subscription.chunkPump.stop()
        subscription.unsubscribe()
      }
      subscriptions.clear()
    }
  }, [documentId, projectId, sessionIdsKey])
}

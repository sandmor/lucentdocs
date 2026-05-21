import { useEffect, useMemo } from 'react'
import type { AIWriterState } from '../ai/writer-plugin'
import { getTrpcProxyClient, trpc } from '@/lib/trpc'
import { useEditorStore } from '@/lib/editor-store'

interface UseInlineSessionsOptions {
  projectId?: string
  documentId: string
  aiState: AIWriterState | null
}

export function useInlineSessions({
  projectId,
  documentId,
  aiState,
}: UseInlineSessionsOptions): void {
  const inlineSessionIdsRaw = useMemo(() => {
    if (!aiState) return []

    const sessionIds = new Set<string>()
    for (const zone of aiState.zones) {
      if (!zone.sessionId) continue
      sessionIds.add(zone.sessionId)
    }
    return [...sessionIds].sort((left, right) => left.localeCompare(right))
  }, [aiState])

  const inlineSessionIdsStr = JSON.stringify(inlineSessionIdsRaw)
  const inlineSessionIds = useMemo(() => JSON.parse(inlineSessionIdsStr), [inlineSessionIdsStr])

  const streamingSessionIdsRaw = useMemo(() => {
    if (!aiState) return []
    const sessionIds = new Set<string>()
    for (const zone of aiState.zones) {
      if (!zone.streaming || !zone.sessionId) continue
      sessionIds.add(zone.sessionId)
    }
    return [...sessionIds].sort((left, right) => left.localeCompare(right))
  }, [aiState])

  const streamingSessionIdsStr = JSON.stringify(streamingSessionIdsRaw)
  const streamingSessionIds = useMemo(
    () => JSON.parse(streamingSessionIdsStr),
    [streamingSessionIdsStr]
  )

  const inlineSessionsQuery = trpc.inline.getSessions.useQuery(
    {
      projectId: projectId ?? '',
      documentId,
      sessionIds: inlineSessionIds,
    },
    {
      enabled: Boolean(projectId && documentId && inlineSessionIds.length > 0),
      refetchOnWindowFocus: false,
    }
  )

  useEffect(() => {
    if (!inlineSessionsQuery.data) return
    const sessions = inlineSessionsQuery.data.sessions
    useEditorStore.getState().setSessions((previous) => ({
      ...previous,
      ...sessions,
    }))
  }, [inlineSessionsQuery.data])

  useEffect(() => {
    const subscriptions = new Map<
      string,
      {
        unsubscribe: () => void
        lastSeq: number
      }
    >()

    if (!projectId || !documentId || streamingSessionIds.length === 0) {
      return () => {
        for (const subscription of subscriptions.values()) {
          subscription.unsubscribe()
        }
      }
    }

    const trpcClient = getTrpcProxyClient()
    for (const sessionId of streamingSessionIds) {
      const subscription = trpcClient.inline.observeSession.subscribe(
        {
          projectId,
          documentId,
          sessionId,
        },
        {
          onData: (event) => {
            const current = subscriptions.get(sessionId)
            if (!current) return
            if (event.seq <= current.lastSeq) return
            current.lastSeq = event.seq
            if (event.type !== 'snapshot') return

            useEditorStore.getState().setSessionById(sessionId, event.session)

            if (!event.generating) {
              current.unsubscribe()
              subscriptions.delete(sessionId)
            }
          },
          onError: () => {},
        }
      )

      subscriptions.set(sessionId, { unsubscribe: subscription.unsubscribe, lastSeq: 0 })
    }

    return () => {
      for (const subscription of subscriptions.values()) {
        subscription.unsubscribe()
      }
      subscriptions.clear()
    }
  }, [documentId, projectId, streamingSessionIds])
}

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { InlineZoneSession } from '@plotline/shared'
import type { AIWriterState } from '../ai/writer-plugin'
import { getTrpcProxyClient, trpc } from '@/lib/trpc'

interface UseInlineSessionsOptions {
  projectId?: string
  documentId: string
  aiState: AIWriterState | null
}

interface UseInlineSessionsResult {
  inlineSessionsById: Record<string, InlineZoneSession>
  inlineSessionsRef: MutableRefObject<Record<string, InlineZoneSession>>
  setInlineSessionsById: Dispatch<SetStateAction<Record<string, InlineZoneSession>>>
}

export function useInlineSessions({
  projectId,
  documentId,
  aiState,
}: UseInlineSessionsOptions): UseInlineSessionsResult {
  const [inlineSessionsById, setInlineSessionsById] = useState<Record<string, InlineZoneSession>>(
    {}
  )
  const inlineSessionsRef = useRef<Record<string, InlineZoneSession>>({})

  const inlineSessionIds = useMemo(() => {
    if (!aiState) return []

    const sessionIds = new Set<string>()
    for (const zone of aiState.zones) {
      if (!zone.sessionId) continue
      sessionIds.add(zone.sessionId)
    }
    return [...sessionIds].sort((left, right) => left.localeCompare(right))
  }, [aiState])

  const streamingSessionIds = useMemo(() => {
    if (!aiState) return []
    const sessionIds = new Set<string>()
    for (const zone of aiState.zones) {
      if (!zone.streaming || !zone.sessionId) continue
      sessionIds.add(zone.sessionId)
    }
    return [...sessionIds].sort((left, right) => left.localeCompare(right))
  }, [aiState])

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
    setInlineSessionsById((previous) => {
      const next = {
        ...previous,
        ...inlineSessionsQuery.data.sessions,
      }
      inlineSessionsRef.current = next
      return next
    })
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

            setInlineSessionsById((previous) => {
              if (event.session === null) {
                if (previous[sessionId] === undefined) return previous
                const next = { ...previous }
                delete next[sessionId]
                inlineSessionsRef.current = next
                return next
              }

              const previousSession = previous[sessionId]
              if (previousSession === event.session) return previous
              const next = {
                ...previous,
                [sessionId]: event.session,
              }
              inlineSessionsRef.current = next
              return next
            })

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
  }, [documentId, projectId, setInlineSessionsById, streamingSessionIds])

  return {
    inlineSessionsById,
    inlineSessionsRef,
    setInlineSessionsById,
  }
}

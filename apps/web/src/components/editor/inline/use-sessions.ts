import { useEffect, useMemo } from 'react'
import type { AIWriterState } from '../ai/writer-plugin'
import { trpc } from '@/lib/trpc'
import { useEditorStore } from '@/lib/editor-store'
import { resolveHydratedInlineSessionIds } from './resolve-observed-inline-session-ids'

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
  const inlineSessionIdsRaw = useMemo(() => resolveHydratedInlineSessionIds(aiState), [aiState])

  const inlineSessionIdsStr = JSON.stringify(inlineSessionIdsRaw)
  const inlineSessionIds = useMemo(() => JSON.parse(inlineSessionIdsStr), [inlineSessionIdsStr])

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
}

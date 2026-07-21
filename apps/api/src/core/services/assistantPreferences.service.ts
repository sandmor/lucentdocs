import {
  DEFAULT_ASSISTANT_PREFERENCES,
  type AssistantPreferenceOverrides,
  type AssistantPreferences,
} from '@lucentdocs/shared'
import type { AssistantPreferenceScope } from '../ports/assistantPreferences.port.js'
import type { RepositorySet } from '../ports/types.js'

export function createAssistantPreferencesService(repos: RepositorySet) {
  const read = async (scopeType: AssistantPreferenceScope, scopeId: string): Promise<AssistantPreferenceOverrides> =>
    (await repos.assistantPreferences.get(scopeType, scopeId))?.overrides ?? {}

  const snapshot = async (userId: string, projectId?: string | null) => {
    const global = await read('global', 'global')
    const user = await read('user', userId)
    const project = projectId ? await read('project', projectId) : {}
    const resolved: AssistantPreferences = { ...DEFAULT_ASSISTANT_PREFERENCES, ...global, ...user, ...project }
    return { global, user, project, resolved }
  }

  const update = async (scopeType: AssistantPreferenceScope, scopeId: string, overrides: AssistantPreferenceOverrides) => {
    await repos.assistantPreferences.upsert({ scopeType, scopeId, overrides, updatedAt: Date.now() })
  }

  return { snapshot, update }
}

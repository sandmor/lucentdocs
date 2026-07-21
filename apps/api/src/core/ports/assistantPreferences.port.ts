import type { AssistantPreferenceOverrides } from '@lucentdocs/shared'

export type AssistantPreferenceScope = 'global' | 'user' | 'project'

export interface AssistantPreferenceSetting {
  scopeType: AssistantPreferenceScope
  scopeId: string
  overrides: AssistantPreferenceOverrides
  updatedAt: number
}

export interface AssistantPreferencesRepositoryPort {
  get(scopeType: AssistantPreferenceScope, scopeId: string): Promise<AssistantPreferenceSetting | undefined>
  upsert(setting: AssistantPreferenceSetting): Promise<void>
}

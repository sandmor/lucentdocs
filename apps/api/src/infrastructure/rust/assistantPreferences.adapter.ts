import type { NativeStorageEngine } from '@lucentdocs/core'
import { assistantPreferenceOverridesSchema } from '@lucentdocs/shared'
import type { AssistantPreferenceScope, AssistantPreferencesRepositoryPort, AssistantPreferenceSetting } from '../../core/ports/assistantPreferences.port.js'
import { currentTxId } from './tx-scope.js'

export class AssistantPreferencesRepository implements AssistantPreferencesRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async get(scopeType: AssistantPreferenceScope, scopeId: string): Promise<AssistantPreferenceSetting | undefined> {
    const row = await this.engine.assistantGetPreference(currentTxId(), scopeType, scopeId)
    if (!row) return undefined
    const parsed = assistantPreferenceOverridesSchema.safeParse(JSON.parse(row.overridesJson))
    if (!parsed.success) return undefined
    return { scopeType, scopeId, overrides: parsed.data, updatedAt: row.updatedAt }
  }

  async upsert(setting: AssistantPreferenceSetting): Promise<void> {
    await this.engine.assistantUpsertPreference(currentTxId(), {
      scopeType: setting.scopeType,
      scopeId: setting.scopeId,
      overridesJson: JSON.stringify(setting.overrides),
      updatedAt: setting.updatedAt,
    })
  }
}

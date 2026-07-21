import {
  DEFAULT_EDITOR_PREFERENCES,
  editorPreferenceOverridesSchema,
  type EditorPreferenceOverrides,
  type EditorPreferences,
} from '@lucentdocs/shared'
import type { RepositorySet } from '../ports/types.js'

type ScopeType = 'global' | 'user' | 'project' | 'document'
const keyFor = (scope: ScopeType, id: string) => `editor-preferences:${scope}:${id}`

function read(repos: RepositorySet, scope: ScopeType, id: string): EditorPreferenceOverrides {
  const value = repos.appConfig
    .readEntries()
    .find((entry) => entry.key === keyFor(scope, id))?.value
  if (!value) return {}
  try {
    const parsed = editorPreferenceOverridesSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function merge(...entries: EditorPreferenceOverrides[]): EditorPreferences {
  return Object.assign({}, DEFAULT_EDITOR_PREFERENCES, ...entries)
}

export function createEditorPreferencesService(repos: RepositorySet) {
  const snapshot = (userId: string, projectId?: string | null, documentId?: string | null) => {
    const global = read(repos, 'global', 'global')
    const user = read(repos, 'user', userId)
    const project = projectId ? read(repos, 'project', projectId) : {}
    const document = documentId ? read(repos, 'document', documentId) : {}
    return { global, user, project, document, resolved: merge(global, user, project, document) }
  }
  const update = (scope: ScopeType, id: string, overrides: EditorPreferenceOverrides) => {
    repos.appConfig.upsertEntries(
      [{ key: keyFor(scope, id), value: JSON.stringify(overrides) }],
      Date.now()
    )
  }
  return { snapshot, update }
}

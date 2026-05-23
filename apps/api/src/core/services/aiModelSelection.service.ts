import {
  isValidId,
  type AiModelSelectionScopeType,
  type ResolvedAiModelSelection,
} from '@lucentdocs/shared'
import type { RepositorySet } from '../ports/types.js'

const GLOBAL_SCOPE_ID = 'global'

export interface AiModelSelectionScopeSetting {
  scopeType: AiModelSelectionScopeType
  scopeId: string
  providerConfigId: string | null
  updatedAt: number | null
}

export interface AiModelSelectionSnapshot {
  global: AiModelSelectionScopeSetting & { providerConfigId: string }
  user: AiModelSelectionScopeSetting | null
  project: AiModelSelectionScopeSetting | null
  document: AiModelSelectionScopeSetting | null
  ownerUserId: string | null
  resolved: ResolvedAiModelSelection
}

export interface AiModelSelectionService {
  getGlobal(): Promise<AiModelSelectionScopeSetting & { providerConfigId: string }>
  updateGlobal(providerConfigId: string): Promise<AiModelSelectionSnapshot>
  getUserSnapshot(userId: string): Promise<AiModelSelectionSnapshot>
  updateUserStrategy(
    userId: string,
    providerConfigId: string | null
  ): Promise<AiModelSelectionSnapshot>
  getProjectSnapshot(projectId: string): Promise<AiModelSelectionSnapshot | null>
  updateProjectStrategy(
    projectId: string,
    providerConfigId: string | null
  ): Promise<AiModelSelectionSnapshot | null>
  getDocumentSnapshot(
    documentId: string,
    projectId?: string | null
  ): Promise<AiModelSelectionSnapshot | null>
  updateDocumentStrategy(
    documentId: string,
    providerConfigId: string | null,
    projectId?: string | null
  ): Promise<AiModelSelectionSnapshot | null>
  getAvailableGenerationProviders(): Promise<
    Array<{ id: string; name: string | null; providerId: string; model: string }>
  >
  resolveForProject(projectId: string): Promise<ResolvedAiModelSelection | null>
  resolveForDocument(
    documentId: string,
    projectId?: string | null
  ): Promise<ResolvedAiModelSelection | null>
}

function toScopeSetting(
  scopeType: AiModelSelectionScopeType,
  scopeId: string,
  value: { providerConfigId: string; updatedAt: number } | null,
  availableIds?: Set<string>
): AiModelSelectionScopeSetting {
  const providerConfigId =
    value && (!availableIds || availableIds.has(value.providerConfigId))
      ? value.providerConfigId
      : null
  return {
    scopeType,
    scopeId,
    providerConfigId,
    updatedAt: value?.updatedAt ?? null,
  }
}

export function createAiModelSelectionService(repos: RepositorySet): AiModelSelectionService {
  const listAvailableProviders = async () => repos.aiSettings.listProviderConfigs('generation')

  const getAvailableProviderIds = async (): Promise<Set<string>> =>
    new Set((await listAvailableProviders()).map((provider) => provider.id))

  const assertProviderConfigExists = async (providerConfigId: string): Promise<void> => {
    const availableIds = await getAvailableProviderIds()
    if (!availableIds.has(providerConfigId)) {
      throw new Error(`Generation provider config ${providerConfigId} was not found.`)
    }
  }

  const getGlobal = async (): Promise<
    AiModelSelectionScopeSetting & { providerConfigId: string }
  > => {
    const existing = await repos.aiModelSelection.get('global', GLOBAL_SCOPE_ID)
    const availableProviders = await listAvailableProviders()
    const availableIds = new Set(availableProviders.map((provider) => provider.id))

    if (existing && availableIds.has(existing.providerConfigId)) {
      return {
        scopeType: 'global',
        scopeId: GLOBAL_SCOPE_ID,
        providerConfigId: existing.providerConfigId,
        updatedAt: existing.updatedAt,
      }
    }

    const fallbackProviderId = availableProviders[0]?.id ?? null

    if (!fallbackProviderId) {
      throw new Error('No global AI model selection is configured.')
    }

    const created = await repos.aiModelSelection.upsert({
      scopeType: 'global',
      scopeId: GLOBAL_SCOPE_ID,
      providerConfigId: fallbackProviderId,
      updatedAt: Date.now(),
    })

    return {
      scopeType: 'global',
      scopeId: GLOBAL_SCOPE_ID,
      providerConfigId: created.providerConfigId,
      updatedAt: created.updatedAt,
    }
  }

  const resolveSelectionChain = (
    chain: Array<AiModelSelectionScopeSetting & { providerConfigId: string | null }>,
    availableIds: Set<string>
  ): ResolvedAiModelSelection => {
    const resolved = chain.find(
      (entry) => entry.providerConfigId !== null && availableIds.has(entry.providerConfigId)
    )

    if (!resolved || resolved.providerConfigId === null) {
      throw new Error('No valid AI model selection is configured.')
    }

    return {
      scopeType: resolved.scopeType,
      scopeId: resolved.scopeId,
      providerConfigId: resolved.providerConfigId,
    }
  }

  const buildSnapshot = async (options: {
    userId?: string | null
    projectId?: string | null
    documentId?: string | null
  }): Promise<AiModelSelectionSnapshot | null> => {
    const global = await getGlobal()
    const availableIds = await getAvailableProviderIds()
    const documentId =
      options.documentId && isValidId(options.documentId) ? options.documentId : null
    const documentSetting = documentId
      ? await repos.aiModelSelection.get('document', documentId)
      : undefined

    const requestedProjectId = options.projectId ?? null
    const soleProjectId = documentId
      ? ((await repos.projectDocuments.findSoleProjectIdByDocumentId(documentId)) ?? null)
      : null

    let projectId = requestedProjectId
    if (documentId && projectId) {
      const isAssociated = (
        await repos.projectDocuments.findAssociatedDocumentIds(projectId, [documentId])
      ).has(documentId)
      if (!isAssociated) {
        return null
      }
    }
    if (documentId && !projectId) {
      projectId = soleProjectId
    }
    if (projectId && !isValidId(projectId)) {
      projectId = null
    }

    let ownerUserId = options.userId ?? null
    const projectSetting = projectId
      ? await repos.aiModelSelection.get('project', projectId)
      : undefined

    if (projectId) {
      const project = await repos.projects.findById(projectId)
      if (!project) {
        return null
      }
      ownerUserId = ownerUserId ?? project.ownerUserId
    }

    const userSetting =
      ownerUserId && isValidId(ownerUserId)
        ? await repos.aiModelSelection.get('user', ownerUserId)
        : undefined

    const resolved = resolveSelectionChain(
      [
        documentId ? toScopeSetting('document', documentId, documentSetting ?? null) : null,
        projectId ? toScopeSetting('project', projectId, projectSetting ?? null) : null,
        ownerUserId ? toScopeSetting('user', ownerUserId, userSetting ?? null) : null,
        global,
      ].filter(
        (setting): setting is AiModelSelectionScopeSetting & { providerConfigId: string | null } =>
          setting !== null
      ),
      availableIds
    )

    return {
      global,
      user: ownerUserId
        ? toScopeSetting('user', ownerUserId, userSetting ?? null, availableIds)
        : null,
      project: projectId
        ? toScopeSetting('project', projectId, projectSetting ?? null, availableIds)
        : null,
      document: documentId
        ? toScopeSetting('document', documentId, documentSetting ?? null, availableIds)
        : null,
      ownerUserId,
      resolved,
    }
  }

  const updateScopeSelection = async (
    scopeType: Exclude<AiModelSelectionScopeType, 'global'>,
    scopeId: string,
    providerConfigId: string | null
  ): Promise<void> => {
    if (providerConfigId === null) {
      await repos.aiModelSelection.delete(scopeType, scopeId)
      return
    }

    await assertProviderConfigExists(providerConfigId)
    await repos.aiModelSelection.upsert({
      scopeType,
      scopeId,
      providerConfigId,
      updatedAt: Date.now(),
    })
  }

  return {
    getGlobal,

    async updateGlobal(providerConfigId: string): Promise<AiModelSelectionSnapshot> {
      await assertProviderConfigExists(providerConfigId)
      await repos.aiModelSelection.upsert({
        scopeType: 'global',
        scopeId: GLOBAL_SCOPE_ID,
        providerConfigId,
        updatedAt: Date.now(),
      })

      const snapshot = await buildSnapshot({})
      if (!snapshot) {
        throw new Error('Failed to resolve global AI model selection settings.')
      }
      return snapshot
    },

    async getAvailableGenerationProviders() {
      const providers = await listAvailableProviders()
      return providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        providerId: provider.providerId,
        model: provider.model,
      }))
    },

    async getUserSnapshot(userId: string): Promise<AiModelSelectionSnapshot> {
      const snapshot = await buildSnapshot({ userId })
      if (!snapshot) {
        throw new Error('Failed to resolve user AI model selection settings.')
      }
      return snapshot
    },

    async updateUserStrategy(
      userId: string,
      providerConfigId: string | null
    ): Promise<AiModelSelectionSnapshot> {
      await updateScopeSelection('user', userId, providerConfigId)
      const snapshot = await buildSnapshot({ userId })
      if (!snapshot) {
        throw new Error('Failed to resolve user AI model selection settings.')
      }
      return snapshot
    },

    async getProjectSnapshot(projectId: string): Promise<AiModelSelectionSnapshot | null> {
      if (!isValidId(projectId)) return null
      return buildSnapshot({ projectId })
    },

    async updateProjectStrategy(
      projectId: string,
      providerConfigId: string | null
    ): Promise<AiModelSelectionSnapshot | null> {
      if (!isValidId(projectId)) return null
      const project = await repos.projects.findById(projectId)
      if (!project) return null

      await updateScopeSelection('project', projectId, providerConfigId)
      return buildSnapshot({ projectId })
    },

    async getDocumentSnapshot(
      documentId: string,
      projectId?: string | null
    ): Promise<AiModelSelectionSnapshot | null> {
      if (!isValidId(documentId)) return null
      const document = await repos.documents.findById(documentId)
      if (!document) return null
      return buildSnapshot({ documentId, projectId })
    },

    async updateDocumentStrategy(
      documentId: string,
      providerConfigId: string | null,
      projectId?: string | null
    ): Promise<AiModelSelectionSnapshot | null> {
      if (!isValidId(documentId)) return null
      const document = await repos.documents.findById(documentId)
      if (!document) return null

      await updateScopeSelection('document', documentId, providerConfigId)
      return buildSnapshot({ documentId, projectId })
    },

    async resolveForProject(projectId: string): Promise<ResolvedAiModelSelection | null> {
      const snapshot = await buildSnapshot({ projectId })
      return snapshot?.resolved ?? null
    },

    async resolveForDocument(
      documentId: string,
      projectId?: string | null
    ): Promise<ResolvedAiModelSelection | null> {
      const snapshot = await buildSnapshot({ documentId, projectId })
      return snapshot?.resolved ?? null
    },
  }
}

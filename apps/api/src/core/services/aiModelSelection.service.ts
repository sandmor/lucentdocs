import {
  isValidId,
  type AiModelSelectionScopeType,
  type AiProviderSelectionUsage,
  type ResolvedAiModelSelection,
} from '@lucentdocs/shared'
import type { AiProviderUsage } from '../ai/provider-usage.js'
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

export interface AiProviderSelectionService {
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
  getAvailableProviders(): Promise<
    Array<{ id: string; name: string | null; providerId: string; model: string }>
  >
  resolveForProject(projectId: string): Promise<ResolvedAiModelSelection | null>
  resolveForDocument(
    documentId: string,
    projectId?: string | null
  ): Promise<ResolvedAiModelSelection | null>
  resolveForDocuments(documentIds: string[]): Promise<Map<string, ResolvedAiModelSelection | null>>
  resolveForProjectDocuments(
    projectId: string,
    documentIds: string[]
  ): Promise<Map<string, ResolvedAiModelSelection | null>>
}

export interface AiModelSelectionService extends AiProviderSelectionService {
  getAvailableGenerationProviders(): Promise<
    Array<{ id: string; name: string | null; providerId: string; model: string }>
  >
}

type SharedDocumentResolutionPolicy = 'projectContextual' | 'documentOwnedWhenShared'

interface AiProviderSelectionServiceOptions {
  sharedDocumentPolicy?: SharedDocumentResolutionPolicy
}

function usageLabel(usage: AiProviderUsage): string {
  return usage === 'generation' ? 'generation' : 'embedding'
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

export function createAiProviderSelectionService(
  repos: RepositorySet,
  usage: AiProviderSelectionUsage,
  options: AiProviderSelectionServiceOptions = {}
): AiProviderSelectionService {
  const sharedDocumentPolicy = options.sharedDocumentPolicy ?? 'projectContextual'
  const listAvailableProviders = async () => repos.aiSettings.listProviderConfigs(usage)

  const getAvailableProviderIds = async (): Promise<Set<string>> =>
    new Set((await listAvailableProviders()).map((provider) => provider.id))

  const assertProviderConfigExists = async (providerConfigId: string): Promise<void> => {
    const availableIds = await getAvailableProviderIds()
    if (!availableIds.has(providerConfigId)) {
      throw new Error(`${usageLabel(usage)} provider config ${providerConfigId} was not found.`)
    }
  }

  const getGlobal = async (): Promise<
    AiModelSelectionScopeSetting & { providerConfigId: string }
  > => {
    const existing = await repos.aiModelSelection.get(usage, 'global', GLOBAL_SCOPE_ID)
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
      throw new Error(`No global ${usageLabel(usage)} model selection is configured.`)
    }

    const created = await repos.aiModelSelection.upsert({
      usage,
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
      throw new Error(`No valid ${usageLabel(usage)} model selection is configured.`)
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
      ? await repos.aiModelSelection.get(usage, 'document', documentId)
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
    if (
      documentId &&
      projectId &&
      sharedDocumentPolicy === 'documentOwnedWhenShared' &&
      soleProjectId !== projectId
    ) {
      projectId = null
    }
    if (projectId && !isValidId(projectId)) {
      projectId = null
    }

    let ownerUserId = options.userId ?? null
    const projectSetting = projectId
      ? await repos.aiModelSelection.get(usage, 'project', projectId)
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
        ? await repos.aiModelSelection.get(usage, 'user', ownerUserId)
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
      await repos.aiModelSelection.delete(usage, scopeType, scopeId)
      return
    }

    await assertProviderConfigExists(providerConfigId)
    await repos.aiModelSelection.upsert({
      usage,
      scopeType,
      scopeId,
      providerConfigId,
      updatedAt: Date.now(),
    })
  }

  const resolveForDocuments = async (
    documentIds: string[]
  ): Promise<Map<string, ResolvedAiModelSelection | null>> => {
    const result = new Map<string, ResolvedAiModelSelection | null>()
    if (documentIds.length === 0) {
      return result
    }

    const global = await getGlobal()
    const availableIds = await getAvailableProviderIds()
    const uniqueDocumentIds = Array.from(new Set(documentIds))
    const validDocumentIds = uniqueDocumentIds.filter((documentId) => isValidId(documentId))

    for (const documentId of uniqueDocumentIds) {
      if (!isValidId(documentId)) {
        result.set(documentId, null)
      }
    }

    if (validDocumentIds.length === 0) {
      return result
    }

    const documentSettings = await repos.aiModelSelection.getMany(
      usage,
      'document',
      validDocumentIds
    )
    const documentSettingsById = new Map(
      documentSettings.map((setting) => [setting.scopeId, setting])
    )
    const remainingDocumentIds = validDocumentIds.filter(
      (documentId) => !documentSettingsById.has(documentId)
    )

    const soleProjectIdsByDocumentId =
      await repos.projectDocuments.findSoleProjectIdsByDocumentIds(remainingDocumentIds)
    const soleProjectIds = Array.from(new Set(soleProjectIdsByDocumentId.values()))

    const projectSettings = await repos.aiModelSelection.getMany(usage, 'project', soleProjectIds)
    const projectSettingsById = new Map(
      projectSettings.map((setting) => [setting.scopeId, setting])
    )

    const projects = await repos.projects.findByIds(soleProjectIds)
    const ownerUserIdByProjectId = new Map(
      projects
        .filter((project) => isValidId(project.ownerUserId))
        .map((project) => [project.id, project.ownerUserId])
    )

    const ownerUserIds = Array.from(new Set(ownerUserIdByProjectId.values()))
    const userSettings = await repos.aiModelSelection.getMany(usage, 'user', ownerUserIds)
    const userSettingsById = new Map(userSettings.map((setting) => [setting.scopeId, setting]))

    for (const documentId of validDocumentIds) {
      const documentSetting = documentSettingsById.get(documentId)
      if (documentSetting) {
        result.set(documentId, {
          scopeType: 'document',
          scopeId: documentSetting.scopeId,
          providerConfigId: documentSetting.providerConfigId,
        })
        continue
      }

      const projectId = soleProjectIdsByDocumentId.get(documentId)
      if (projectId) {
        const projectSetting = projectSettingsById.get(projectId)
        if (projectSetting) {
          result.set(documentId, {
            scopeType: 'project',
            scopeId: projectSetting.scopeId,
            providerConfigId: projectSetting.providerConfigId,
          })
          continue
        }

        const ownerUserId = ownerUserIdByProjectId.get(projectId)
        if (ownerUserId) {
          const userSetting = userSettingsById.get(ownerUserId)
          if (userSetting) {
            result.set(documentId, {
              scopeType: 'user',
              scopeId: userSetting.scopeId,
              providerConfigId: userSetting.providerConfigId,
            })
            continue
          }
        }
      }

      result.set(documentId, {
        scopeType: 'global',
        scopeId: global.scopeId,
        providerConfigId: global.providerConfigId,
      })
    }

    for (const [documentId, resolved] of result.entries()) {
      if (!resolved) continue
      if (!availableIds.has(resolved.providerConfigId)) {
        result.set(documentId, {
          scopeType: 'global',
          scopeId: global.scopeId,
          providerConfigId: global.providerConfigId,
        })
      }
    }

    return result
  }

  const resolveForProjectDocuments = async (
    projectId: string,
    documentIds: string[]
  ): Promise<Map<string, ResolvedAiModelSelection | null>> => {
    const result = new Map<string, ResolvedAiModelSelection | null>()
    if (documentIds.length === 0) {
      return result
    }

    const global = await getGlobal()
    const availableIds = await getAvailableProviderIds()
    const uniqueDocumentIds = Array.from(new Set(documentIds))
    const validDocumentIds = uniqueDocumentIds.filter((documentId) => isValidId(documentId))

    for (const documentId of uniqueDocumentIds) {
      if (!isValidId(documentId)) {
        result.set(documentId, null)
      }
    }

    if (!isValidId(projectId) || validDocumentIds.length === 0) {
      return result
    }

    const project = await repos.projects.findById(projectId)
    if (!project) {
      for (const documentId of validDocumentIds) {
        result.set(documentId, null)
      }
      return result
    }

    const documentSettings = await repos.aiModelSelection.getMany(
      usage,
      'document',
      validDocumentIds
    )
    const documentSettingsById = new Map(
      documentSettings.map((setting) => [setting.scopeId, setting])
    )

    const projectSetting = await repos.aiModelSelection.get(usage, 'project', projectId)
    const ownerUserId = isValidId(project.ownerUserId) ? project.ownerUserId : null
    const userSetting = ownerUserId
      ? await repos.aiModelSelection.get(usage, 'user', ownerUserId)
      : undefined

    const remainingDocumentIds = validDocumentIds.filter(
      (documentId) => !documentSettingsById.has(documentId)
    )
    const soleProjectIdsByDocumentId =
      await repos.projectDocuments.findSoleProjectIdsByDocumentIds(remainingDocumentIds)
    const sharedAssociatedDocumentIds = await repos.projectDocuments.findAssociatedDocumentIds(
      projectId,
      remainingDocumentIds.filter((documentId) => !soleProjectIdsByDocumentId.has(documentId))
    )

    for (const documentId of validDocumentIds) {
      const documentSetting = documentSettingsById.get(documentId)
      if (documentSetting) {
        result.set(documentId, {
          scopeType: 'document',
          scopeId: documentSetting.scopeId,
          providerConfigId: documentSetting.providerConfigId,
        })
        continue
      }

      const soleProjectId = soleProjectIdsByDocumentId.get(documentId)
      if (soleProjectId === projectId) {
        if (projectSetting) {
          result.set(documentId, {
            scopeType: 'project',
            scopeId: projectSetting.scopeId,
            providerConfigId: projectSetting.providerConfigId,
          })
          continue
        }

        if (userSetting) {
          result.set(documentId, {
            scopeType: 'user',
            scopeId: userSetting.scopeId,
            providerConfigId: userSetting.providerConfigId,
          })
          continue
        }

        result.set(documentId, {
          scopeType: 'global',
          scopeId: global.scopeId,
          providerConfigId: global.providerConfigId,
        })
        continue
      }

      if (soleProjectId && soleProjectId !== projectId) {
        result.set(documentId, null)
        continue
      }

      if (!sharedAssociatedDocumentIds.has(documentId)) {
        result.set(documentId, null)
        continue
      }

      if (sharedDocumentPolicy === 'projectContextual') {
        if (projectSetting) {
          result.set(documentId, {
            scopeType: 'project',
            scopeId: projectSetting.scopeId,
            providerConfigId: projectSetting.providerConfigId,
          })
          continue
        }

        if (userSetting) {
          result.set(documentId, {
            scopeType: 'user',
            scopeId: userSetting.scopeId,
            providerConfigId: userSetting.providerConfigId,
          })
          continue
        }
      }

      result.set(documentId, {
        scopeType: 'global',
        scopeId: global.scopeId,
        providerConfigId: global.providerConfigId,
      })
    }

    for (const [documentId, resolved] of result.entries()) {
      if (!resolved) continue
      if (!availableIds.has(resolved.providerConfigId)) {
        result.set(documentId, {
          scopeType: 'global',
          scopeId: global.scopeId,
          providerConfigId: global.providerConfigId,
        })
      }
    }

    return result
  }

  return {
    getGlobal,

    async updateGlobal(providerConfigId: string): Promise<AiModelSelectionSnapshot> {
      await assertProviderConfigExists(providerConfigId)
      await repos.aiModelSelection.upsert({
        usage,
        scopeType: 'global',
        scopeId: GLOBAL_SCOPE_ID,
        providerConfigId,
        updatedAt: Date.now(),
      })

      const snapshot = await buildSnapshot({})
      if (!snapshot) {
        throw new Error(`Failed to resolve global ${usageLabel(usage)} model selection settings.`)
      }
      return snapshot
    },

    async getAvailableProviders() {
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
        throw new Error(`Failed to resolve user ${usageLabel(usage)} model selection settings.`)
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
        throw new Error(`Failed to resolve user ${usageLabel(usage)} model selection settings.`)
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

    resolveForDocuments,
    resolveForProjectDocuments,
  }
}

export function createAiModelSelectionService(repos: RepositorySet): AiModelSelectionService {
  const service = createAiProviderSelectionService(repos, 'generation')
  return {
    ...service,
    getAvailableGenerationProviders: service.getAvailableProviders,
  }
}

export function createEmbeddingModelSelectionService(
  repos: RepositorySet
): AiProviderSelectionService {
  return createAiProviderSelectionService(repos, 'embedding', {
    sharedDocumentPolicy: 'documentOwnedWhenShared',
  })
}

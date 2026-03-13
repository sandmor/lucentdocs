import {
  DEFAULT_GLOBAL_INDEXING_STRATEGY,
  isValidId,
  type IndexingStrategy,
  type IndexingStrategyScopeType,
  type ResolvedIndexingStrategy,
} from '@lucentdocs/shared'
import type { RepositorySet } from '../ports/types.js'

const GLOBAL_SCOPE_ID = 'global'

export interface IndexingScopeSetting {
  scopeType: IndexingStrategyScopeType
  scopeId: string
  strategy: IndexingStrategy | null
  updatedAt: number | null
}

export interface IndexingSettingsSnapshot {
  global: IndexingScopeSetting & { strategy: IndexingStrategy }
  user: IndexingScopeSetting | null
  project: IndexingScopeSetting | null
  document: IndexingScopeSetting | null
  ownerUserId: string | null
  resolved: ResolvedIndexingStrategy
}

export interface IndexingSettingsService {
  getGlobal(): Promise<IndexingScopeSetting & { strategy: IndexingStrategy }>
  updateGlobal(strategy: IndexingStrategy): Promise<IndexingSettingsSnapshot>
  getUserSnapshot(userId: string): Promise<IndexingSettingsSnapshot>
  updateUserStrategy(
    userId: string,
    strategy: IndexingStrategy | null
  ): Promise<IndexingSettingsSnapshot>
  getProjectSnapshot(projectId: string): Promise<IndexingSettingsSnapshot | null>
  updateProjectStrategy(
    projectId: string,
    strategy: IndexingStrategy | null
  ): Promise<IndexingSettingsSnapshot | null>
  getDocumentSnapshot(documentId: string): Promise<IndexingSettingsSnapshot | null>
  updateDocumentStrategy(
    documentId: string,
    strategy: IndexingStrategy | null
  ): Promise<IndexingSettingsSnapshot | null>
  resolveForDocument(documentId: string): Promise<ResolvedIndexingStrategy | null>
  resolveForDocuments(documentIds: string[]): Promise<Map<string, ResolvedIndexingStrategy | null>>
  resolveForProjectDocuments(
    projectId: string,
    documentIds: string[]
  ): Promise<Map<string, ResolvedIndexingStrategy | null>>
}

function toScopeSetting(
  scopeType: IndexingStrategyScopeType,
  scopeId: string,
  value: { strategy: IndexingStrategy; updatedAt: number } | null
): IndexingScopeSetting {
  return {
    scopeType,
    scopeId,
    strategy: value?.strategy ?? null,
    updatedAt: value?.updatedAt ?? null,
  }
}

export function createIndexingSettingsService(repos: RepositorySet): IndexingSettingsService {
  const getGlobal = async (): Promise<IndexingScopeSetting & { strategy: IndexingStrategy }> => {
    const existing = await repos.indexingSettings.get('global', GLOBAL_SCOPE_ID)
    if (existing) {
      return {
        scopeType: 'global',
        scopeId: GLOBAL_SCOPE_ID,
        strategy: existing.strategy,
        updatedAt: existing.updatedAt,
      }
    }

    const created = await repos.indexingSettings.upsert({
      scopeType: 'global',
      scopeId: GLOBAL_SCOPE_ID,
      strategy: DEFAULT_GLOBAL_INDEXING_STRATEGY,
      updatedAt: Date.now(),
    })

    return {
      scopeType: 'global',
      scopeId: GLOBAL_SCOPE_ID,
      strategy: created.strategy,
      updatedAt: created.updatedAt,
    }
  }

  const buildSnapshot = async (options: {
    userId?: string | null
    projectId?: string | null
    documentId?: string | null
  }): Promise<IndexingSettingsSnapshot | null> => {
    const global = await getGlobal()
    const documentId =
      options.documentId && isValidId(options.documentId) ? options.documentId : null
    const documentSetting = documentId
      ? await repos.indexingSettings.get('document', documentId)
      : undefined

    const soleProjectId = documentId
      ? ((await repos.projectDocuments.findSoleProjectIdByDocumentId(documentId)) ?? null)
      : null

    let projectId = documentId ? soleProjectId : (options.projectId ?? null)
    if (projectId && !isValidId(projectId)) {
      projectId = null
    }

    let ownerUserId = options.userId ?? null
    const projectSetting = projectId
      ? await repos.indexingSettings.get('project', projectId)
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
        ? await repos.indexingSettings.get('user', ownerUserId)
        : undefined

    const resolved: ResolvedIndexingStrategy = documentSetting
      ? {
          scopeType: 'document',
          scopeId: documentSetting.scopeId,
          strategy: documentSetting.strategy,
        }
      : projectSetting
        ? {
            scopeType: 'project',
            scopeId: projectSetting.scopeId,
            strategy: projectSetting.strategy,
          }
        : userSetting
          ? { scopeType: 'user', scopeId: userSetting.scopeId, strategy: userSetting.strategy }
          : { scopeType: 'global', scopeId: global.scopeId, strategy: global.strategy }

    return {
      global,
      user: ownerUserId ? toScopeSetting('user', ownerUserId, userSetting ?? null) : null,
      project: projectId ? toScopeSetting('project', projectId, projectSetting ?? null) : null,
      document: documentId ? toScopeSetting('document', documentId, documentSetting ?? null) : null,
      ownerUserId,
      resolved,
    }
  }

  const updateScopeStrategy = async (
    scopeType: Exclude<IndexingStrategyScopeType, 'global'>,
    scopeId: string,
    strategy: IndexingStrategy | null
  ): Promise<void> => {
    if (strategy === null) {
      await repos.indexingSettings.delete(scopeType, scopeId)
      return
    }

    await repos.indexingSettings.upsert({
      scopeType,
      scopeId,
      strategy,
      updatedAt: Date.now(),
    })
  }

  const resolveForDocuments = async (
    documentIds: string[]
  ): Promise<Map<string, ResolvedIndexingStrategy | null>> => {
    const result = new Map<string, ResolvedIndexingStrategy | null>()
    if (documentIds.length === 0) {
      return result
    }

    const global = await getGlobal()
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

    const documentSettings = await repos.indexingSettings.getMany('document', validDocumentIds)
    const documentSettingsById = new Map(
      documentSettings.map((setting) => [setting.scopeId, setting])
    )
    const remainingDocumentIds = validDocumentIds.filter(
      (documentId) => !documentSettingsById.has(documentId)
    )

    const soleProjectIdsByDocumentId =
      await repos.projectDocuments.findSoleProjectIdsByDocumentIds(remainingDocumentIds)
    const soleProjectIds = Array.from(new Set(soleProjectIdsByDocumentId.values()))

    const projectSettings = await repos.indexingSettings.getMany('project', soleProjectIds)
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
    const userSettings = await repos.indexingSettings.getMany('user', ownerUserIds)
    const userSettingsById = new Map(userSettings.map((setting) => [setting.scopeId, setting]))

    for (const documentId of validDocumentIds) {
      const documentSetting = documentSettingsById.get(documentId)
      if (documentSetting) {
        result.set(documentId, {
          scopeType: 'document',
          scopeId: documentSetting.scopeId,
          strategy: documentSetting.strategy,
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
            strategy: projectSetting.strategy,
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
              strategy: userSetting.strategy,
            })
            continue
          }
        }
      }

      result.set(documentId, {
        scopeType: 'global',
        scopeId: global.scopeId,
        strategy: global.strategy,
      })
    }

    return result
  }

  const resolveForProjectDocuments = async (
    projectId: string,
    documentIds: string[]
  ): Promise<Map<string, ResolvedIndexingStrategy | null>> => {
    const result = new Map<string, ResolvedIndexingStrategy | null>()
    if (documentIds.length === 0) {
      return result
    }

    const global = await getGlobal()
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

    const documentSettings = await repos.indexingSettings.getMany('document', validDocumentIds)
    const documentSettingsById = new Map(
      documentSettings.map((setting) => [setting.scopeId, setting])
    )

    const projectSetting = await repos.indexingSettings.get('project', projectId)
    const ownerUserId = isValidId(project.ownerUserId) ? project.ownerUserId : null
    const userSetting = ownerUserId
      ? await repos.indexingSettings.get('user', ownerUserId)
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
          strategy: documentSetting.strategy,
        })
        continue
      }

      const soleProjectId = soleProjectIdsByDocumentId.get(documentId)
      if (soleProjectId === projectId) {
        if (projectSetting) {
          result.set(documentId, {
            scopeType: 'project',
            scopeId: projectSetting.scopeId,
            strategy: projectSetting.strategy,
          })
          continue
        }

        if (userSetting) {
          result.set(documentId, {
            scopeType: 'user',
            scopeId: userSetting.scopeId,
            strategy: userSetting.strategy,
          })
          continue
        }

        result.set(documentId, {
          scopeType: 'global',
          scopeId: global.scopeId,
          strategy: global.strategy,
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

      result.set(documentId, {
        scopeType: 'global',
        scopeId: global.scopeId,
        strategy: global.strategy,
      })
    }

    return result
  }

  return {
    getGlobal,

    async updateGlobal(strategy: IndexingStrategy): Promise<IndexingSettingsSnapshot> {
      await repos.indexingSettings.upsert({
        scopeType: 'global',
        scopeId: GLOBAL_SCOPE_ID,
        strategy,
        updatedAt: Date.now(),
      })

      const snapshot = await buildSnapshot({})
      if (!snapshot) {
        throw new Error('Failed to resolve global indexing settings.')
      }
      return snapshot
    },

    async getUserSnapshot(userId: string): Promise<IndexingSettingsSnapshot> {
      const snapshot = await buildSnapshot({ userId })
      if (!snapshot) {
        throw new Error('Failed to resolve user indexing settings.')
      }
      return snapshot
    },

    async updateUserStrategy(
      userId: string,
      strategy: IndexingStrategy | null
    ): Promise<IndexingSettingsSnapshot> {
      await updateScopeStrategy('user', userId, strategy)
      const snapshot = await buildSnapshot({ userId })
      if (!snapshot) {
        throw new Error('Failed to resolve user indexing settings.')
      }
      return snapshot
    },

    async getProjectSnapshot(projectId: string): Promise<IndexingSettingsSnapshot | null> {
      if (!isValidId(projectId)) return null
      return buildSnapshot({ projectId })
    },

    async updateProjectStrategy(
      projectId: string,
      strategy: IndexingStrategy | null
    ): Promise<IndexingSettingsSnapshot | null> {
      if (!isValidId(projectId)) return null
      const project = await repos.projects.findById(projectId)
      if (!project) return null

      await updateScopeStrategy('project', projectId, strategy)
      return buildSnapshot({ projectId })
    },

    async getDocumentSnapshot(documentId: string): Promise<IndexingSettingsSnapshot | null> {
      if (!isValidId(documentId)) return null
      const document = await repos.documents.findById(documentId)
      if (!document) return null
      return buildSnapshot({ documentId })
    },

    async updateDocumentStrategy(
      documentId: string,
      strategy: IndexingStrategy | null
    ): Promise<IndexingSettingsSnapshot | null> {
      if (!isValidId(documentId)) return null
      const document = await repos.documents.findById(documentId)
      if (!document) return null

      await updateScopeStrategy('document', documentId, strategy)
      return buildSnapshot({ documentId })
    },

    async resolveForDocument(documentId: string): Promise<ResolvedIndexingStrategy | null> {
      const snapshot = await buildSnapshot({ documentId })
      return snapshot?.resolved ?? null
    },

    resolveForDocuments,
    resolveForProjectDocuments,
  }
}

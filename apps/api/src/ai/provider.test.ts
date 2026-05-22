import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AiSettingsService } from '../core/services/aiSettings.service.js'
import type { AiModelSelectionService } from '../core/services/aiModelSelection.service.js'
import {
  configureAiModelSelection,
  configureAiProvider,
  getLanguageModel,
  resetClient,
} from './provider.js'

describe('getLanguageModel', () => {
  afterEach(() => {
    resetClient()
  })

  test('uses hierarchical global selection instead of runtime active provider state', async () => {
    const resolveRuntimeSelection = mock(async () => {
      throw new Error('legacy runtime selection should not be used')
    })
    const resolveProviderByConfigId = mock(async (configId: string) => ({
      providerConfigId: configId,
      providerId: 'custom-compatible',
      type: 'openai-compatible' as const,
      baseURL: 'https://example.test/v1',
      model: 'model-b',
      apiKey: '',
    }))

    configureAiProvider({
      resolveRuntimeSelection,
      resolveProviderByConfigId,
    } as unknown as AiSettingsService)
    configureAiModelSelection({
      getGlobal: async () => ({
        scopeType: 'global',
        scopeId: 'global',
        providerConfigId: 'provider_b',
        updatedAt: Date.now(),
      }),
    } as unknown as AiModelSelectionService)

    await expect(getLanguageModel()).resolves.toBeDefined()
    expect(resolveProviderByConfigId).toHaveBeenCalledWith('provider_b')
    expect(resolveRuntimeSelection).not.toHaveBeenCalled()
  })

  test('passes project context through document-scoped resolution', async () => {
    const resolveForDocument = mock(async () => ({
      scopeType: 'project' as const,
      scopeId: 'project_1',
      providerConfigId: 'provider_b',
    }))

    configureAiProvider({
      resolveProviderByConfigId: async (configId: string) => ({
        providerConfigId: configId,
        providerId: 'custom-compatible',
        type: 'openai-compatible',
        baseURL: 'https://example.test/v1',
        model: 'model-b',
        apiKey: '',
      }),
    } as unknown as AiSettingsService)
    configureAiModelSelection({
      resolveForDocument,
    } as unknown as AiModelSelectionService)

    await expect(
      getLanguageModel({ documentId: 'doc_1', projectId: 'project_1' })
    ).resolves.toBeDefined()
    expect(resolveForDocument).toHaveBeenCalledWith('doc_1', 'project_1')
  })
})

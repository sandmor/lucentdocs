import { describe, expect, test } from 'bun:test'
import { LOCAL_DEFAULT_USER } from '../../core/models/user.js'
import type { AppContext } from '../index.js'
import { configRouter } from './config.js'
import { createTestAdapter } from '../../testing/factory.js'

function createCallerContext(): AppContext {
  const adapter = createTestAdapter()

  return {
    user: LOCAL_DEFAULT_USER,
    services: adapter.services,
    authPort: {
      isEnabled: () => false,
      validateSession: async () => LOCAL_DEFAULT_USER,
      login: async () => ({ success: false, error: 'not implemented' }),
      logout: async () => ({ success: true }),
      signup: async () => ({ success: false, error: 'not implemented' }),
    },
    yjsRuntime: {
      reloadRuntimeConfig: () => {},
    } as unknown as AppContext['yjsRuntime'],
    embeddingRuntime: {
      reloadConfig: () => {},
    } as unknown as AppContext['embeddingRuntime'],
    chatRuntime: {} as AppContext['chatRuntime'],
    inlineRuntime: {} as AppContext['inlineRuntime'],
  }
}

describe('configRouter sourceCatalog', () => {
  test('rejects an explicitly selected API key that does not match the provider base URL', async () => {
    const ctx = createCallerContext()
    await ctx.services.aiSettings.initializeDefaults()
    const snapshot = await ctx.services.aiSettings.createApiKey({
      baseURL: 'https://api.openai.com/v1',
      name: 'OpenAI key',
      apiKey: 'sk-test',
      isDefault: true,
    })
    const apiKeyId = snapshot.apiKeys[0]?.id

    if (!apiKeyId) {
      throw new Error('Expected test API key to be created.')
    }

    const caller = configRouter.createCaller(ctx)

    await expect(
      caller.sourceCatalog({
        usage: 'generation',
        providerId: 'openrouter',
        type: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKeyId,
      })
    ).rejects.toThrow('Selected API key does not match the provider base URL.')
  })
})

import { describe, expect, test } from 'bun:test'
import { createTestAdapter } from '../../testing/factory.js'

describe('AiSettingsService custom headers', () => {
  test('persists and resolves custom headers on provider configs', async () => {
    const adapter = createTestAdapter()
    await adapter.services.aiSettings.initializeDefaults()

    const snapshot = await adapter.services.aiSettings.getSnapshot()
    const provider = snapshot.generationProviders[0]
    if (!provider) {
      throw new Error('Expected a default generation provider.')
    }

    await adapter.services.aiSettings.updateSettings({
      usage: 'generation',
      providers: [
        {
          id: provider.id,
          providerId: provider.providerId,
          type: provider.type,
          baseURL: provider.baseURL,
          model: provider.model,
          apiKeyId: provider.apiKeyId,
          customHeaders: {
            'X-Custom': 'gateway',
          },
        },
      ],
    })

    const updated = await adapter.services.aiSettings.getSnapshot()
    expect(updated.generationProviders[0]?.customHeaders).toEqual({
      'X-Custom': 'gateway',
    })

    const resolved = await adapter.services.aiSettings.resolveProviderByConfigId(provider.id)
    expect(resolved?.customHeaders).toEqual({
      'X-Custom': 'gateway',
    })
  })
})

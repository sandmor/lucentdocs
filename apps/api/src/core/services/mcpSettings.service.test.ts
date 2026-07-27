import { describe, expect, test } from 'bun:test'
import { createTestAdapter } from '../../testing/factory.js'

describe('McpSettingsService', () => {
  test('returns HTTP headers and activates a discovered server with an enabled tool', async () => {
    const adapter = createTestAdapter()
    const created = await adapter.services.mcpSettings.create({
      name: 'Issue tracker',
      connection: {
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer example-token', 'X-Workspace': 'lucentdocs' },
      },
    })

    expect(created.connection).toEqual({
      transport: 'http',
      url: 'https://mcp.example.test/mcp',
      headers: { Authorization: 'Bearer example-token', 'X-Workspace': 'lucentdocs' },
    })

    const discovered = await adapter.services.mcpSettings.recordDiscovery(created.id, [
      'create_issue',
    ])
    expect(discovered.tools[0]?.enabled).toBe(false)

    await adapter.services.mcpSettings.updateToolPolicies(created.id, [
      { name: 'create_issue', enabled: true, allowInAsk: false },
    ])
    const unchanged = await adapter.services.mcpSettings.update({
      id: created.id,
      name: created.name,
      connection: {
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
        headers: { 'X-Workspace': 'lucentdocs', Authorization: 'Bearer example-token' },
      },
    })
    expect(unchanged.lastDiscoveryAt).not.toBeNull()
    const runtimeServer = (await adapter.services.mcpSettings.getRuntimeServers('agent'))[0]
    expect(runtimeServer?.connection).toMatchObject({
      transport: 'http',
      headers: { Authorization: 'Bearer example-token' },
    })

    const changed = await adapter.services.mcpSettings.update({
      id: created.id,
      name: created.name,
      connection: {
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer replacement-token' },
      },
    })
    expect(changed.lastDiscoveryAt).toBeNull()
  })

  test('masks stdio environment variables without masking HTTP headers', async () => {
    const adapter = createTestAdapter()
    const created = await adapter.services.mcpSettings.create({
      name: 'Local tools',
      connection: {
        transport: 'stdio',
        command: 'npx',
        args: [],
        cwd: null,
        env: [{ name: 'API_TOKEN', value: 'secret-value' }],
      },
    })

    expect(created.connection).toMatchObject({
      transport: 'stdio',
      env: [{ name: 'API_TOKEN', configured: true }],
    })
    expect(JSON.stringify(created)).not.toContain('secret-value')
    const runtime = await adapter.services.mcpSettings.getRuntimeServer(created.id)
    expect(runtime.connection).toMatchObject({
      transport: 'stdio',
      env: { API_TOKEN: 'secret-value' },
    })
  })

  test('allocates unique namespaces after truncation and skips Ask-ineligible servers', async () => {
    const adapter = createTestAdapter()
    const first = await adapter.services.mcpSettings.create({
      name: 'abcdefghijklmnopqr-first',
      connection: { transport: 'http', url: 'https://one.example.test/mcp', headers: {} },
    })
    const second = await adapter.services.mcpSettings.create({
      name: 'abcdefghijklmnopqr-second',
      connection: { transport: 'http', url: 'https://two.example.test/mcp', headers: {} },
    })
    expect(first.namespace).not.toBe(second.namespace)

    await adapter.services.mcpSettings.recordDiscovery(first.id, ['same_tool'])
    const secondDiscovery = await adapter.services.mcpSettings.recordDiscovery(second.id, [
      'same_tool',
    ])
    const firstDiscovery = await adapter.services.mcpSettings.recordDiscovery(first.id, [
      'same_tool',
    ])
    expect(firstDiscovery.tools[0]?.alias).not.toBe(secondDiscovery.tools[0]?.alias)
    await adapter.services.mcpSettings.updateToolPolicies(first.id, [
      { name: 'same_tool', enabled: true, allowInAsk: false },
    ])
    expect(await adapter.services.mcpSettings.getRuntimeServers('ask')).toEqual([])
    expect(
      (await adapter.services.mcpSettings.getRuntimeServers('agent')).map((server) => server.id)
    ).toEqual([first.id])
  })
})

import { describe, expect, mock, test } from 'bun:test'
import type { MCPTransport } from '@ai-sdk/mcp'
import type {
  McpSettingsService,
  McpSurface,
  RuntimeMcpServer,
} from '../core/services/mcpSettings.service.js'
import { createMcpConnector, McpToolRuntime, type McpConnector } from './runtime.js'

function server(): RuntimeMcpServer {
  return {
    id: 'server_1',
    name: 'Test server',
    namespace: 'test-server',
    connection: { transport: 'http', url: 'https://mcp.example.test/mcp', headers: {} },
    tools: [
      {
        name: 'test_tool',
        alias: 'mcp_test_server_test_tool',
        enabled: true,
        allowInAsk: false,
        present: true,
        description: null,
        lastSeenAt: 0,
      },
    ],
    lastDiscoveryAt: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

function transport(close = mock(async () => {})): MCPTransport {
  return {
    start: async () => {},
    send: async () => {},
    close,
  }
}

describe('MCP runtime', () => {
  test('closes a transport when client initialization times out', async () => {
    const close = mock(async () => {})
    const connector = createMcpConnector({
      createTransport: () => transport(close),
      createClient: async () => await new Promise<never>(() => {}),
      timeoutMs: 1,
    })

    await expect(connector.connect(server())).rejects.toThrow('MCP connection timed out.')
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('does not connect Ask-ineligible servers', async () => {
    const connect = mock(async () => ({ close: async () => {}, tools: async () => ({}) }))
    const settings = {
      getRuntimeServers: async (surface: McpSurface) => {
        expect(surface).toBe('ask')
        return []
      },
    } as unknown as McpSettingsService

    const session = await new McpToolRuntime(settings, { connect } as McpConnector).acquire('ask')
    expect(connect).not.toHaveBeenCalled()
    expect(session.tools).toEqual({})
  })

  test('closes a client immediately when tool discovery times out', async () => {
    const close = mock(async () => {})
    const settings = {
      getRuntimeServers: async () => [server()],
    } as unknown as McpSettingsService
    const connector = {
      connect: async () => ({ close, tools: async () => await new Promise<never>(() => {}) }),
    } as McpConnector

    await new McpToolRuntime(settings, connector, 1).acquire('agent')
    expect(close).toHaveBeenCalledTimes(1)
  })
})

import { createMCPClient, type MCPClient, type MCPTransport } from '@ai-sdk/mcp'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  McpSettingsService,
  McpSurface,
  RuntimeMcpServer,
} from '../core/services/mcpSettings.service.js'

const CONNECT_TIMEOUT_MS = 10_000

type McpClient = Pick<MCPClient, 'close' | 'tools'>

export interface McpConnector {
  connect(server: RuntimeMcpServer): Promise<McpClient>
}

interface McpConnectorDependencies {
  createClient: (config: { transport: MCPTransport }) => Promise<McpClient>
  createTransport: (server: RuntimeMcpServer) => MCPTransport
  timeoutMs: number
}

function createTransport(server: RuntimeMcpServer): MCPTransport {
  if (server.connection.transport === 'http') {
    return new StreamableHTTPClientTransport(new URL(server.connection.url), {
      requestInit: { headers: server.connection.headers },
    }) as MCPTransport
  }
  return new StdioClientTransport({
    command: server.connection.command,
    args: server.connection.args,
    cwd: server.connection.cwd ?? undefined,
    env: { PATH: process.env.PATH ?? '', ...server.connection.env },
  }) as MCPTransport
}

async function closeQuietly(resource: { close: () => Promise<void> }) {
  await resource.close().catch(() => undefined)
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<void>
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    promise.then(
      (value) => ({ type: 'value' as const, value }),
      (error) => ({ type: 'error' as const, error })
    ),
    new Promise<{ type: 'timeout' }>((resolve) => {
      timeout = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs)
    }),
  ])
  if (timeout) clearTimeout(timeout)
  if (result.type === 'value') return result.value
  if (result.type === 'error') throw result.error
  await onTimeout()
  throw new Error('MCP connection timed out.')
}

export function createMcpConnector(
  overrides: Partial<McpConnectorDependencies> = {}
): McpConnector {
  const dependencies: McpConnectorDependencies = {
    createClient: createMCPClient,
    createTransport,
    timeoutMs: CONNECT_TIMEOUT_MS,
    ...overrides,
  }

  return {
    async connect(server) {
      const transport = dependencies.createTransport(server)
      let closed = false
      const closeTransport = async () => {
        if (closed) return
        closed = true
        await closeQuietly(transport)
      }
      try {
        return await withTimeout(
          dependencies.createClient({ transport }),
          dependencies.timeoutMs,
          closeTransport
        )
      } catch (error) {
        await closeTransport()
        throw error
      }
    },
  }
}

const defaultConnector = createMcpConnector()

export async function discoverMcpServer(
  server: RuntimeMcpServer,
  connector: McpConnector = defaultConnector,
  timeoutMs = CONNECT_TIMEOUT_MS
): Promise<string[]> {
  const client = await connector.connect(server)
  let closed = false
  const closeClient = async () => {
    if (closed) return
    closed = true
    await closeQuietly(client)
  }
  try {
    return Object.keys(await withTimeout(client.tools(), timeoutMs, closeClient))
  } finally {
    await closeClient()
  }
}

export class McpToolRuntime {
  private readonly settings: McpSettingsService
  private readonly connector: McpConnector
  private readonly timeoutMs: number

  constructor(
    settings: McpSettingsService,
    connector: McpConnector = defaultConnector,
    timeoutMs = CONNECT_TIMEOUT_MS
  ) {
    this.settings = settings
    this.connector = connector
    this.timeoutMs = timeoutMs
  }

  async acquire(
    surface: McpSurface
  ): Promise<{ tools: Record<string, unknown>; close: () => Promise<void> }> {
    const clients: McpClient[] = []
    const tools: Record<string, unknown> = {}
    const servers = await this.settings.getRuntimeServers(surface)
    await Promise.all(
      servers.map(async (server) => {
        let client: McpClient | undefined
        let clientClosed = false
        const closeClient = async () => {
          if (!client || clientClosed) return
          clientClosed = true
          await closeQuietly(client)
        }
        try {
          client = await this.connector.connect(server)
          const discovered = await withTimeout(client.tools(), this.timeoutMs, closeClient)
          for (const policy of server.tools) {
            if (!policy.present || !policy.enabled || (surface === 'ask' && !policy.allowInAsk))
              continue
            const tool = (discovered as Record<string, unknown>)[policy.name]
            if (tool) tools[policy.alias] = tool
          }
          clients.push(client)
        } catch (error) {
          await closeClient()
          console.warn(
            `MCP server unavailable (${server.id}, ${server.name}):`,
            error instanceof Error ? error.message : 'unknown error'
          )
        }
      })
    )
    return {
      tools,
      close: async () => {
        await Promise.allSettled(clients.map((client) => client.close()))
      },
    }
  }
}

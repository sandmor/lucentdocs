import { normalizeCustomHeaders } from '@lucentdocs/shared'
import { nanoid } from 'nanoid'
import type { AppConfigRepositoryPort } from '../ports/appConfig.port.js'

const MCP_SETTINGS_KEY = 'mcp.settings.v1'
const MAX_NAMESPACE_LENGTH = 18

export type McpTransport = 'http' | 'stdio'
export type McpSurface = 'ask' | 'agent' | 'inline'

export interface McpEnvironmentPatch {
  name: string
  value?: string
  remove?: boolean
}

export interface McpToolPolicy {
  name: string
  alias: string
  enabled: boolean
  allowInAsk: boolean
  present: boolean
  description: string | null
  lastSeenAt: number
}

export interface McpHttpConnection {
  transport: 'http'
  url: string
  headers: Record<string, string>
}

export interface McpStdioConnection {
  transport: 'stdio'
  command: string
  args: string[]
  cwd: string | null
  env: Record<string, string>
}

export type StoredMcpConnection = McpHttpConnection | McpStdioConnection

export type McpConnectionInput =
  | McpHttpConnection
  | {
      transport: 'stdio'
      command: string
      args?: string[]
      cwd?: string | null
      env?: McpEnvironmentPatch[]
    }

export type McpConnectionSummary =
  | McpHttpConnection
  | (Omit<McpStdioConnection, 'env'> & { env: Array<{ name: string; configured: true }> })

interface StoredMcpServer {
  id: string
  name: string
  namespace: string
  connection: StoredMcpConnection
  tools: McpToolPolicy[]
  lastDiscoveryAt: number | null
  lastDiscoveryError: string | null
  createdAt: number
  updatedAt: number
}

export interface McpServerSummary {
  id: string
  name: string
  namespace: string
  connection: McpConnectionSummary
  tools: McpToolPolicy[]
  lastDiscoveryAt: number | null
  lastDiscoveryError: string | null
  createdAt: number
  updatedAt: number
}

export type RuntimeMcpServer = Omit<StoredMcpServer, 'lastDiscoveryError'>

function isStoredServer(entry: unknown): entry is StoredMcpServer {
  if (!entry || typeof entry !== 'object') return false
  const server = entry as Partial<StoredMcpServer>
  if (
    typeof server.id !== 'string' ||
    typeof server.name !== 'string' ||
    typeof server.namespace !== 'string' ||
    !server.connection ||
    typeof server.connection !== 'object' ||
    !Array.isArray(server.tools)
  ) {
    return false
  }
  const connection = server.connection as Partial<StoredMcpConnection>
  return connection.transport === 'http'
    ? typeof connection.url === 'string' &&
        Boolean(connection.headers && typeof connection.headers === 'object')
    : connection.transport === 'stdio' &&
        typeof connection.command === 'string' &&
        Array.isArray(connection.args) &&
        Boolean(connection.env && typeof connection.env === 'object')
}

function parseStored(value: string | undefined): StoredMcpServer[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter(isStoredServer) : []
  } catch {
    return []
  }
}

function normalizeName(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} is required.`)
  return normalized
}

function namespaceFor(name: string, existing: StoredMcpServer[]): string {
  const normalized =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'server'
  const root = normalized.slice(0, MAX_NAMESPACE_LENGTH)
  const used = new Set(existing.map((server) => server.namespace))
  if (!used.has(root)) return root

  for (let index = 2; ; index += 1) {
    const suffix = `-${index}`
    const candidate = `${root.slice(0, MAX_NAMESPACE_LENGTH - suffix.length)}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

function applyEnvironmentPatches(
  current: Record<string, string>,
  patches: McpEnvironmentPatch[] | undefined
) {
  if (!patches) return { ...current }
  const next = { ...current }
  for (const patch of patches) {
    const name = normalizeName(patch.name, 'Environment variable name')
    if (patch.remove) {
      delete next[name]
      continue
    }
    if (patch.value !== undefined) {
      if (!patch.value) throw new Error(`A value is required for ${name}.`)
      next[name] = patch.value
    }
  }
  return next
}

function normalizeConnection(input: McpConnectionInput, previous?: StoredMcpConnection) {
  if (input.transport === 'http') {
    return {
      transport: 'http' as const,
      url: normalizeName(input.url, 'URL'),
      headers: normalizeCustomHeaders(input.headers),
    }
  }
  return {
    transport: 'stdio' as const,
    command: normalizeName(input.command, 'Command'),
    args: input.args ?? [],
    cwd: input.cwd?.trim() || null,
    env: applyEnvironmentPatches(previous?.transport === 'stdio' ? previous.env : {}, input.env),
  }
}

function connectionFingerprint(connection: StoredMcpConnection): string {
  if (connection.transport === 'http') {
    return JSON.stringify({
      ...connection,
      headers: Object.entries(connection.headers).sort(([left], [right]) =>
        left.localeCompare(right)
      ),
    })
  }
  return JSON.stringify({
    ...connection,
    env: Object.entries(connection.env).sort(([left], [right]) => left.localeCompare(right)),
  })
}

function toSummary(server: StoredMcpServer): McpServerSummary {
  const connection: McpConnectionSummary =
    server.connection.transport === 'http'
      ? server.connection
      : {
          ...server.connection,
          env: Object.keys(server.connection.env)
            .sort()
            .map((name) => ({ name, configured: true })),
        }
  return { ...server, connection }
}

function isEligibleForSurface(tool: McpToolPolicy, surface: McpSurface) {
  return tool.present && tool.enabled && (surface !== 'ask' || tool.allowInAsk)
}

function aliasFor(namespace: string, toolName: string, used: Set<string>): string {
  const safe =
    toolName
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'tool'
  const hash = Array.from(toolName)
    .reduce((value, char) => (value * 33 + char.charCodeAt(0)) >>> 0, 5381)
    .toString(36)
  const base = `mcp_${namespace.replace(/-/g, '_')}_${safe.slice(0, 34)}_${hash}`.slice(0, 62)
  let alias = base
  let index = 2
  while (used.has(alias)) alias = `${base.slice(0, 58)}_${index++}`
  used.add(alias)
  return alias
}

export interface McpSettingsService {
  list(): Promise<McpServerSummary[]>
  getRuntimeServers(surface: McpSurface): Promise<RuntimeMcpServer[]>
  getRuntimeServer(id: string): Promise<RuntimeMcpServer>
  create(input: { name: string; connection: McpConnectionInput }): Promise<McpServerSummary>
  update(input: {
    id: string
    name: string
    connection: McpConnectionInput
  }): Promise<McpServerSummary>
  delete(id: string): Promise<void>
  recordDiscovery(id: string, toolNames: string[]): Promise<McpServerSummary>
  recordDiscoveryFailure(id: string, message: string): Promise<void>
  updateToolPolicies(
    id: string,
    tools: Array<Pick<McpToolPolicy, 'name' | 'enabled' | 'allowInAsk'>>
  ): Promise<McpServerSummary>
}

export function createMcpSettingsService(repos: {
  appConfig: AppConfigRepositoryPort
}): McpSettingsService {
  const read = () =>
    parseStored(
      repos.appConfig.readEntries().find((entry) => entry.key === MCP_SETTINGS_KEY)?.value
    )
  const write = (servers: StoredMcpServer[]) =>
    repos.appConfig.upsertEntries(
      [{ key: MCP_SETTINGS_KEY, value: JSON.stringify(servers) }],
      Date.now()
    )
  const get = (id: string) => {
    const servers = read()
    const server = servers.find((entry) => entry.id === id)
    if (!server) throw new Error('MCP server was not found.')
    return { servers, server }
  }

  return {
    async list() {
      return read().map(toSummary)
    },
    async getRuntimeServers(surface) {
      return read().filter(
        (server) =>
          server.lastDiscoveryAt !== null &&
          server.tools.some((tool) => isEligibleForSurface(tool, surface))
      )
    },
    async getRuntimeServer(id) {
      return get(id).server
    },
    async create(input) {
      const servers = read()
      const now = Date.now()
      const server: StoredMcpServer = {
        id: nanoid(),
        name: normalizeName(input.name, 'Name'),
        namespace: namespaceFor(input.name, servers),
        connection: normalizeConnection(input.connection),
        tools: [],
        lastDiscoveryAt: null,
        lastDiscoveryError: null,
        createdAt: now,
        updatedAt: now,
      }
      servers.push(server)
      write(servers)
      return toSummary(server)
    },
    async update(input) {
      const { servers, server } = get(input.id)
      const connection = normalizeConnection(input.connection, server.connection)
      const connectionChanged =
        connectionFingerprint(server.connection) !== connectionFingerprint(connection)
      Object.assign(server, {
        name: normalizeName(input.name, 'Name'),
        connection,
        lastDiscoveryAt: connectionChanged ? null : server.lastDiscoveryAt,
        lastDiscoveryError: connectionChanged ? null : server.lastDiscoveryError,
        updatedAt: Date.now(),
      })
      write(servers)
      return toSummary(server)
    },
    async delete(id) {
      write(read().filter((server) => server.id !== id))
    },
    async recordDiscovery(id, toolNames) {
      const { servers, server } = get(id)
      const now = Date.now()
      const existing = new Map(server.tools.map((tool) => [tool.name, tool]))
      const used = new Set(server.tools.map((tool) => tool.alias))
      server.tools = toolNames
        .sort()
        .map((name) => {
          const prior = existing.get(name)
          return prior
            ? { ...prior, present: true, lastSeenAt: now }
            : {
                name,
                alias: aliasFor(server.namespace, name, used),
                enabled: false,
                allowInAsk: false,
                present: true,
                description: null,
                lastSeenAt: now,
              }
        })
        .concat(
          server.tools
            .filter((tool) => !toolNames.includes(tool.name))
            .map((tool) => ({ ...tool, present: false }))
        )
      server.lastDiscoveryAt = now
      server.lastDiscoveryError = null
      server.updatedAt = now
      write(servers)
      return toSummary(server)
    },
    async recordDiscoveryFailure(id, message) {
      const { servers, server } = get(id)
      server.lastDiscoveryError = message.slice(0, 500)
      server.updatedAt = Date.now()
      write(servers)
    },
    async updateToolPolicies(id, tools) {
      const { servers, server } = get(id)
      const requested = new Map(tools.map((tool) => [tool.name, tool]))
      server.tools = server.tools.map((tool) => {
        const patch = requested.get(tool.name)
        return patch ? { ...tool, enabled: patch.enabled, allowInAsk: patch.allowInAsk } : tool
      })
      server.updatedAt = Date.now()
      write(servers)
      return toSummary(server)
    },
  }
}

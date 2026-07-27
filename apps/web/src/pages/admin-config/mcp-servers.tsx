import { useState } from 'react'
import {
  AlertTriangle,
  Cable,
  ChevronDown,
  CircleAlert,
  Plus,
  RefreshCcw,
  Terminal,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CustomHeadersEditor } from './custom-headers-editor'

type Transport = 'http' | 'stdio'

type ToolPolicy = {
  name: string
  alias: string
  enabled: boolean
  allowInAsk: boolean
  present: boolean
  description: string | null
  lastSeenAt: number
}

type Server = {
  id: string
  name: string
  namespace: string
  connection:
    | { transport: 'http'; url: string; headers: Record<string, string> }
    | {
        transport: 'stdio'
        command: string
        args: string[]
        cwd: string | null
        env: Array<{ name: string; configured: true }>
      }
  tools: ToolPolicy[]
  lastDiscoveryAt: number | null
  lastDiscoveryError: string | null
  createdAt: number
  updatedAt: number
}

function TransportSelect({
  value,
  onValueChange,
}: {
  value: Transport
  onValueChange: (value: Transport) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as Transport)}>
      <SelectTrigger className="w-full">
        <SelectValue>{value === 'http' ? 'Streamable HTTP' : 'Local stdio'}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="http">Streamable HTTP</SelectItem>
        <SelectItem value="stdio">Local stdio</SelectItem>
      </SelectContent>
    </Select>
  )
}

function ConnectionFields({
  transport,
  url,
  command,
  args,
  cwd,
  onUrlChange,
  onCommandChange,
  onArgsChange,
  onCwdChange,
}: {
  transport: Transport
  url: string
  command: string
  args: string
  cwd: string
  onUrlChange: (value: string) => void
  onCommandChange: (value: string) => void
  onArgsChange: (value: string) => void
  onCwdChange: (value: string) => void
}) {
  if (transport === 'http') {
    return (
      <Field>
        <FieldLabel>MCP URL</FieldLabel>
        <Input
          value={url}
          placeholder="https://example.com/mcp"
          onChange={(event) => onUrlChange(event.target.value)}
        />
        <FieldDescription>Use the server’s Streamable HTTP endpoint.</FieldDescription>
      </Field>
    )
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>Command</FieldLabel>
          <Input
            value={command}
            placeholder="npx"
            onChange={(event) => onCommandChange(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>Arguments</FieldLabel>
          <Input
            value={args}
            placeholder="-y @example/mcp"
            onChange={(event) => onArgsChange(event.target.value)}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel>Working directory</FieldLabel>
        <Input
          value={cwd}
          placeholder="Optional absolute path"
          onChange={(event) => onCwdChange(event.target.value)}
        />
        <FieldDescription>
          Optional. The command runs with the API process’s OS permissions.
        </FieldDescription>
      </Field>
    </>
  )
}

function EnvironmentSecretsFields({
  configuredEnvironment,
  name,
  value,
  removedNames,
  onNameChange,
  onValueChange,
  onToggleRemove,
}: {
  configuredEnvironment: Array<{ name: string; configured: true }>
  name: string
  value: string
  removedNames: string[]
  onNameChange: (value: string) => void
  onValueChange: (value: string) => void
  onToggleRemove: (name: string) => void
}) {
  return (
    <Field>
      <FieldLabel>Environment variable</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={name}
          placeholder="API_TOKEN"
          onChange={(event) => onNameChange(event.target.value)}
        />
        <Input
          type="password"
          value={value}
          placeholder="New value (stored masked)"
          onChange={(event) => onValueChange(event.target.value)}
        />
      </div>
      {configuredEnvironment.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {configuredEnvironment.map((secret) => {
            const removed = removedNames.includes(secret.name)
            return (
              <button
                key={secret.name}
                type="button"
                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  removed
                    ? 'border-destructive/40 text-destructive line-through'
                    : 'border-border/70 text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => onToggleRemove(secret.name)}
              >
                {secret.name} •••
              </button>
            )
          })}
        </div>
      )}
      <FieldDescription>
        Existing values never return to the browser. Click a configured secret to remove it on save.
      </FieldDescription>
    </Field>
  )
}

function headersEqual(left: Record<string, string>, right: Record<string, string>) {
  const entries = (headers: Record<string, string>) =>
    Object.entries(headers).sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right))
}

function ToolPolicies({ server }: { server: Server }) {
  const utils = trpc.useUtils()
  const save = trpc.mcp.updateToolPolicies.useMutation()
  const [tools, setTools] = useState<ToolPolicy[]>(server.tools)
  const dirty =
    JSON.stringify(
      tools.map(({ name, enabled, allowInAsk }) => ({ name, enabled, allowInAsk }))
    ) !==
    JSON.stringify(
      server.tools.map(({ name, enabled, allowInAsk }) => ({ name, enabled, allowInAsk }))
    )

  if (tools.length === 0) {
    return <p className="text-sm text-muted-foreground">Test this server to discover its tools.</p>
  }

  return (
    <div className="space-y-2">
      {tools.map((tool) => (
        <div
          key={tool.name}
          className="flex items-center gap-3 rounded-lg border border-border/55 bg-background/60 px-3 py-2.5"
        >
          <Switch
            size="sm"
            checked={tool.enabled}
            onCheckedChange={(enabled) =>
              setTools((current) =>
                current.map((item) => (item.name === tool.name ? { ...item, enabled } : item))
              )
            }
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs font-medium">{tool.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {tool.present ? 'Available from server' : 'Not currently advertised'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={tool.allowInAsk}
              disabled={!tool.enabled}
              onCheckedChange={(allowInAsk) =>
                setTools((current) =>
                  current.map((item) => (item.name === tool.name ? { ...item, allowInAsk } : item))
                )
              }
            />
            Ask-safe
          </label>
        </div>
      ))}
      {dirty && (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  id: server.id,
                  tools: tools.map(({ name, enabled, allowInAsk }) => ({
                    name,
                    enabled,
                    allowInAsk,
                  })),
                },
                {
                  onSuccess: () => {
                    void utils.mcp.list.invalidate()
                    toast.success('Tool permissions saved')
                  },
                  onError: (error) =>
                    toast.error('Failed to save tool permissions', { description: error.message }),
                }
              )
            }
          >
            Save tool permissions
          </Button>
        </div>
      )}
    </div>
  )
}

function ServerCard({ server }: { server: Server }) {
  const utils = trpc.useUtils()
  const update = trpc.mcp.updateServer.useMutation()
  const discover = trpc.mcp.discoverServer.useMutation()
  const remove = trpc.mcp.deleteServer.useMutation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(server.name)
  const [transport, setTransport] = useState<Transport>(server.connection.transport)
  const [url, setUrl] = useState(
    server.connection.transport === 'http' ? server.connection.url : ''
  )
  const [command, setCommand] = useState(
    server.connection.transport === 'stdio' ? server.connection.command : ''
  )
  const [args, setArgs] = useState(
    server.connection.transport === 'stdio' ? server.connection.args.join(' ') : ''
  )
  const [cwd, setCwd] = useState(
    server.connection.transport === 'stdio' ? (server.connection.cwd ?? '') : ''
  )
  const [headers, setHeaders] = useState(
    server.connection.transport === 'http' ? server.connection.headers : {}
  )
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [removedSecrets, setRemovedSecrets] = useState<string[]>([])

  const environmentPatches = [
    ...removedSecrets.map((secret) => ({ name: secret, remove: true })),
    ...(secretName.trim() && secretValue ? [{ name: secretName.trim(), value: secretValue }] : []),
  ]

  const save = () => {
    const connection =
      transport === 'http'
        ? { transport, url, headers }
        : {
            transport,
            command,
            args: args.trim() ? args.trim().split(/\s+/) : [],
            cwd: cwd || null,
            env: environmentPatches,
          }

    update.mutate(
      { id: server.id, name, connection },
      {
        onSuccess: () => {
          setSecretName('')
          setSecretValue('')
          setRemovedSecrets([])
          void utils.mcp.list.invalidate()
          toast.success('MCP server saved')
        },
        onError: (error) =>
          toast.error('Failed to save MCP server', { description: error.message }),
      }
    )
  }

  const endpoint =
    server.connection.transport === 'http' ? server.connection.url : server.connection.command
  const connectionDirty =
    transport !== server.connection.transport ||
    (transport === 'http'
      ? server.connection.transport !== 'http' ||
        url !== server.connection.url ||
        !headersEqual(headers, server.connection.headers)
      : server.connection.transport !== 'stdio' ||
        command !== server.connection.command ||
        args !== server.connection.args.join(' ') ||
        cwd !== (server.connection.cwd ?? '') ||
        secretName.trim().length > 0 ||
        secretValue.length > 0 ||
        removedSecrets.length > 0)
  const formDirty = name !== server.name || connectionDirty
  const active =
    server.lastDiscoveryAt !== null && server.tools.some((tool) => tool.present && tool.enabled)
  const setupStatus = server.lastDiscoveryError
    ? { label: 'Connection failed', destructive: true }
    : active
      ? null
      : server.lastDiscoveryAt
        ? { label: 'Enable a tool', destructive: false }
        : { label: 'Test connection', destructive: false }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/25"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {server.connection.transport === 'stdio' ? (
            <Terminal className="size-4" />
          ) : (
            <Cable className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{server.name}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">{endpoint}</span>
        </span>
        {setupStatus && (
          <span
            className={`hidden items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${
              setupStatus.destructive
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {setupStatus.destructive && <CircleAlert className="size-3" />}
            {setupStatus.label}
          </span>
        )}
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-5 border-t border-border/60 bg-muted/10 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Transport</FieldLabel>
              <TransportSelect value={transport} onValueChange={setTransport} />
            </Field>
          </div>

          <ConnectionFields
            transport={transport}
            url={url}
            command={command}
            args={args}
            cwd={cwd}
            onUrlChange={setUrl}
            onCommandChange={setCommand}
            onArgsChange={setArgs}
            onCwdChange={setCwd}
          />

          {transport === 'http' ? (
            <CustomHeadersEditor
              ownerId={`mcp-${server.id}`}
              headers={headers}
              onChange={setHeaders}
              resetToken={JSON.stringify(
                server.connection.transport === 'http' ? server.connection.headers : {}
              )}
              description="Optional headers sent with every request to this MCP server."
            />
          ) : (
            <EnvironmentSecretsFields
              configuredEnvironment={
                server.connection.transport === 'stdio' ? server.connection.env : []
              }
              name={secretName}
              value={secretValue}
              removedNames={removedSecrets}
              onNameChange={setSecretName}
              onValueChange={setSecretValue}
              onToggleRemove={(secret) =>
                setRemovedSecrets((current) =>
                  current.includes(secret)
                    ? current.filter((name) => name !== secret)
                    : [...current, secret]
                )
              }
            />
          )}

          {server.lastDiscoveryError && (
            <p className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Last discovery failed: {server.lastDiscoveryError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={discover.isPending || connectionDirty}
              onClick={() =>
                discover.mutate(
                  { id: server.id },
                  {
                    onSuccess: () => {
                      void utils.mcp.list.invalidate()
                      toast.success('Tools discovered')
                    },
                    onError: (error) =>
                      toast.error('Discovery failed', { description: error.message }),
                  }
                )
              }
            >
              <RefreshCcw
                className={discover.isPending ? 'animate-spin' : ''}
                data-icon="inline-start"
              />
              Test & discover
            </Button>
            {formDirty && (
              <Button size="sm" variant="outline" disabled={update.isPending} onClick={save}>
                Save changes
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() =>
                remove.mutate(
                  { id: server.id },
                  {
                    onSuccess: () => {
                      void utils.mcp.list.invalidate()
                      toast.success('MCP server removed')
                    },
                    onError: (error) =>
                      toast.error('Failed to remove MCP server', { description: error.message }),
                  }
                )
              }
            >
              <Trash2 />
            </Button>
          </div>
          {connectionDirty && (
            <p className="text-xs text-muted-foreground">Save connection changes before testing.</p>
          )}

          <div className="space-y-2 border-t border-border/60 pt-4">
            <div>
              <p className="text-sm font-medium">Tool permissions</p>
              <p className="text-xs text-muted-foreground">
                Ask-safe tools also run in read-only chats. This server becomes active as soon as
                you save at least one enabled tool.
              </p>
            </div>
            <ToolPolicies
              key={JSON.stringify(
                server.tools.map(({ name, enabled, allowInAsk, present, lastSeenAt }) => ({
                  name,
                  enabled,
                  allowInAsk,
                  present,
                  lastSeenAt,
                }))
              )}
              server={server}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function McpServersSettings() {
  const utils = trpc.useUtils()
  const query = trpc.mcp.list.useQuery()
  const create = trpc.mcp.createServer.useMutation()
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<Transport>('http')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [cwd, setCwd] = useState('')
  const [headers, setHeaders] = useState<Record<string, string>>({})
  const [headerEditorKey, setHeaderEditorKey] = useState(0)
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')

  const addServer = () => {
    const connection =
      transport === 'http'
        ? {
            transport,
            url,
            headers,
          }
        : {
            transport,
            command,
            args: args.trim() ? args.trim().split(/\s+/) : [],
            cwd: cwd || null,
            env: secretName && secretValue ? [{ name: secretName, value: secretValue }] : [],
          }

    create.mutate(
      { name, connection },
      {
        onSuccess: () => {
          setName('')
          setUrl('')
          setCommand('')
          setArgs('')
          setCwd('')
          setHeaders({})
          setHeaderEditorKey((current) => current + 1)
          setSecretName('')
          setSecretValue('')
          void utils.mcp.list.invalidate()
          toast.success('MCP server added — test it to discover tools')
        },
        onError: (error) => toast.error('Failed to add MCP server', { description: error.message }),
      }
    )
  }

  const endpointReady = transport === 'http' ? Boolean(url) : Boolean(command)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cable className="size-5 text-primary" />
          MCP Servers
        </CardTitle>
        <CardDescription>
          Configure trusted Model Context Protocol servers for every assistant run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="rounded-xl border border-dashed bg-muted/20 p-4">
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="size-4" />
            Only add servers you trust. Local stdio commands execute on this host.
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Server name</FieldLabel>
              <Input
                value={name}
                placeholder="Issue tracker"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Transport</FieldLabel>
              <TransportSelect value={transport} onValueChange={setTransport} />
            </Field>
          </div>
          <div className="mt-4">
            <ConnectionFields
              transport={transport}
              url={url}
              command={command}
              args={args}
              cwd={cwd}
              onUrlChange={setUrl}
              onCommandChange={setCommand}
              onArgsChange={setArgs}
              onCwdChange={setCwd}
            />
          </div>
          <div className="mt-4">
            {transport === 'http' ? (
              <CustomHeadersEditor
                ownerId="new-mcp-server"
                headers={headers}
                onChange={setHeaders}
                resetToken={headerEditorKey}
                description="Optional headers sent with every request to this MCP server."
              />
            ) : (
              <EnvironmentSecretsFields
                configuredEnvironment={[]}
                name={secretName}
                value={secretValue}
                removedNames={[]}
                onNameChange={setSecretName}
                onValueChange={setSecretValue}
                onToggleRemove={() => {}}
              />
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button disabled={create.isPending || !name || !endpointReady} onClick={addServer}>
              <Plus data-icon="inline-start" />
              Add server
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading MCP servers…</p>
        ) : query.data?.length ? (
          <div className="space-y-3">
            {query.data.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
            No MCP servers configured yet.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

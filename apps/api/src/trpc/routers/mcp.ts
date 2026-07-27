import { z } from 'zod/v4'
import { normalizeCustomHeaders, type AiProviderCustomHeaders } from '@lucentdocs/shared'
import { adminProcedure, router } from '../index.js'
import { discoverMcpServer } from '../../mcp/runtime.js'

const environmentPatch = z.object({
  name: z.string().trim().min(1).max(120),
  value: z.string().max(20_000).optional(),
  remove: z.boolean().optional(),
})
const customHeaders = z
  .record(z.string(), z.string())
  .optional()
  .transform((value): AiProviderCustomHeaders => normalizeCustomHeaders(value))
const connection = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('http'),
    url: z
      .string()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), 'HTTP(S) URL required.'),
    headers: customHeaders,
  }),
  z.object({
    transport: z.literal('stdio'),
    command: z.string().trim().min(1),
    args: z.array(z.string().max(2_000)).max(64).optional(),
    cwd: z.string().trim().optional().nullable(),
    env: z.array(environmentPatch).optional(),
  }),
])

export const mcpRouter = router({
  list: adminProcedure.query(({ ctx }) => ctx.services.mcpSettings.list()),
  createServer: adminProcedure
    .input(z.object({ name: z.string().trim().min(1).max(100), connection }))
    .mutation(({ ctx, input }) =>
      ctx.services.mcpSettings.create({ name: input.name, connection: input.connection })
    ),
  updateServer: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(100),
        connection,
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.services.mcpSettings.update({
        id: input.id,
        name: input.name,
        connection: input.connection,
      })
    ),
  deleteServer: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => ctx.services.mcpSettings.delete(input.id)),
  discoverServer: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const tools = await discoverMcpServer(
          await ctx.services.mcpSettings.getRuntimeServer(input.id)
        )
        return await ctx.services.mcpSettings.recordDiscovery(input.id, tools)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'MCP discovery failed.'
        await ctx.services.mcpSettings.recordDiscoveryFailure(input.id, message)
        throw new Error(message)
      }
    }),
  updateToolPolicies: adminProcedure
    .input(
      z.object({
        id: z.string(),
        tools: z.array(
          z.object({ name: z.string(), enabled: z.boolean(), allowInAsk: z.boolean() })
        ),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.services.mcpSettings.updateToolPolicies(input.id, input.tools)
    ),
})

import { z } from 'zod/v4'

const ENTITY_ID_PATTERN = /^[A-Za-z0-9._-]{3,120}$/

export const promptModeSchema = z.enum(['continue', 'prompt', 'chat'])
export type PromptMode = z.infer<typeof promptModeSchema>

export const promptSystemSlotSchema = z.enum(['continue', 'selection-edit', 'chat'])
export type PromptSystemSlot = z.infer<typeof promptSystemSlotSchema>

export const plainTextProtocolSchema = z.object({
  type: z.literal('plain-text-v1'),
})
export type PlainTextProtocol = z.infer<typeof plainTextProtocolSchema>

export const selectionEditProtocolSchema = z.object({
  type: z.literal('selection-edit-v1'),
})
export type SelectionEditProtocol = z.infer<typeof selectionEditProtocolSchema>

export const responseProtocolSchema = z.discriminatedUnion('type', [
  plainTextProtocolSchema,
  selectionEditProtocolSchema,
])
export type ResponseProtocol = z.infer<typeof responseProtocolSchema>

export const promptDefaultsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.85),
  maxOutputTokens: z.number().int().min(1).optional(),
})
export type PromptDefaults = z.infer<typeof promptDefaultsSchema>

export const promptEditableSchema = z.object({
  mode: promptModeSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().default(''),
  systemTemplate: z.string().trim().min(1),
  userTemplate: z.string().trim().min(1),
  protocol: responseProtocolSchema,
  defaults: promptDefaultsSchema,
})
export type PromptEditable = z.infer<typeof promptEditableSchema>

export const promptDefinitionSchema = promptEditableSchema.extend({
  id: z.string().regex(ENTITY_ID_PATTERN),
  isSystem: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})
export type PromptDefinition = z.infer<typeof promptDefinitionSchema>

export const promptBindingsSchema = z.object({
  continuePromptId: z.string().regex(ENTITY_ID_PATTERN).nullable(),
  selectionEditPromptId: z.string().regex(ENTITY_ID_PATTERN).nullable(),
  chatPromptId: z.string().regex(ENTITY_ID_PATTERN).nullable(),
})
export type PromptBindings = z.infer<typeof promptBindingsSchema>

export const promptSummarySchema = z.object({
  id: z.string().regex(ENTITY_ID_PATTERN),
  mode: promptModeSchema,
  name: z.string(),
  updatedAt: z.string().datetime({ offset: true }),
  protocolType: z.string(),
  isBound: z.boolean(),
  isSystem: z.boolean(),
})
export type PromptSummary = z.infer<typeof promptSummarySchema>

export const promptGetInputSchema = z.object({
  id: z.string().regex(ENTITY_ID_PATTERN),
})
export type PromptGetInput = z.infer<typeof promptGetInputSchema>

export const promptCreateInputSchema = z.object({
  prompt: promptEditableSchema,
})
export type PromptCreateInput = z.infer<typeof promptCreateInputSchema>

export const promptUpdateInputSchema = z.object({
  id: z.string().regex(ENTITY_ID_PATTERN),
  prompt: promptEditableSchema,
})
export type PromptUpdateInput = z.infer<typeof promptUpdateInputSchema>

export const promptDeleteInputSchema = z.object({
  id: z.string().regex(ENTITY_ID_PATTERN),
})
export type PromptDeleteInput = z.infer<typeof promptDeleteInputSchema>

export const promptSetBindingInputSchema = z.object({
  slot: promptSystemSlotSchema,
  promptId: z.string().regex(ENTITY_ID_PATTERN).nullable(),
})
export type PromptSetBindingInput = z.infer<typeof promptSetBindingInputSchema>

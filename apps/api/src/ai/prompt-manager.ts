import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import {
  promptBindingsSchema,
  promptDefinitionSchema,
  type PromptBindings,
  type PromptDefinition,
  type PromptEditable,
  type PromptMode,
  type PromptSummary,
  type PromptSystemSlot,
} from '@plotline/shared'
import { configManager } from '../config/manager.js'
import {
  type AiDefaultsOptions,
  createDefaultPromptBindings,
  createDefaultPromptDefinitions,
  modeForSlot,
  slotForMode,
  validatePromptTemplatesForMode,
} from './prompts.js'

function getAiDefaults(): AiDefaultsOptions {
  const ai = configManager.getConfig().ai
  return {
    defaultTemperature: ai.defaultTemperature,
    selectionEditTemperature: ai.selectionEditTemperature,
    defaultMaxOutputTokens: ai.defaultMaxOutputTokens,
  }
}

const PROMPTS_FILE_NAME = 'prompts.json'
const STORE_VERSION = 1

interface PromptStore {
  version: 1
  prompts: PromptDefinition[]
  bindings: PromptBindings
}

type PromptManagerErrorCode = 'NOT_FOUND' | 'BAD_REQUEST'

export class PromptManagerError extends Error {
  readonly code: PromptManagerErrorCode

  constructor(code: PromptManagerErrorCode, message: string) {
    super(message)
    this.name = 'PromptManagerError'
    this.code = code
  }
}

function getPromptsFilePath(): string {
  return path.join(configManager.getConfig().paths.dataDir, PROMPTS_FILE_NAME)
}

function serializeStore(store: PromptStore): string {
  return `${JSON.stringify(store, null, 2)}\n`
}

function writeAtomically(filePath: string, contents: string): void {
  const existingContents = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
  if (existingContents === contents) return

  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true })

  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
  writeFileSync(tempPath, contents, 'utf8')

  try {
    renameSync(tempPath, filePath)
  } catch (error) {
    unlinkSync(tempPath)
    throw error
  }
}

function promptSort(left: PromptDefinition, right: PromptDefinition): number {
  const byUpdated = right.updatedAt.localeCompare(left.updatedAt)
  if (byUpdated !== 0) return byUpdated
  return left.name.localeCompare(right.name)
}

function normalizeStore(store: PromptStore): PromptStore {
  return {
    version: STORE_VERSION,
    prompts: [...store.prompts].sort(promptSort),
    bindings: { ...store.bindings },
  }
}

function ensureDefaultPromptsAndBindings(store: PromptStore): PromptStore {
  const defaults = createDefaultPromptBindings()
  const prompts = [...store.prompts]

  for (const systemPrompt of createDefaultPromptDefinitions(
    new Date().toISOString(),
    getAiDefaults()
  )) {
    if (!prompts.some((prompt) => prompt.id === systemPrompt.id)) {
      prompts.push(systemPrompt)
    }
  }

  const resolveBinding = (
    mode: PromptMode,
    currentId: string | null,
    defaultId: string | null
  ): string | null => {
    if (currentId) {
      const current = prompts.find((prompt) => prompt.id === currentId)
      if (current && current.mode === mode) return currentId
    }

    if (defaultId) {
      const defaultPrompt = prompts.find((prompt) => prompt.id === defaultId)
      if (defaultPrompt && defaultPrompt.mode === mode) return defaultPrompt.id
    }

    return prompts.find((prompt) => prompt.mode === mode)?.id ?? null
  }

  return normalizeStore({
    version: STORE_VERSION,
    prompts,
    bindings: {
      continuePromptId: resolveBinding(
        'continue',
        store.bindings.continuePromptId,
        defaults.continuePromptId
      ),
      selectionEditPromptId: resolveBinding(
        'prompt',
        store.bindings.selectionEditPromptId,
        defaults.selectionEditPromptId
      ),
      chatPromptId: resolveBinding('chat', store.bindings.chatPromptId, defaults.chatPromptId),
    },
  })
}

function parseStoreFile(contents: string): PromptStore | null {
  try {
    const raw = JSON.parse(contents) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const record = raw as Record<string, unknown>
    if (record.version !== STORE_VERSION) return null

    const promptsRaw = record.prompts
    const bindingsRaw = record.bindings
    if (!Array.isArray(promptsRaw)) return null

    const prompts: PromptDefinition[] = []
    for (const entry of promptsRaw) {
      const parsed = promptDefinitionSchema.safeParse(entry)
      if (!parsed.success) return null
      prompts.push(parsed.data)
    }

    const bindings = promptBindingsSchema.safeParse(bindingsRaw)
    if (!bindings.success) return null

    return ensureDefaultPromptsAndBindings({
      version: STORE_VERSION,
      prompts,
      bindings: bindings.data,
    })
  } catch {
    return null
  }
}

function promptEqualsEditable(prompt: PromptDefinition, editable: PromptEditable): boolean {
  return (
    prompt.mode === editable.mode &&
    prompt.name === editable.name &&
    prompt.description === editable.description &&
    prompt.systemTemplate === editable.systemTemplate &&
    prompt.userTemplate === editable.userTemplate &&
    JSON.stringify(prompt.protocol) === JSON.stringify(editable.protocol) &&
    JSON.stringify(prompt.defaults) === JSON.stringify(editable.defaults)
  )
}

function cloneEditable(editable: PromptEditable): PromptEditable {
  return {
    ...editable,
    protocol: { ...editable.protocol },
    defaults: { ...editable.defaults },
  }
}

function clonePrompt(prompt: PromptDefinition): PromptDefinition {
  return {
    ...prompt,
    protocol: { ...prompt.protocol },
    defaults: { ...prompt.defaults },
  }
}

function ensureProtocolCompatible(editable: PromptEditable): void {
  if (editable.mode === 'continue' && editable.protocol.type !== 'plain-text-v1') {
    throw new PromptManagerError(
      'BAD_REQUEST',
      'Continue prompts must use the plain-text-v1 protocol.'
    )
  }
  if (editable.mode === 'prompt' && editable.protocol.type !== 'selection-edit-v1') {
    throw new PromptManagerError(
      'BAD_REQUEST',
      'Selection-edit prompts must use the selection-edit-v1 protocol.'
    )
  }
  if (editable.mode === 'chat' && editable.protocol.type !== 'plain-text-v1') {
    throw new PromptManagerError('BAD_REQUEST', 'Chat prompts must use the plain-text-v1 protocol.')
  }
}

function validateEditableTemplates(editable: PromptEditable): void {
  try {
    validatePromptTemplatesForMode(editable.mode, editable.systemTemplate, editable.userTemplate)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prompt template is invalid.'
    throw new PromptManagerError('BAD_REQUEST', message)
  }
}

function toSummarySet(prompts: PromptDefinition[], bindings: PromptBindings): PromptSummary[] {
  const boundIds = new Set<string>()
  if (bindings.continuePromptId) boundIds.add(bindings.continuePromptId)
  if (bindings.selectionEditPromptId) boundIds.add(bindings.selectionEditPromptId)
  if (bindings.chatPromptId) boundIds.add(bindings.chatPromptId)

  return prompts
    .map((prompt) => ({
      id: prompt.id,
      mode: prompt.mode,
      name: prompt.name,
      updatedAt: prompt.updatedAt,
      protocolType: prompt.protocol.type,
      isBound: boundIds.has(prompt.id),
      isSystem: prompt.isSystem,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function nextCloneName(baseName: string, prompts: PromptDefinition[]): string {
  const normalizedBase = baseName.trim() || 'Custom Prompt'
  const existing = new Set(prompts.map((prompt) => prompt.name.trim().toLowerCase()))

  if (!existing.has(normalizedBase.toLowerCase())) {
    return normalizedBase
  }

  const firstCandidate = `${normalizedBase} (Custom)`
  if (!existing.has(firstCandidate.toLowerCase())) {
    return firstCandidate
  }

  let index = 2
  while (index < 10_000) {
    const candidate = `${normalizedBase} (Custom ${index})`
    if (!existing.has(candidate.toLowerCase())) {
      return candidate
    }
    index += 1
  }

  return `${normalizedBase} (${Date.now()})`
}

class PromptManager {
  private loaded = false
  private store: PromptStore = {
    version: STORE_VERSION,
    prompts: [],
    bindings: {
      continuePromptId: null,
      selectionEditPromptId: null,
      chatPromptId: null,
    },
  }

  private ensureLoaded(): void {
    if (this.loaded) return

    const filePath = getPromptsFilePath()
    const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
    const parsed = existing ? parseStoreFile(existing) : null

    if (parsed) {
      this.store = ensureDefaultPromptsAndBindings(parsed)
      this.loaded = true
      this.persist()
      return
    }

    const nowIso = new Date().toISOString()
    this.store = normalizeStore({
      version: STORE_VERSION,
      prompts: createDefaultPromptDefinitions(nowIso, getAiDefaults()),
      bindings: createDefaultPromptBindings(),
    })
    this.persist()
    this.loaded = true
  }

  private persist(): void {
    const filePath = getPromptsFilePath()
    this.store = normalizeStore(this.store)
    writeAtomically(filePath, serializeStore(this.store))
  }

  listSummaries() {
    this.ensureLoaded()
    return {
      prompts: toSummarySet(this.store.prompts, this.store.bindings),
      bindings: { ...this.store.bindings },
    }
  }

  getPrompt(id: string): PromptDefinition | null {
    this.ensureLoaded()
    const found = this.store.prompts.find((prompt) => prompt.id === id)
    return found ? clonePrompt(found) : null
  }

  createPrompt(editable: PromptEditable): PromptDefinition {
    this.ensureLoaded()
    ensureProtocolCompatible(editable)
    validateEditableTemplates(editable)
    const editableCopy = cloneEditable(editable)

    const nowIso = new Date().toISOString()
    const prompt: PromptDefinition = {
      id: nanoid(),
      ...editableCopy,
      isSystem: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    this.store.prompts.push(prompt)
    this.persist()
    return clonePrompt(prompt)
  }

  updatePrompt(
    id: string,
    editable: PromptEditable
  ): { prompt: PromptDefinition; changed: boolean; clonedFromSystem: boolean } {
    this.ensureLoaded()
    ensureProtocolCompatible(editable)
    validateEditableTemplates(editable)
    const editableCopy = cloneEditable(editable)

    const index = this.store.prompts.findIndex((prompt) => prompt.id === id)
    if (index < 0) {
      throw new PromptManagerError('NOT_FOUND', `Prompt ${id} not found`)
    }

    const current = this.store.prompts[index]
    if (editableCopy.mode !== current.mode) {
      throw new PromptManagerError('BAD_REQUEST', 'Prompt mode cannot be changed after creation.')
    }

    if (current.isSystem) {
      const nowIso = new Date().toISOString()
      const cloneName = nextCloneName(editableCopy.name, this.store.prompts)
      const cloned: PromptDefinition = {
        id: nanoid(),
        ...editableCopy,
        name: cloneName,
        isSystem: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      this.store.prompts.push(cloned)
      const slot = slotForMode(current.mode)
      if (slot === 'continue') {
        this.store.bindings.continuePromptId = cloned.id
      } else if (slot === 'selection-edit') {
        this.store.bindings.selectionEditPromptId = cloned.id
      } else {
        this.store.bindings.chatPromptId = cloned.id
      }
      this.persist()
      return { prompt: clonePrompt(cloned), changed: true, clonedFromSystem: true }
    }

    if (promptEqualsEditable(current, editableCopy)) {
      return { prompt: clonePrompt(current), changed: false, clonedFromSystem: false }
    }

    const updated: PromptDefinition = {
      ...current,
      ...editableCopy,
      updatedAt: new Date().toISOString(),
    }
    this.store.prompts[index] = updated
    this.persist()
    return { prompt: clonePrompt(updated), changed: true, clonedFromSystem: false }
  }

  deletePrompt(id: string): { deletedId: string; bindings: PromptBindings } {
    this.ensureLoaded()
    const target = this.store.prompts.find((prompt) => prompt.id === id)
    if (!target) {
      throw new PromptManagerError('NOT_FOUND', `Prompt ${id} not found`)
    }
    if (target.isSystem) {
      throw new PromptManagerError('BAD_REQUEST', 'System default prompts cannot be deleted.')
    }

    this.store.prompts = this.store.prompts.filter((prompt) => prompt.id !== id)

    const continueFallback =
      this.store.prompts.find((prompt) => prompt.mode === 'continue')?.id ?? null
    const selectionFallback =
      this.store.prompts.find((prompt) => prompt.mode === 'prompt')?.id ?? null
    const chatFallback = this.store.prompts.find((prompt) => prompt.mode === 'chat')?.id ?? null

    if (this.store.bindings.continuePromptId === id) {
      this.store.bindings.continuePromptId = continueFallback
    }
    if (this.store.bindings.selectionEditPromptId === id) {
      this.store.bindings.selectionEditPromptId = selectionFallback
    }
    if (this.store.bindings.chatPromptId === id) {
      this.store.bindings.chatPromptId = chatFallback
    }

    this.persist()
    return { deletedId: id, bindings: { ...this.store.bindings } }
  }

  setBinding(
    slot: PromptSystemSlot,
    promptId: string | null
  ): { bindings: PromptBindings; changed: boolean } {
    this.ensureLoaded()

    if (promptId !== null) {
      const prompt = this.store.prompts.find((entry) => entry.id === promptId)
      if (!prompt) {
        throw new PromptManagerError('NOT_FOUND', `Prompt ${promptId} not found`)
      }
      const expectedMode = modeForSlot(slot)
      if (prompt.mode !== expectedMode) {
        throw new PromptManagerError(
          'BAD_REQUEST',
          `Cannot bind ${slot} to prompt "${prompt.name}" (${prompt.mode}). Expected mode ${expectedMode}.`
        )
      }
    }

    const current =
      slot === 'continue'
        ? this.store.bindings.continuePromptId
        : slot === 'selection-edit'
          ? this.store.bindings.selectionEditPromptId
          : this.store.bindings.chatPromptId
    if (current === promptId) {
      return { bindings: { ...this.store.bindings }, changed: false }
    }

    if (slot === 'continue') this.store.bindings.continuePromptId = promptId
    else if (slot === 'selection-edit') this.store.bindings.selectionEditPromptId = promptId
    else this.store.bindings.chatPromptId = promptId
    this.persist()

    return { bindings: { ...this.store.bindings }, changed: true }
  }

  resolvePromptForMode(mode: PromptMode): PromptDefinition {
    this.ensureLoaded()
    const slot = slotForMode(mode)
    const boundId =
      slot === 'continue'
        ? this.store.bindings.continuePromptId
        : slot === 'selection-edit'
          ? this.store.bindings.selectionEditPromptId
          : this.store.bindings.chatPromptId

    if (boundId) {
      const boundPrompt = this.store.prompts.find((prompt) => prompt.id === boundId)
      if (boundPrompt && boundPrompt.mode === mode) {
        return clonePrompt(boundPrompt)
      }
    }

    const fallback = this.store.prompts.find((prompt) => prompt.mode === mode)
    if (fallback) return clonePrompt(fallback)

    throw new Error(`No prompt configured for mode "${mode}"`)
  }
}

export const promptManager = new PromptManager()

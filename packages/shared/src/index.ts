export type { Project } from './project.js'
export type { Document } from './document.js'
export type { JsonObject, JsonValue } from './json.js'
export { isJsonObject } from './json.js'
export { isValidId, authPasswordSchema } from './validators.js'
export { schema } from './schema.js'
export { parseContent, createDefaultContent } from './content.js'
export {
  markdownToProseMirrorDoc,
  proseMirrorDocToMarkdown,
  type MarkdownParseError,
  type MarkdownResult,
} from './markdown.js'
export {
  parseMarkdownishToFragment,
  parseMarkdownishToSlice,
  type MarkdownishSliceOptions,
} from './markdownish.js'
export {
  DIRECTORY_SENTINEL_NAME,
  normalizeDocumentPath,
  pathSegments,
  parentDocumentPath,
  pathHasSentinelSegment,
  isDirectorySentinelPath,
  directoryPathFromSentinel,
  toDirectorySentinelPath,
  isPathInsideDirectory,
  remapPathInsideDirectory,
} from './document-path.js'
export type {
  AiModelSourceType,
  PersistedAppConfig,
  PersistedConfigKey,
  PersistedConfigSection,
  ConfigValueKind,
  ConfigFieldDefinition,
  EditableConfigInput,
  LimitsConfig,
} from './config.js'
export {
  AI_MODEL_SOURCE_TYPES,
  CONFIG_FIELD_DEFINITIONS,
  CONFIG_FIELD_BY_KEY,
  PERSISTED_CONFIG_KEYS,
  DEFAULT_PERSISTED_CONFIG,
  EDITABLE_CONFIG_KEYS,
  LIMITS_CONFIG_KEYS,
  editableConfigSchema,
} from './config.js'
export type { ParsedBaseURLResult } from './ai-provider.js'
export {
  AI_PROVIDER_DEFAULT_BASE_URLS,
  normalizeModelSourceType,
  normalizeBaseURL,
  isSameBaseURL,
  parseAndNormalizeHttpBaseURL,
  normalizeProviderBaseURL,
} from './ai-provider.js'
export type {
  PromptMode,
  PromptSystemSlot,
  PlainTextProtocol,
  SelectionEditProtocol,
  ResponseProtocol,
  PromptDefaults,
  PromptEditable,
  PromptDefinition,
  PromptBindings,
  PromptGetInput,
  PromptCreateInput,
  PromptUpdateInput,
  PromptDeleteInput,
  PromptSetBindingInput,
  PromptSummary,
} from './prompts.js'
export {
  promptModeSchema,
  promptSystemSlotSchema,
  plainTextProtocolSchema,
  selectionEditProtocolSchema,
  responseProtocolSchema,
  promptDefaultsSchema,
  promptEditableSchema,
  promptDefinitionSchema,
  promptBindingsSchema,
  promptGetInputSchema,
  promptCreateInputSchema,
  promptUpdateInputSchema,
  promptDeleteInputSchema,
  promptSetBindingInputSchema,
  promptSummarySchema,
} from './prompts.js'
export type {
  InlineZoneReplaceAction,
  InlineZoneChoicesAction,
  InlineZoneWriteAction,
} from './inline-ai.js'
export {
  INLINE_AI_MAX_ZONE_CHOICES,
  INLINE_AI_DEFAULT_TOOL_STEP_LIMIT,
  inlineZoneWriteToolInputSchema,
  inlineZoneChoicesToolInputSchema,
  normalizeInlineZoneChoices,
  parseInlineZoneWriteAction,
} from './inline-ai.js'
export type { InlineToolChip, InlineChatMessage, InlineZoneSession } from './inline-ai-session.js'
export { normalizeInlineZoneSession, normalizeInlineZoneSessionMap } from './inline-ai-session.js'
export type { AIZoneAttrs } from './ai-zone-utils.js'
export {
  readTrimmedString,
  hasMeaningfulGap,
  parseZoneNodeAttrs,
  createWrappedZoneSliceFromText,
  wrapFragmentWithZoneNodes,
  wrapNodeWithZoneNodes,
  wrapSliceWithZoneNodes,
} from './ai-zone-utils.js'

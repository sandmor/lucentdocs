import type { AiModelSourceType, EditableConfigInput } from '@lucentdocs/shared'

export type ConfigFormValues = EditableConfigInput
export type EditableFieldKey = keyof ConfigFormValues
export type NumberFieldKey = {
  [Key in EditableFieldKey]: ConfigFormValues[Key] extends number ? Key : never
}[EditableFieldKey]
export type VisibleNumberFieldKey = NumberFieldKey

export type FieldSource = 'env' | 'database' | 'default'
export type ConfigFieldPayload = {
  effectiveValue: string | number | boolean
  persistedValue: string | number | boolean | null
  source: FieldSource
  isOverridden: boolean
}
export type RuntimeFieldKey = 'host' | 'port' | 'nodeEnv'
export type ConfigQueryData = {
  fields: Record<EditableFieldKey | RuntimeFieldKey, ConfigFieldPayload>
  runtime: {
    nodeEnv: string
    host: string
    port: number
    dataDir: string
    isLoopbackHost: boolean
  }
}

export type AiProviderType = AiModelSourceType

export type AiProviderDraft = {
  id: string
  providerId: string
  type: AiProviderType
  baseURL: string
  model: string
  apiKeyId: string | null
}

export type AiApiKeySummary = {
  id: string
  baseURL: string
  name: string
  maskedKey: string
  isDefault: boolean
}

export type ModelCatalogModel = {
  id: string
  name: string | null
  releaseDate: string | null
}

export type ModelCatalogProviderSummary = {
  id: string
  name: string
  type: AiProviderType
  iconURL: string
  docURL: string | null
  apiBaseURL: string
}

export type ModelCatalogProvider = ModelCatalogProviderSummary & {
  models: ModelCatalogModel[]
}

export type SourceModelCatalogResult = {
  provider: ModelCatalogProvider
  source: 'models.dev' | 'provider'
  warning: string | null
}

export type OptionItem = {
  value: string
  label: string
}

export type ProviderOption = OptionItem & {
  type: AiProviderType
  apiBaseURL: string
  iconURL: string
  docURL: string | null
}

export type ProviderWithCatalog = {
  provider: AiProviderDraft
  catalog: ModelCatalogProviderSummary | ModelCatalogProvider | null
  catalogSource: 'models.dev' | 'provider'
  warning: string | null
  isCatalogLoading: boolean
}

export type AiDraftState = {
  providers: AiProviderDraft[]
  activeProviderId: string | null
}

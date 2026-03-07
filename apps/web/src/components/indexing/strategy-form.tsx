import { useEffect, useMemo, useState } from 'react'
import type {
  IndexingStrategy,
  IndexingStrategyScopeType,
  SlidingWindowLevel,
} from '@lucentdocs/shared'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Info } from 'lucide-react'

interface DraftState {
  mode: 'inherit' | 'custom'
  type: IndexingStrategy['type']
  level: SlidingWindowLevel
  windowSize: string
  stride: string
  minUnitChars?: string
  maxUnitChars?: string
}

interface IndexingStrategyFormProps {
  directStrategy: IndexingStrategy | null
  resolvedStrategy: IndexingStrategy
  resolvedScopeType: IndexingStrategyScopeType
  allowInherit: boolean
  isSaving?: boolean
  onSave: (strategy: IndexingStrategy | null) => void
  saveLabel?: string
  compact?: boolean
}

function scopeLabel(scopeType: IndexingStrategyScopeType): string {
  switch (scopeType) {
    case 'global':
      return 'global settings'
    case 'user':
      return 'user settings'
    case 'project':
      return 'project settings'
    case 'document':
      return 'document settings'
  }
}

function defaultSlidingValues(
  level: SlidingWindowLevel
): Pick<DraftState, 'level' | 'windowSize' | 'stride' | 'minUnitChars' | 'maxUnitChars'> {
  switch (level) {
    case 'sentence':
      return {
        level,
        windowSize: '5',
        stride: '3',
        minUnitChars: '20',
        maxUnitChars: '500',
      }
    case 'paragraph':
      return {
        level,
        windowSize: '3',
        stride: '2',
        minUnitChars: '300',
        maxUnitChars: '2000',
      }
    case 'character':
      return {
        level,
        windowSize: '2000',
        stride: '1000',
      }
  }
}

function createDraft(
  directStrategy: IndexingStrategy | null,
  resolvedStrategy: IndexingStrategy,
  allowInherit: boolean
): DraftState {
  const source = directStrategy ?? resolvedStrategy

  if (source.type === 'sliding_window') {
    if (source.properties.level === 'character') {
      return {
        mode: allowInherit && directStrategy === null ? 'inherit' : 'custom',
        level: 'character',
        type: source.type,
        windowSize: String(source.properties.windowSize),
        stride: String(source.properties.stride),
      }
    }

    return {
      mode: allowInherit && directStrategy === null ? 'inherit' : 'custom',
      level: source.properties.level,
      type: source.type,
      windowSize: String(source.properties.windowSize),
      stride: String(source.properties.stride),
      minUnitChars: String(source.properties.minUnitChars),
      maxUnitChars: String(source.properties.maxUnitChars),
    }
  }

  return {
    mode: allowInherit && directStrategy === null ? 'inherit' : 'custom',
    type: source.type,
    ...defaultSlidingValues('character'),
  }
}

function buildStrategy(draft: DraftState, allowInherit: boolean): IndexingStrategy | null {
  if (allowInherit && draft.mode === 'inherit') {
    return null
  }

  if (draft.type === 'whole_document') {
    return {
      type: 'whole_document',
      properties: {},
    }
  }

  return {
    type: 'sliding_window',
    properties:
      draft.level === 'character'
        ? {
            level: 'character',
            windowSize: Number.parseInt(draft.windowSize, 10),
            stride: Number.parseInt(draft.stride, 10),
          }
        : {
            level: draft.level,
            windowSize: Number.parseInt(draft.windowSize, 10),
            stride: Number.parseInt(draft.stride, 10),
            minUnitChars: Number.parseInt(draft.minUnitChars!, 10),
            maxUnitChars: Number.parseInt(draft.maxUnitChars!, 10),
          },
  }
}

function serializeStrategy(strategy: IndexingStrategy | null): string {
  return JSON.stringify(strategy)
}

function FieldLabelWithTooltip({
  htmlFor,
  label,
  tooltip,
}: {
  htmlFor: string
  label: string
  tooltip: string
}) {
  return (
    <div className="flex items-center gap-1">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      <Tooltip>
        <TooltipTrigger className="text-muted-foreground/50 hover:text-muted-foreground cursor-default">
          <Info className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function IndexingStrategyForm({
  directStrategy,
  resolvedStrategy,
  resolvedScopeType,
  allowInherit,
  isSaving = false,
  onSave,
  saveLabel = 'Save',
  compact = false,
}: IndexingStrategyFormProps) {
  const [draft, setDraft] = useState<DraftState>(() =>
    createDraft(directStrategy, resolvedStrategy, allowInherit)
  )

  useEffect(() => {
    setDraft(createDraft(directStrategy, resolvedStrategy, allowInherit))
  }, [allowInherit, directStrategy, resolvedStrategy])

  const nextStrategy = useMemo(() => buildStrategy(draft, allowInherit), [allowInherit, draft])
  const directSerialized = useMemo(() => serializeStrategy(directStrategy), [directStrategy])
  const nextSerialized = useMemo(() => serializeStrategy(nextStrategy), [nextStrategy])
  const isDirty = directSerialized !== nextSerialized

  const unitLabel = draft.level === 'character' ? 'characters' : `${draft.level}s`

  const validationError = useMemo(() => {
    if (allowInherit && draft.mode === 'inherit') {
      return null
    }

    if (draft.type !== 'sliding_window') {
      return null
    }

    const windowSize = Number.parseInt(draft.windowSize, 10)
    const stride = Number.parseInt(draft.stride, 10)

    if (!Number.isInteger(windowSize) || windowSize < 1) {
      return 'Window size must be a positive integer.'
    }

    if (!Number.isInteger(stride) || stride < 1) {
      return 'Stride must be a positive integer.'
    }

    if (stride > windowSize) {
      return 'Stride must be less than or equal to window size.'
    }

    if (draft.level === 'character') {
      return null
    }

    const minUnitChars = Number.parseInt(draft.minUnitChars!, 10)
    const maxUnitChars = Number.parseInt(draft.maxUnitChars!, 10)

    if (!Number.isInteger(minUnitChars) || minUnitChars < 1) {
      return 'Minimum length must be a positive integer.'
    }

    if (!Number.isInteger(maxUnitChars) || maxUnitChars < 1) {
      return 'Maximum length must be a positive integer.'
    }

    if (minUnitChars > maxUnitChars) {
      return 'Minimum length must be less than or equal to maximum length.'
    }

    return null
  }, [allowInherit, draft])

  return (
    <form
      className={compact ? 'space-y-4' : 'space-y-5'}
      onSubmit={(event) => {
        event.preventDefault()
        if (validationError) return
        onSave(nextStrategy)
      }}
    >
      {!(allowInherit && draft.mode === 'inherit') && draft.type === 'sliding_window' ? (
        <p className="text-muted-foreground text-sm">
          Character limits use Unicode characters. Window size and stride use {unitLabel}.
        </p>
      ) : null}

      {allowInherit ? (
        <Field>
          <FieldLabel htmlFor="strategy-mode">Mode</FieldLabel>
          <FieldContent>
            <Select
              value={draft.mode}
              items={{
                inherit: `Inherit from ${scopeLabel(resolvedScopeType)}`,
                custom: 'Custom override',
              }}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  mode: value === 'inherit' ? 'inherit' : 'custom',
                }))
              }
            >
              <SelectTrigger id="strategy-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">
                  Inherit from {scopeLabel(resolvedScopeType)}
                </SelectItem>
                <SelectItem value="custom">Custom override</SelectItem>
              </SelectContent>
            </Select>
            {!compact && (
              <FieldDescription>
                Inherit to follow the next less specific scope automatically.
              </FieldDescription>
            )}
          </FieldContent>
        </Field>
      ) : null}

      {!(allowInherit && draft.mode === 'inherit') ? (
        <>
          <Field>
            {compact ? (
              <FieldLabelWithTooltip
                htmlFor="strategy-type"
                label="Strategy"
                tooltip="Whole document creates one embedding. Sliding window can chunk by character, sentence, or paragraph with unit overlap."
              />
            ) : (
              <FieldLabel htmlFor="strategy-type">Strategy</FieldLabel>
            )}
            <FieldContent>
              <Select
                value={draft.type}
                items={{
                  whole_document: 'Whole document',
                  sliding_window: 'Sliding window',
                }}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    type: value === 'whole_document' ? 'whole_document' : 'sliding_window',
                  }))
                }
              >
                <SelectTrigger id="strategy-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whole_document">Whole document</SelectItem>
                  <SelectItem value="sliding_window">Sliding window</SelectItem>
                </SelectContent>
              </Select>
              {!compact && (
                <FieldDescription>
                  Whole document creates one embedding. Sliding window can chunk by character,
                  sentence, or paragraph with unit overlap.
                </FieldDescription>
              )}
            </FieldContent>
          </Field>

          {draft.type === 'sliding_window' ? (
            <>
              <Field>
                {compact ? (
                  <FieldLabelWithTooltip
                    htmlFor="strategy-level"
                    label="Segmentation level"
                    tooltip="Sentence mode uses Unicode sentence boundaries. Paragraph mode splits on blank lines, then applies sliding windows over those units."
                  />
                ) : (
                  <FieldLabel htmlFor="strategy-level">Segmentation level</FieldLabel>
                )}
                <FieldContent>
                  <Select
                    value={draft.level}
                    items={{
                      character: 'Character',
                      sentence: 'Sentence',
                      paragraph: 'Paragraph',
                    }}
                    onValueChange={(value) => {
                      const nextLevel =
                        value === 'sentence' || value === 'paragraph' ? value : 'character'
                      setDraft((current) => ({
                        ...current,
                        ...defaultSlidingValues(nextLevel),
                      }))
                    }}
                  >
                    <SelectTrigger id="strategy-level" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="character">Character</SelectItem>
                      <SelectItem value="sentence">Sentence</SelectItem>
                      <SelectItem value="paragraph">Paragraph</SelectItem>
                    </SelectContent>
                  </Select>
                  {!compact && (
                    <FieldDescription>
                      Sentence mode uses Unicode sentence boundaries. Paragraph mode splits on blank
                      lines, then applies sliding windows over those units.
                    </FieldDescription>
                  )}
                </FieldContent>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="strategy-window-size">Window size</FieldLabel>
                  <FieldContent>
                    <Input
                      id="strategy-window-size"
                      type="number"
                      min={1}
                      value={draft.windowSize}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          windowSize: event.target.value,
                        }))
                      }
                    />
                    {!compact && (
                      <FieldDescription>
                        Number of {unitLabel} in each base sliding window.
                      </FieldDescription>
                    )}
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="strategy-stride">Stride</FieldLabel>
                  <FieldContent>
                    <Input
                      id="strategy-stride"
                      type="number"
                      min={1}
                      value={draft.stride}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          stride: event.target.value,
                        }))
                      }
                    />
                    {!compact && (
                      <FieldDescription>
                        Number of {unitLabel} to move before creating the next window.
                      </FieldDescription>
                    )}
                  </FieldContent>
                </Field>
              </div>

              {draft.level !== 'character' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    {compact ? (
                      <FieldLabelWithTooltip
                        htmlFor="strategy-min-unit-chars"
                        label="Minimum length"
                        tooltip="If the window is too short in characters, extend it forward until this is reached."
                      />
                    ) : (
                      <FieldLabel htmlFor="strategy-min-unit-chars">Minimum length</FieldLabel>
                    )}
                    <FieldContent>
                      <Input
                        id="strategy-min-unit-chars"
                        type="number"
                        min={1}
                        value={draft.minUnitChars ?? ''}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            minUnitChars: event.target.value,
                          }))
                        }
                      />
                      {!compact && (
                        <FieldDescription>
                          If the window is too short in characters, extend it forward until this is
                          reached.
                        </FieldDescription>
                      )}
                    </FieldContent>
                  </Field>

                  <Field>
                    {compact ? (
                      <FieldLabelWithTooltip
                        htmlFor="strategy-max-unit-chars"
                        label="Maximum length"
                        tooltip="If the window is too long, trim at level boundaries first, then fall back to a character cut only when necessary."
                      />
                    ) : (
                      <FieldLabel htmlFor="strategy-max-unit-chars">Maximum length</FieldLabel>
                    )}
                    <FieldContent>
                      <Input
                        id="strategy-max-unit-chars"
                        type="number"
                        min={1}
                        value={draft.maxUnitChars ?? ''}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            maxUnitChars: event.target.value,
                          }))
                        }
                      />
                      {!compact && (
                        <FieldDescription>
                          If the window is too long, trim at level boundaries first, then fall back
                          to a character cut only when necessary.
                        </FieldDescription>
                      )}
                    </FieldContent>
                  </Field>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {validationError ? <p className="text-destructive text-sm">{validationError}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDraft(createDraft(directStrategy, resolvedStrategy, allowInherit))}
          disabled={isSaving || !isDirty}
        >
          Reset
        </Button>
        <Button type="submit" disabled={isSaving || !isDirty || validationError !== null}>
          {isSaving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </form>
  )
}

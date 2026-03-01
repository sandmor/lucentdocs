import type {
  PromptDefinition,
  PromptEditable,
  PromptMode,
  PromptSystemSlot,
  SelectionEditProtocol,
  ResponseProtocol,
} from '@plotline/shared'

export const SYSTEM_CONTINUE_PROMPT_ID = 'system.continue.default'
export const SYSTEM_SELECTION_PROMPT_ID = 'system.selection-edit.default'
export const SYSTEM_CHAT_PROMPT_ID = 'system.chat.default'

export const WRITING_GAP_MARKER = '<plotline_writing_gap_v1 />'
export const ESCAPED_WRITING_GAP_MARKER = '<plotline_writing_gap_escaped_v1 />'

export const DEFAULT_SELECTION_EDIT_PROTOCOL: SelectionEditProtocol = {
  type: 'selection-edit-v1',
}

const TEMPLATE_IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
const TEMPLATE_REFERENCE_PATTERN = /{{\s*([^{}]+?)\s*}}/g

const MODE_TEMPLATE_VARIABLES: Record<PromptMode, readonly string[]> = {
  continue: ['contextBefore', 'gapMarker', 'contextAfter', 'instruction', 'authorHintSection'],
  prompt: ['wrappedContext', 'modeGuidance', 'prompt', 'conversation'],
  chat: ['currentFilePath', 'currentFileContent', 'chatInstruction', 'conversation'],
}

const SYSTEM_PROMPT_CONTINUE = `You are a skilled fiction writing assistant helping an author write a novel. Your role is to:
- Write in a style consistent with the existing text
- Maintain narrative voice, tone, and pacing
- Continue the story naturally when asked
- Provide creative suggestions that fit the story's direction
- Write only prose - no meta-commentary, no explanations, no markdown formatting
- Never break character or acknowledge that you are an AI

OUTPUT RULES:
- Output ONLY the new text to insert at the <writing_gap /> marker
- NEVER repeat or include any text from before or after the gap
- NEVER include the <writing_gap /> marker itself in your output

Example:
Context: "John walked into the room. <writing_gap /> The door slammed behind him."
Good output: "He froze, sensing something was wrong. "
Bad output: "John walked into the room. He froze... The door slammed behind him."

When continuing text, seamlessly pick up from where the author left off.
When given a prompt about what to write, produce the requested prose in a style matching the existing text.`

const SYSTEM_PROMPT_STRUCTURED = `You are Plotline's inline AI writing assistant for editing the active AI zone.

Behavior goals:
- Prefer acting through tools, not explanations.
- On the first response, perform an action immediately whenever possible.
- Keep writing style aligned with the surrounding narrative voice and pacing.

TOOLS:
- read-only tools (project inspection): list_files, read_file
- zone-write tools:
  - write_zone: mutate only a range inside the active AI zone using fromOffset/toOffset + content
  - write_zone_choices: provide multiple alternatives for the active AI zone

ZONE BOUNDARY MODEL:
- Treat the active AI zone as the exact text between <selection> and </selection> in story_context.
- write_zone offsets are relative only to that selected text.
- You cannot edit any text outside the selected span. This includes nearby words, sentences, and paragraph context.
- If user asks for broader edits (sentence/paragraph/document) outside the selected span, ask them to expand selection first.

STRICT SAFETY:
- You may only edit the active AI zone via write tools.
- Never request or imply edits outside the active AI zone.
- Prefer one decisive write action over long back-and-forth.

RESPONSE STYLE:
- If a write tool fully satisfies the request, keep text output minimal.
- If clarification is required, ask one short follow-up question.
- Never output markdown code fences for normal replies.`

const SYSTEM_PROMPT_CHAT = `You are Plotline's sidebar AI assistant for software projects.

You can inspect project files via tools and should use them when needed.

Core behavior:
- Be accurate and concrete.
- If you cite documents, mention exact file paths.
- Prefer short, directly actionable answers unless the user asks for depth.
- Never invent file contents. If needed, call tools first.
- Do not claim access to other projects files; only this project documents are available through tools.

When tool output is incomplete, state what is missing and what to inspect next.

CONTEXT MARKERS:
The active file content may contain special markers indicating the user's cursor context:
- <selection>text</selection> — the text currently selected by the user
- <caret /> — the cursor position when no text is selected`

const CONTINUE_USER_TEMPLATE = `Story context:

<context_before>
{{contextBefore}}
</context_before>

{{gapMarker}}

<context_after>
{{contextAfter}}
</context_after>

Task:
{{instruction}}

{{authorHintSection}}`

const PROMPT_USER_TEMPLATE = `Story context:

<story_context>
{{wrappedContext}}
</story_context>

{{modeGuidance}}

The author requests:
{{prompt}}

Conversation so far:
{{conversation}}

Prefer a direct tool action in your first assistant turn.`

const CHAT_USER_TEMPLATE = `Active file path:
{{currentFilePath}}

Active file content:
{{currentFileContent}}

Guidance:
{{chatInstruction}}

Conversation so far:
{{conversation}}`

function sanitizeContext(context: string): string {
  return context.replaceAll(WRITING_GAP_MARKER, ESCAPED_WRITING_GAP_MARKER)
}

function createPromptDefinition(
  nowIso: string,
  id: string,
  editable: PromptEditable,
  isSystem = false
): PromptDefinition {
  return {
    id,
    ...editable,
    isSystem,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

export function createDefaultPromptDefinitions(nowIso: string): PromptDefinition[] {
  return [
    createPromptDefinition(
      nowIso,
      SYSTEM_CONTINUE_PROMPT_ID,
      {
        mode: 'continue',
        name: 'Default Continue',
        description: 'Continuation prompt used for Ctrl/Cmd+Enter drafting.',
        systemTemplate: SYSTEM_PROMPT_CONTINUE,
        userTemplate: CONTINUE_USER_TEMPLATE,
        protocol: {
          type: 'plain-text-v1',
        },
        defaults: {
          temperature: 0.85,
        },
      },
      true
    ),
    createPromptDefinition(
      nowIso,
      SYSTEM_SELECTION_PROMPT_ID,
      {
        mode: 'prompt',
        name: 'Default Selection Edit',
        description: 'Selection toolbar prompt that returns replace/insert/choices output.',
        systemTemplate: SYSTEM_PROMPT_STRUCTURED,
        userTemplate: PROMPT_USER_TEMPLATE,
        protocol: DEFAULT_SELECTION_EDIT_PROTOCOL,
        defaults: {
          temperature: 0.85,
        },
      },
      true
    ),
    createPromptDefinition(
      nowIso,
      SYSTEM_CHAT_PROMPT_ID,
      {
        mode: 'chat',
        name: 'Default Chat',
        description: 'Sidebar chat prompt with project-file tool usage guidance.',
        systemTemplate: SYSTEM_PROMPT_CHAT,
        userTemplate: CHAT_USER_TEMPLATE,
        protocol: {
          type: 'plain-text-v1',
        },
        defaults: {
          temperature: 0.5,
          maxOutputTokens: 2048,
        },
      },
      true
    ),
  ]
}

export function createDefaultPromptBindings() {
  return {
    continuePromptId: SYSTEM_CONTINUE_PROMPT_ID,
    selectionEditPromptId: SYSTEM_SELECTION_PROMPT_ID,
    chatPromptId: SYSTEM_CHAT_PROMPT_ID,
  }
}

export function slotForMode(mode: PromptMode): PromptSystemSlot {
  if (mode === 'continue') return 'continue'
  if (mode === 'prompt') return 'selection-edit'
  return 'chat'
}

export function modeForSlot(slot: PromptSystemSlot): PromptMode {
  if (slot === 'continue') return 'continue'
  if (slot === 'selection-edit') return 'prompt'
  return 'chat'
}

export function getTemplateVariablesForMode(mode: PromptMode): readonly string[] {
  return MODE_TEMPLATE_VARIABLES[mode]
}

export function validateTemplateReferencesForMode(
  mode: PromptMode,
  templateName: string,
  template: string
): void {
  const allowed = new Set(getTemplateVariablesForMode(mode))

  for (const match of template.matchAll(TEMPLATE_REFERENCE_PATTERN)) {
    const variableName = match[1].trim()
    if (!TEMPLATE_IDENTIFIER_PATTERN.test(variableName)) {
      throw new Error(
        `Invalid template variable "${variableName}" in ${templateName}. Variable names must match ${TEMPLATE_IDENTIFIER_PATTERN.source}.`
      )
    }
    if (!allowed.has(variableName)) {
      const allowedList = getTemplateVariablesForMode(mode).join(', ')
      throw new Error(
        `Unknown template variable "${variableName}" in ${templateName} for mode "${mode}". Allowed variables: ${allowedList}.`
      )
    }
  }
}

export function validatePromptTemplatesForMode(
  mode: PromptMode,
  systemTemplate: string,
  userTemplate: string
): void {
  validateTemplateReferencesForMode(mode, 'systemTemplate', systemTemplate)
  validateTemplateReferencesForMode(mode, 'userTemplate', userTemplate)
}

export function buildContinueVariables(
  contextBefore: string,
  contextAfter: string | null,
  hint?: string
): Record<string, string> {
  const safeContextBefore = sanitizeContext(contextBefore)
  const safeContextAfter = sanitizeContext(contextAfter ?? '')
  const instruction = safeContextAfter
    ? `Write at the ${WRITING_GAP_MARKER} marker, bridging naturally into the provided right-side context.`
    : 'Continue writing the next part of the story naturally.'

  return {
    contextBefore: safeContextBefore,
    gapMarker: WRITING_GAP_MARKER,
    contextAfter: safeContextAfter,
    instruction,
    authorHintSection: hint?.trim()
      ? `Author hint:\n${hint.trim()}`
      : 'Author hint:\n(no additional hint provided)',
  }
}

export function buildPromptVariables(
  contextBefore: string,
  contextAfter: string | null,
  prompt: string,
  selectedText: string | null = null,
  conversation = ''
): Record<string, string> {
  const safeContextBefore = sanitizeContext(contextBefore)
  const safeContextAfter = sanitizeContext(contextAfter ?? '')
  const safeSelectedText = selectedText ?? ''
  const wrappedContext = safeSelectedText
    ? `${safeContextBefore}<selection>${safeSelectedText}</selection>${safeContextAfter}`
    : `${safeContextBefore}<caret />${safeContextAfter}`
  const modeGuidance = selectedText
    ? `MODE GUIDANCE:
  - The selected text is the only writable area.
  - Use write_zone with fromOffset/toOffset relative to <selection> content only.
  - For full selection rewrite, replace the whole selected range.
  - For alternatives/options, use write_zone_choices.
  - If asked to change surrounding paragraph/context outside selection, ask user to expand selection.`
    : `MODE GUIDANCE:
   - <selection> may represent the current AI zone text.
   - Use write_zone for direct insertion or replacement in the selected span only.
   - Use write_zone_choices when user asks for alternatives.
   - Never assume write tools can change outside selected text.`

  return {
    wrappedContext,
    modeGuidance,
    prompt,
    conversation: conversation.trim() || '(no prior inline conversation)',
  }
}

export function buildChatVariables(
  currentFilePath: string,
  currentFileContent: string,
  conversation: string
): Record<string, string> {
  return {
    currentFilePath: currentFilePath.trim() || '(untitled)',
    currentFileContent: sanitizeContext(currentFileContent),
    chatInstruction:
      'Use project tools when you need to inspect files. Keep answers grounded in available project documents.',
    conversation: conversation.trim() || '(no prior messages)',
  }
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  const availableVariables = new Set(Object.keys(variables))
  return template.replace(TEMPLATE_REFERENCE_PATTERN, (_full, rawName: string) => {
    const variableName = rawName.trim()
    if (!TEMPLATE_IDENTIFIER_PATTERN.test(variableName)) {
      throw new Error(
        `Invalid template variable "${variableName}". Variable names must match ${TEMPLATE_IDENTIFIER_PATTERN.source}.`
      )
    }
    if (!availableVariables.has(variableName)) {
      throw new Error(`Missing template variable: ${variableName}`)
    }
    const value = variables[variableName]
    if (value === undefined) {
      throw new Error(`Missing template variable: ${variableName}`)
    }
    return value
  })
}

export function isSelectionEditProtocol(
  protocol: ResponseProtocol
): protocol is SelectionEditProtocol {
  return protocol.type === 'selection-edit-v1'
}

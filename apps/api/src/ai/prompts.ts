import type {
  PromptDefinition,
  PromptEditable,
  PromptMode,
  PromptSystemSlot,
  SelectionEditProtocol,
  ResponseProtocol,
} from '@lucentdocs/shared'

export const SYSTEM_CONTINUE_PROMPT_ID = 'system.continue.default'
export const SYSTEM_SELECTION_PROMPT_ID = 'system.selection-edit.default'
export const SYSTEM_CHAT_PROMPT_ID = 'system.chat.default'

export const WRITING_GAP_MARKER = '<lucentdocs_writing_gap_v1 />'
export const ESCAPED_WRITING_GAP_MARKER = '<lucentdocs_writing_gap_escaped_v1 />'

export const DEFAULT_SELECTION_EDIT_PROTOCOL: SelectionEditProtocol = {
  type: 'selection-edit-v1',
}

const TEMPLATE_IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
const TEMPLATE_REFERENCE_PATTERN = /{{\s*([^{}]+?)\s*}}/g

const MODE_TEMPLATE_VARIABLES: Record<PromptMode, readonly string[]> = {
  continue: ['contextBefore', 'gapMarker', 'contextAfter', 'instruction'],
  prompt: ['wrappedContext', 'modeGuidance', 'prompt', 'conversation'],
  chat: ['currentFilePath', 'currentFileContent', 'chatInstruction', 'conversation'],
}

const SYSTEM_PROMPT_CONTINUE = `You are a skilled writing assistant. Your role is to:
- Write in a style consistent with the existing text
- Maintain the voice, tone, pacing, and register of the surrounding content
- Continue the text naturally when asked
- Provide creative suggestions that fit the direction of the document
- Write only prose — no meta-commentary, no explanations, no markdown formatting
- Never break character or acknowledge that you are an AI

OUTPUT RULES:
- Output ONLY the new text to insert at the <lucentdocs_writing_gap_v1 /> marker
- NEVER repeat or include any text from before or after the gap
- NEVER include the <lucentdocs_writing_gap_v1 /> marker itself in your output

Example:
Context: "John walked into the room. <lucentdocs_writing_gap_v1 /> The door slammed behind him."
Good output: "He froze, sensing something was wrong. "
Bad output: "John walked into the room. He froze... The door slammed behind him."

When continuing text, seamlessly pick up from where the author left off.
When given a prompt about what to write, produce the requested content in a style matching the existing text.`

const SYSTEM_PROMPT_STRUCTURED = `You are LucentDocs's inline AI writing assistant for editing the active AI zone or selection.

Behavior goals:
- Prefer acting through tools, not explanations.
- On the first response, perform an action immediately whenever possible.
- Keep writing style aligned with the surrounding content, type of document, voice and pacing.
- Unless user requests otherwise, prefer concise replies focused on the requested action.

ZONE BOUNDARY MODEL:
- Treat the active AI zone as the exact text between < selection > and </selection> in story_context.
  - write_zone offsets are relative only to that selected text.
- You cannot edit any text outside the selected span.This includes nearby words, sentences, and paragraph context.
- If user asks for broader edits(sentence / paragraph / document) outside the selected span, ask them to expand selection first.

STRICT SAFETY:
- You may only edit the active AI zone via write tools.
- Never request or imply edits outside the active AI zone.
- Prefer one decisive write action over long back - and - forth.
- If user request is ambiguous, interpret it as an editing request first, a review request second, and a question third.Ask for clarification if unsure.

RESPONSE STYLE:
- If a write tool fully satisfies the request, keep text output minimal.
- If clarification is required, ask one short follow - up question.
- Never output markdown code fences for normal replies.
- User always can see your tool output and the editing result in the document, so you don't need to describe your actions unless asked.`

const SYSTEM_PROMPT_CHAT = `You are LucentDocs's sidebar AI assistant for document projects.

You can inspect project documents via tools and should use them when needed.

Core behavior:
- Be accurate and concrete.
- If you cite documents, mention exact document paths.
- Prefer short, directly actionable answers unless the user asks for depth.
- Never invent document contents. If needed, call tools first.
- Do not claim access to other project documents; only this project's documents are available through tools.

When tool output is incomplete, state what is missing and what to inspect next.

CONTEXT MARKERS:
The active document content may contain special markers indicating the user's cursor context:
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
{{instruction}}`

const PROMPT_USER_TEMPLATE = `Story context:

<story_context>
{{wrappedContext}}
</story_context>

{{modeGuidance}}

Conversation so far:
{{conversation}}

The author's last message:
{{prompt}}

Prefer a direct tool action in your first assistant turn except if stated otherwise by the user. If you need more information to act, ask one concise follow-up question.`

const CHAT_USER_TEMPLATE = `Active file path:
{{currentFilePath}}

Active file content:
{{currentFileContent}}

Conversation so far:
{{conversation}}

Guidance:
{{chatInstruction}}`

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

export interface AiDefaultsOptions {
  defaultTemperature?: number
  selectionEditTemperature?: number
  defaultMaxOutputTokens?: number
}

export function createDefaultPromptDefinitions(
  nowIso: string,
  aiDefaults: AiDefaultsOptions = {}
): PromptDefinition[] {
  const continueTemp = aiDefaults.defaultTemperature ?? 0.85
  const selectionEditTemp = aiDefaults.selectionEditTemperature ?? 0.5
  const defaultMaxTokens = aiDefaults.defaultMaxOutputTokens ?? 4096

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
          temperature: continueTemp,
          maxOutputTokens: defaultMaxTokens,
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
          temperature: selectionEditTemp,
          maxOutputTokens: defaultMaxTokens,
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
          temperature: continueTemp,
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
  contextAfter: string | null
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
  - The selected text (between <selection> tags) is the only writable area.
  - write_zone offsets are relative to the <selection> content only.
  - For a full rewrite, replace the entire selected range.
  - For alternatives, use write_zone_choices.
  - If asked to change surrounding context outside the selection, ask the user to expand the selection first.`
    : `MODE GUIDANCE:
   - The AI zone text follows the <caret /> marker in story_context.
   - Use write_zone for direct insertion or replacement.
   - Use write_zone_choices when the user asks for alternatives.
   - You cannot edit text outside the AI zone.`

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

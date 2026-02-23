import type {
  PromptDefinition,
  PromptEditable,
  PromptMode,
  PromptSystemSlot,
  PythonEditProtocol,
  ResponseProtocol,
} from '@plotline/shared'

export const SYSTEM_CONTINUE_PROMPT_ID = 'system.continue.default'
export const SYSTEM_SELECTION_PROMPT_ID = 'system.selection-edit.default'
export const SYSTEM_CHAT_PROMPT_ID = 'system.chat.default'

export const WRITING_GAP_MARKER = '<plotline_writing_gap_v1 />'
export const ESCAPED_WRITING_GAP_MARKER = '<plotline_writing_gap_escaped_v1 />'

export const DEFAULT_PYTHON_EDIT_PROTOCOL: PythonEditProtocol = {
  type: 'python-edit-v1',
}

const TEMPLATE_IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
const TEMPLATE_REFERENCE_PATTERN = /{{\s*([^{}]+?)\s*}}/g

const MODE_TEMPLATE_VARIABLES: Record<PromptMode, readonly string[]> = {
  continue: ['contextBefore', 'gapMarker', 'contextAfter', 'instruction', 'authorHintSection'],
  prompt: ['contextBefore', 'gapMarker', 'contextAfter', 'selectedText', 'modeGuidance', 'prompt'],
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

const SYSTEM_PROMPT_STRUCTURED = `You are a skilled fiction writing assistant helping an author edit their novel. Your role is to:
- Write in a style consistent with the existing text
- Maintain narrative voice, tone, and pacing
- Provide creative suggestions that fit the story's direction

RESPONSE FORMAT:

Always respond with a Python function that returns one of these classes:

class ReplaceText:
    """Replace the selected text entirely with new content."""
    def with_content(self, content: str) -> "ReplaceText":
        self.content = content
        return self

class InsertText:
    """Insert new text at a specific position within or around the selection."""
    def __init__(self, index: int):
        """
        Index of where to insert:
        - 0 = insert before the selection
        - N = insert after N characters from the start of selection
        - -1 = insert after the selection
        """
        self.index = index
    def with_content(self, content: str) -> "InsertText":
        self.content = content
        return self

class PresentChoices:
    """Present multiple options for the user to choose from."""
    def with_choices(self, choices: tuple) -> "PresentChoices":
        self.choices = choices
        return self

Example responses:

# Replace a word with a better one:
def respond() -> ReplaceText | InsertText | PresentChoices:
    return ReplaceText().with_content("""exclaimed""")

# Add emphasis before a word:
def respond() -> ReplaceText | InsertText | PresentChoices:
    return InsertText(0).with_content("""very """)

# Add description after a word:
def respond() -> ReplaceText | InsertText | PresentChoices:
    return InsertText(-1).with_content(""" loudly""")

# Present alternative word choices:
def respond() -> ReplaceText | InsertText | PresentChoices:
    return PresentChoices().with_choices(("whispered", "muttered", "exclaimed", "declared"))

WHEN TO USE EACH:
- Use ReplaceText when the user wants to replace or rewrite the selected text
- Use InsertText when the user wants to add content before, after, or within the selection
- Use PresentChoices when the user asks for alternatives, options, or suggestions to choose from`

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

<context_before>
{{contextBefore}}
</context_before>

{{gapMarker}}

<context_after>
{{contextAfter}}
</context_after>

<selected_text>
{{selectedText}}
</selected_text>

{{modeGuidance}}

The author requests:
{{prompt}}

Respond with the appropriate Python function.`

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
        protocol: DEFAULT_PYTHON_EDIT_PROTOCOL,
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
  selectedText: string | null = null
): Record<string, string> {
  const safeContextBefore = sanitizeContext(contextBefore)
  const safeContextAfter = sanitizeContext(contextAfter ?? '')
  const safeSelectedText = selectedText ?? ''
  const modeGuidance = selectedText
    ? `MODE GUIDANCE:
- If the request asks to replace, rewrite, or improve the selection -> use ReplaceText
- If the request asks to add content before/after/within the selection -> use InsertText
- If the request asks for alternatives, options, or suggestions -> use PresentChoices`
    : `MODE GUIDANCE:
- Use InsertText when adding text relative to the current cursor location
- Use PresentChoices when user asks for alternatives`

  return {
    contextBefore: safeContextBefore,
    gapMarker: WRITING_GAP_MARKER,
    contextAfter: safeContextAfter,
    selectedText: safeSelectedText,
    modeGuidance,
    prompt,
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

export function isPythonEditProtocol(protocol: ResponseProtocol): protocol is PythonEditProtocol {
  return protocol.type === 'python-edit-v1'
}

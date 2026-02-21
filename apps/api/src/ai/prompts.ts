export const SYSTEM_PROMPT = `You are a skilled fiction writing assistant helping an author write a novel. Your role is to:
- Write in a style consistent with the existing text
- Maintain narrative voice, tone, and pacing
- Continue the story naturally when asked
- Provide creative suggestions that fit the story's direction
- Write only prose — no meta-commentary, no explanations, no markdown formatting
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

export const SYSTEM_PROMPT_STRUCTURED = `You are a skilled fiction writing assistant helping an author edit their novel. Your role is to:
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

const WRITING_GAP_MARKER = '<plotline_writing_gap_v1 />'
const ESCAPED_WRITING_GAP_MARKER = '<plotline_writing_gap_escaped_v1 />'

function sanitizeContext(context: string): string {
  return context.replaceAll(WRITING_GAP_MARKER, ESCAPED_WRITING_GAP_MARKER)
}

export function buildContinuePrompt(
  contextBefore: string,
  contextAfter: string | null,
  hint?: string
): string {
  const safeContextBefore = sanitizeContext(contextBefore)
  const safeContextAfter = contextAfter ? sanitizeContext(contextAfter) : null

  const context = safeContextAfter
    ? `${safeContextBefore}\n\n${WRITING_GAP_MARKER}\n\n${safeContextAfter}`
    : safeContextBefore

  const instruction = safeContextAfter
    ? `Write at the ${WRITING_GAP_MARKER} marker, bridging naturally to what follows.`
    : 'Continue writing the next part of the story naturally.'

  return hint
    ? `Here is the story context:\n\n${context}\n\n${instruction} The author wants you to: ${hint}`
    : `Here is the story context:\n\n${context}\n\n${instruction}`
}

export function buildPromptPrompt(
  contextBefore: string,
  contextAfter: string | null,
  prompt: string,
  selectedText: string | null = null
): string {
  const safeContextBefore = sanitizeContext(contextBefore)
  const safeContextAfter = contextAfter ? sanitizeContext(contextAfter) : null

  const context = safeContextAfter
    ? `${safeContextBefore}\n\n${WRITING_GAP_MARKER}\n\n${safeContextAfter}`
    : safeContextBefore

  const selectionBlock = selectedText
    ? `\n\n<selected_text>\n${selectedText}\n</selected_text>`
    : ''

  const modeGuidance = selectedText
    ? `\n\nMODE GUIDANCE:
- If the request asks to replace, rewrite, or improve the selection → use ReplaceText
- If the request asks to add content before/after/within the selection → use InsertText
- If the request asks for alternatives, options, or suggestions → use PresentChoices`
    : ''

  return `Here is the story context:\n\n${context}${selectionBlock}${modeGuidance}\n\nThe author requests: ${prompt}\n\nRespond with the appropriate Python function.`
}

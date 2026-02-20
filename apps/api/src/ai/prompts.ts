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
  prompt: string
): string {
  const safeContextBefore = sanitizeContext(contextBefore)
  const safeContextAfter = contextAfter ? sanitizeContext(contextAfter) : null

  const context = safeContextAfter
    ? `${safeContextBefore}\n\n${WRITING_GAP_MARKER}\n\n${safeContextAfter}`
    : safeContextBefore

  const instruction = safeContextAfter
    ? ` Write at the ${WRITING_GAP_MARKER} marker as requested.`
    : ''

  return `Here is the story context:\n\n${context}\n\nThe author requests: ${prompt}\n\nWrite the requested content, keeping consistent with the story's style and voice.${instruction}`
}

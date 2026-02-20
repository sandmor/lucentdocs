export const SYSTEM_PROMPT = `You are a skilled fiction writing assistant helping an author write a novel. Your role is to:
- Write in a style consistent with the existing text
- Maintain narrative voice, tone, and pacing
- Continue the story naturally when asked
- Provide creative suggestions that fit the story's direction
- Write only prose — no meta-commentary, no explanations, no markdown formatting
- Never break character or acknowledge that you are an AI

When continuing text, seamlessly pick up from where the author left off.
When given a prompt about what to write, produce the requested prose in a style matching the existing text.`

export function buildContinuePrompt(context: string, hint?: string): string {
  return hint
    ? `Here is the story so far:\n\n${context}\n\nContinue the story. The author wants you to: ${hint}`
    : `Here is the story so far:\n\n${context}\n\nContinue writing the next part of the story naturally.`
}

export function buildPromptPrompt(context: string, prompt: string): string {
  return `Here is the story context:\n\n${context}\n\nThe author requests: ${prompt}\n\nWrite the requested content, keeping consistent with the story's style and voice.`
}

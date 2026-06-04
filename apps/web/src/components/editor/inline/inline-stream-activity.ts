type InlineStreamActivityHandler = (sessionId: string) => void

const handlers = new Set<InlineStreamActivityHandler>()

export function registerInlineStreamActivityHandler(
  handler: InlineStreamActivityHandler
): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function emitInlineStreamActivity(sessionId: string): void {
  for (const handler of handlers) {
    handler(sessionId)
  }
}

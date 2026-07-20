const documentLocks = new Map<string, Promise<void>>()

export async function withDocumentLock<T>(documentId: string, task: () => Promise<T>): Promise<T> {
  const previous = documentLocks.get(documentId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chain = previous.then(() => gate)
  documentLocks.set(documentId, chain)
  await previous

  try {
    return await task()
  } finally {
    release()
    if (documentLocks.get(documentId) === chain) documentLocks.delete(documentId)
  }
}

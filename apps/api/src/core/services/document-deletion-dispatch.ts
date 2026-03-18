export interface DocumentDeletionObserver<TReference extends { documentId: string }> {
  onDocumentDeleted?: (documentId: string, references?: TReference[]) => Promise<void> | void
  onDocumentsDeleted?: (documentIds: string[], references?: TReference[]) => Promise<void> | void
}

function groupReferencesByDocumentId<TReference extends { documentId: string }>(
  references: TReference[]
): Map<string, TReference[]> {
  const grouped = new Map<string, TReference[]>()
  for (const reference of references) {
    const documentId = reference.documentId
    if (typeof documentId !== 'string' || documentId.length === 0) continue
    const bucket = grouped.get(documentId)
    if (bucket) bucket.push(reference)
    else grouped.set(documentId, [reference])
  }
  return grouped
}

export function createDocumentDeletionDispatcher<TReference extends { documentId: string }>(
  observer: DocumentDeletionObserver<TReference>,
  options: { logLabel: string }
): {
  dispatchDocumentsDeleted: (documentIds: string[], references: TReference[]) => void
} {
  const notifyDocumentsDeleted = async (
    documentIds: string[],
    references: TReference[] = []
  ): Promise<void> => {
    if (documentIds.length === 0) return
    if (observer.onDocumentsDeleted) {
      await observer.onDocumentsDeleted(documentIds, references)
      return
    }

    const referencesByDocumentId =
      references.length > 0
        ? groupReferencesByDocumentId(references)
        : new Map<string, TReference[]>()

    for (const documentId of documentIds) {
      await observer.onDocumentDeleted?.(documentId, referencesByDocumentId.get(documentId) ?? [])
    }
  }

  const dispatchDocumentsDeleted = (documentIds: string[], references: TReference[]): void => {
    // Cleanup should not block the request path. Source-of-truth rows are already removed
    // at this point, and cleanup is at-least-once.
    void notifyDocumentsDeleted(documentIds, references).catch((error) => {
      console.warn(`[${options.logLabel}] Failed to dispatch post-delete embedding cleanup:`, error)
    })
  }

  return { dispatchDocumentsDeleted }
}

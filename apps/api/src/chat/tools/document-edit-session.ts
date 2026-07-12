export class EditGuardError extends Error {
  readonly code: 'read_required' | 'content_changed'

  constructor(code: 'read_required' | 'content_changed', message: string) {
    super(message)
    this.name = 'EditGuardError'
    this.code = code
  }
}

interface EditSessionEntry {
  hash: string
}

export class DocumentEditSession {
  #entries = new Map<string, EditSessionEntry>()

  recordRead(path: string, hash: string) {
    this.#entries.set(path, { hash })
  }

  hasRead(path: string): boolean {
    return this.#entries.has(path)
  }

  getHash(path: string): string | null {
    return this.#entries.get(path)?.hash ?? null
  }

  assertPathRead(path: string) {
    if (!this.#entries.has(path)) {
      throw new EditGuardError(
        'read_required',
        `You must call read on "${path}" before editing it in this conversation.`
      )
    }
  }

  assertHashCurrent(path: string, currentHash: string) {
    this.assertPathRead(path)
    const recorded = this.#entries.get(path)?.hash
    if (recorded !== currentHash) {
      throw new EditGuardError(
        'content_changed',
        `Content of "${path}" changed since it was last read. Re-read the file and retry the edit.`
      )
    }
  }

  markEdited(path: string, hash: string) {
    this.#entries.set(path, { hash })
  }
}

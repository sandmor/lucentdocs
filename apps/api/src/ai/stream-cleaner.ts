function createPrefixMatcher(contextBefore: string) {
  let buffer = ''
  let candidates: number[] | null = null
  let bestOverlapLength = 0
  let done = false

  const contextLength = contextBefore.length

  return {
    process(char: string): string | null {
      if (done) return char

      if (contextLength === 0) {
        done = true
        return char
      }

      let nextCandidates: number[] = []

      if (candidates === null) {
        for (let i = 0; i < contextLength; i += 1) {
          if (contextBefore[i] === char) {
            nextCandidates.push(i)
          }
        }
      } else {
        const matchedLength = buffer.length
        for (const start of candidates) {
          const nextIdx = start + matchedLength
          if (nextIdx < contextLength && contextBefore[nextIdx] === char) {
            nextCandidates.push(start)
          }
        }
      }

      if (nextCandidates.length === 0) {
        done = true
        return buffer.slice(bestOverlapLength) + char
      }

      buffer += char
      candidates = nextCandidates

      const matchedLength = buffer.length
      for (const start of nextCandidates) {
        if (start + matchedLength === contextLength) {
          bestOverlapLength = matchedLength
          break
        }
      }

      return null
    },

    flush(): string {
      if (done) return ''
      return buffer.slice(bestOverlapLength)
    },
  }
}

function createSuffixMatcher(contextAfter: string | null) {
  if (!contextAfter) {
    return {
      process(char: string): string | null {
        return char
      },
      flush(): string {
        return ''
      },
    }
  }

  let pending = ''

  return {
    process(char: string): string | null {
      pending += char

      let toEmit = ''
      while (pending.length > 0 && !contextAfter.startsWith(pending)) {
        toEmit += pending[0]
        pending = pending.slice(1)
      }

      return toEmit.length > 0 ? toEmit : null
    },

    flush(): string {
      return contextAfter.startsWith(pending) ? '' : pending
    },
  }
}

export interface StreamCleaner {
  process: (chunk: string) => string
  flush: () => string
}

export function createStreamCleaner(
  contextBefore: string,
  contextAfter: string | null
): StreamCleaner {
  const prefixMatcher = createPrefixMatcher(contextBefore)
  const suffixMatcher = createSuffixMatcher(contextAfter)

  let prefixDone = false

  return {
    process(chunk: string): string {
      let toEmit = ''

      for (const char of chunk) {
        if (!prefixDone) {
          const result = prefixMatcher.process(char)
          if (result !== null) {
            prefixDone = true
            toEmit += result
          }
        } else {
          const result = suffixMatcher.process(char)
          if (result !== null) {
            toEmit += result
          }
        }
      }

      return toEmit
    },

    flush(): string {
      return prefixMatcher.flush() + suffixMatcher.flush()
    },
  }
}

export function cleanText(
  text: string,
  contextBefore: string,
  contextAfter: string | null
): string {
  const cleaner = createStreamCleaner(contextBefore, contextAfter)
  const result = cleaner.process(text)
  return result + cleaner.flush()
}

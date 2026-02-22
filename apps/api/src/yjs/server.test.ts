import { describe, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import { docs } from '@y/websocket-server/utils'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import { schema } from '@plotline/shared'
import {
  ensureDocumentLoaded,
  flushAllDocumentStates,
  getDocumentContent,
  replaceDocument,
} from './server.js'

const makeDoc = (text: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    },
  ],
})

describe('yjs server replaceDocument', () => {
  test('replaces stored content instead of merging old and new state', async () => {
    const documentName = nanoid()

    await replaceDocument(documentName, makeDoc('alpha'))
    const first = await getDocumentContent(documentName)
    expect(first).not.toBeNull()
    expect(first!).toContain('alpha')

    await replaceDocument(documentName, makeDoc('beta'))
    const second = await getDocumentContent(documentName)
    expect(second).not.toBeNull()
    expect(second!).toContain('beta')
    expect(second!).not.toContain('alpha')
  })

  test('flushes pending in-memory updates so content survives restart', async () => {
    const documentName = nanoid()

    await ensureDocumentLoaded(documentName)
    const liveDoc = docs.get(documentName)
    expect(liveDoc).toBeTruthy()

    const replacement = prosemirrorJSONToYDoc(schema, makeDoc('persisted'))
    const update = Y.encodeStateAsUpdate(replacement)
    replacement.destroy()

    Y.applyUpdate(liveDoc!, update)

    // Force persistence without waiting for debounce, as happens on graceful shutdown.
    await flushAllDocumentStates()

    liveDoc!.destroy()
    docs.delete(documentName)

    const afterRestart = await getDocumentContent(documentName)
    expect(afterRestart).not.toBeNull()
    expect(afterRestart!).toContain('persisted')
  })

  test('initialization is idempotent for new docs', async () => {
    const documentName = nanoid()

    await Promise.all([ensureDocumentLoaded(documentName), ensureDocumentLoaded(documentName)])

    const content = await getDocumentContent(documentName)
    expect(content).not.toBeNull()

    const parsed = JSON.parse(content!) as { content?: Array<{ type?: string }> }
    expect(Array.isArray(parsed.content)).toBe(true)
    expect(parsed.content?.length).toBe(1)
    expect(parsed.content?.[0]?.type).toBe('paragraph')
  })
})

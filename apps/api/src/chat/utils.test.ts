import { describe, expect, test } from 'bun:test'
import { renderContextParts } from '@lucentdocs/shared'
import type { UIMessage } from 'ai'
import { toEditorContent } from '../testing/editor-content.js'
import {
  buildCurrentFileContext,
  canContinueConversation,
  assertCanContinueConversation,
  deleteMessageAt,
  replaceMessageText,
} from './utils.js'

describe('buildCurrentFileContext', () => {
  test('returns full content for small documents', () => {
    const content = toEditorContent('Small paragraph for chat context.')

    const result = buildCurrentFileContext(content, undefined, undefined)
    const text = renderContextParts(result)

    expect(text).toContain('Small paragraph for chat context.')
    expect(text).toContain('<caret />')
    expect(result.truncated).toBe(false)
    expect(text).not.toContain('<truncation_notice')
  })

  test('clips oversized documents to a local excerpt around the caret', () => {
    const unit = 'middle section '
    // The window is budget*2 chars wide; make the doc large enough to exceed it
    const repeated = unit.repeat(Math.ceil((12_000 * 4) / unit.length))
    const content = toEditorContent(`START MARKER\n\n${repeated}\n\nEND MARKER`)

    const result = buildCurrentFileContext(content, undefined, undefined)
    const text = renderContextParts(result)

    expect(result.truncated).toBe(true)
    expect(text).toContain('<truncation_notice')
    expect(text).toContain('<caret />')
    expect(text).toContain('END MARKER')
    expect(text).not.toContain('START MARKER')
    expect(text).toContain('<omitted content="earlier"/>')
  })
})

describe('chat message revisions', () => {
  const messages: UIMessage[] = [
    { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Original prompt' }] },
    { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Original reply' }] },
    { id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] },
  ]

  test('replaces plain text for any message role and preserves later messages', () => {
    const edited = replaceMessageText(messages, 'assistant-1', ' Revised reply ')

    expect(edited).toEqual([
      messages[0],
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Revised reply' }] },
      messages[2],
    ])
  })

  test('rejects editing messages with tool parts', () => {
    const toolMessage: UIMessage = {
      id: 'assistant-tool',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'I inspected the file.' },
        {
          type: 'dynamic-tool',
          toolName: 'read',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: {},
        },
      ],
    }

    expect(() => replaceMessageText([toolMessage], toolMessage.id, 'Changed')).toThrow(
      'Messages with tool activity cannot be edited.'
    )
  })

  test('deletes only the selected message', () => {
    expect(deleteMessageAt(messages, 'assistant-1', 'only')).toEqual([
      messages[0],
      messages[2],
    ])
  })

  test('deletes the selected message and everything after it', () => {
    expect(deleteMessageAt(messages, 'assistant-1', 'from_here')).toEqual([messages[0]])
  })
})

describe('canContinueConversation', () => {
  test('allows continue when the latest message is from the author', () => {
    const thread: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Prompt' }] },
    ]

    expect(canContinueConversation(thread)).toBe(true)
    expect(() => assertCanContinueConversation(thread)).not.toThrow()
  })

  test('rejects continue for empty chats and non-user trailing messages', () => {
    expect(canContinueConversation([])).toBe(false)
    expect(() => assertCanContinueConversation([])).toThrow('Cannot continue an empty chat.')

    const assistantLast: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Prompt' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Reply' }] },
    ]

    expect(canContinueConversation(assistantLast)).toBe(false)
    expect(() => assertCanContinueConversation(assistantLast)).toThrow(
      'Cannot continue unless the latest message is from the author.'
    )
  })
})

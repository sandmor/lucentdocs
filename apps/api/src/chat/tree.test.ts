import { describe, expect, test } from 'bun:test'
import { createEmptyChatThreadPayload } from '../core/services/chat-thread-payload.js'
import { ChatRuntimeError } from './utils.js'
import {
  appendUserMessage,
  deleteNode,
  forkRegeneration,
  getBranchMeta,
  pathToUIMessages,
  replaceNodeText,
  resolveActivePath,
  selectBranch,
  setAssistantOnActiveLeaf,
} from './tree.js'

function seedLinearThread() {
  const payload = createEmptyChatThreadPayload()
  payload.rootChildIds = ['user-1']
  payload.selectedRootChildId = 'user-1'
  payload.nodes = {
    'user-1': {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
      parentId: null,
      childIds: ['asst-1'],
      selectedChildId: 'asst-1',
    },
    'asst-1': {
      id: 'asst-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hi there' }],
      parentId: 'user-1',
      childIds: ['user-2'],
      selectedChildId: 'user-2',
    },
    'user-2': {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'Follow up' }],
      parentId: 'asst-1',
      childIds: [],
      selectedChildId: null,
    },
  }
  return payload
}

function seedAssistantBranchThread() {
  const payload = seedLinearThread()
  payload.nodes['asst-1']!.childIds = ['asst-alt', 'user-2']
  payload.nodes['asst-alt'] = {
    id: 'asst-alt',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Alternate reply' }],
    parentId: 'asst-1',
    childIds: [],
    selectedChildId: null,
  }
  return payload
}

describe('chat tree', () => {
  test('resolveActivePath walks selected children from root', () => {
    const payload = seedLinearThread()
    expect(resolveActivePath(payload).map((node) => node.id)).toEqual(['user-1', 'asst-1', 'user-2'])
    expect(pathToUIMessages(resolveActivePath(payload)).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
  })

  test('forkRegeneration creates assistant siblings and preserves old branch', () => {
    const payload = seedLinearThread()
    const { payload: forked, forkNodeId } = forkRegeneration(payload, 'asst-1')

    expect(forkNodeId).not.toBe('asst-1')
    expect(forked.nodes['user-1']!.childIds).toEqual(['asst-1', forkNodeId])
    expect(forked.nodes['user-1']!.selectedChildId).toBe(forkNodeId)
    expect(forked.nodes['asst-1']).toBeDefined()
    expect(resolveActivePath(forked).map((node) => node.id)).toEqual(['user-1', forkNodeId])
  })

  test('forkRegeneration supports root-level user forks', () => {
    const payload = seedLinearThread()
    const { payload: forked, forkNodeId } = forkRegeneration(payload, 'user-1')

    expect(forked.rootChildIds).toEqual(['user-1', forkNodeId])
    expect(forked.selectedRootChildId).toBe(forkNodeId)
    expect(forked.nodes[forkNodeId]?.parts).toEqual([{ type: 'text', text: 'Hello' }])
  })

  test('selectBranch switches active path without deleting nodes', () => {
    const payload = seedLinearThread()
    const { payload: forked, forkNodeId } = forkRegeneration(payload, 'asst-1')
    const switched = selectBranch(forked, 'asst-1')

    expect(resolveActivePath(switched).map((node) => node.id)).toEqual(['user-1', 'asst-1', 'user-2'])
    expect(forked.nodes[forkNodeId]).toBeDefined()
  })

  test('getBranchMeta reports sibling index and count', () => {
    const payload = seedLinearThread()
    const { payload: forked, forkNodeId } = forkRegeneration(payload, 'asst-1')

    expect(getBranchMeta(forked, forkNodeId)).toEqual({
      index: 1,
      count: 2,
      siblingIds: ['asst-1', forkNodeId],
    })
  })

  test('appendUserMessage and assistant attachment extend the active path', () => {
    let payload = createEmptyChatThreadPayload()
    const appended = appendUserMessage(payload, 'First prompt')
    payload = appended.payload
    payload = setAssistantOnActiveLeaf(payload, 'asst-1', [{ type: 'text', text: 'Reply' }])

    expect(resolveActivePath(payload).map((node) => node.id)).toEqual([
      appended.nodeId,
      'asst-1',
    ])
  })

  test('setAssistantOnActiveLeaf updates an assistant placeholder on the active path', () => {
    let payload = createEmptyChatThreadPayload()
    const appended = appendUserMessage(payload, 'First prompt')
    payload = appended.payload
    payload = setAssistantOnActiveLeaf(payload, 'asst-1', [{ type: 'text', text: 'Reply' }])
    const { payload: forked, forkNodeId } = forkRegeneration(payload, 'asst-1')
    payload = setAssistantOnActiveLeaf(forked, forkNodeId, [{ type: 'text', text: 'Regen' }])

    expect(resolveActivePath(payload).map((node) => node.role)).toEqual(['user', 'assistant'])
    expect(resolveActivePath(payload)[1]?.parts).toEqual([{ type: 'text', text: 'Regen' }])
  })

  test('deleteNode from_here removes the node and its entire subtree', () => {
    const payload = seedLinearThread()
    const truncated = deleteNode(payload, 'asst-1', 'from_here')

    expect(resolveActivePath(truncated).map((node) => node.id)).toEqual(['user-1'])
    expect(truncated.nodes['asst-1']).toBeUndefined()
    expect(truncated.nodes['user-2']).toBeUndefined()
  })

  test('deleteNode branch removes a regeneration and reselects siblings', () => {
    const payload = seedLinearThread()
    const { payload: forked, forkNodeId } = forkRegeneration(payload, 'asst-1')
    const deleted = deleteNode(forked, forkNodeId, 'branch')

    expect(deleted.nodes[forkNodeId]).toBeUndefined()
    expect(resolveActivePath(deleted).map((node) => node.id)).toEqual(['user-1', 'asst-1', 'user-2'])
  })

  test('deleteNode only promotes the active child and prunes inactive child branches', () => {
    const payload = seedAssistantBranchThread()
    const deleted = deleteNode(payload, 'asst-1', 'only')

    expect(deleted.nodes['asst-1']).toBeUndefined()
    expect(deleted.nodes['asst-alt']).toBeUndefined()
    expect(resolveActivePath(deleted).map((node) => node.id)).toEqual(['user-1', 'user-2'])
    expect(deleted.nodes['user-2']!.parentId).toBe('user-1')
  })

  test('replaceNodeText rejects nodes off the active path', () => {
    const payload = seedLinearThread()
    payload.nodes['orphan'] = {
      id: 'orphan',
      role: 'user',
      parts: [{ type: 'text', text: 'Off path' }],
      parentId: null,
      childIds: [],
      selectedChildId: null,
    }

    expect(() => replaceNodeText(payload, 'orphan', 'Changed')).toThrow(ChatRuntimeError)
  })

  test('forkRegeneration supports edited text on user forks', () => {
    const payload = seedLinearThread()
    const { payload: forked, forkNodeId } = forkRegeneration(payload, 'user-1', {
      text: 'Edited prompt',
    })

    expect(forked.nodes[forkNodeId]?.parts).toEqual([{ type: 'text', text: 'Edited prompt' }])
  })

  test('forkRegeneration rejects nodes off the active path', () => {
    const payload = seedLinearThread()
    payload.nodes['orphan'] = {
      id: 'orphan',
      role: 'user',
      parts: [{ type: 'text', text: 'Off path' }],
      parentId: null,
      childIds: [],
      selectedChildId: null,
    }

    expect(() => forkRegeneration(payload, 'orphan')).toThrow(ChatRuntimeError)
  })
})

import type { PromptDefinition, PromptMode } from '@plotline/shared'
import { promptManager } from './prompt-manager.js'
import {
  buildChatVariables,
  buildContinueVariables,
  buildPromptVariables,
  isSelectionEditProtocol,
  renderTemplate,
} from './prompts.js'

export interface RenderedPrompt {
  definition: PromptDefinition
  systemPrompt: string
  userPrompt: string
}

function renderPrompt(
  definition: PromptDefinition,
  variables: Record<string, string>
): RenderedPrompt {
  return {
    definition,
    systemPrompt: renderTemplate(definition.systemTemplate, variables),
    userPrompt: renderTemplate(definition.userTemplate, variables),
  }
}

export function resolveContinuePrompt(
  contextBefore: string,
  contextAfter: string | null
): RenderedPrompt {
  const definition = promptManager.resolvePromptForMode('continue')
  const variables = buildContinueVariables(contextBefore, contextAfter)
  return renderPrompt(definition, variables)
}

export function resolveSelectionPrompt(
  contextBefore: string,
  contextAfter: string | null,
  prompt: string,
  selectedText: string | null,
  conversation = ''
): RenderedPrompt {
  const definition = promptManager.resolvePromptForMode('prompt')
  const variables = buildPromptVariables(
    contextBefore,
    contextAfter,
    prompt,
    selectedText,
    conversation
  )
  return renderPrompt(definition, variables)
}

export function resolveChatPrompt(
  currentFilePath: string,
  currentFileContent: string,
  conversation: string
): RenderedPrompt {
  const definition = promptManager.resolvePromptForMode('chat')
  const variables = buildChatVariables(currentFilePath, currentFileContent, conversation)
  return renderPrompt(definition, variables)
}

export function assertPromptProtocolMode(
  definition: PromptDefinition,
  expectedMode: PromptMode
): void {
  if (definition.mode !== expectedMode) {
    throw new Error(
      `Prompt "${definition.id}" is configured for mode "${definition.mode}" but "${expectedMode}" was requested`
    )
  }

  if (expectedMode === 'continue' && definition.protocol.type !== 'plain-text-v1') {
    throw new Error(`Prompt "${definition.id}" must use plain-text-v1 protocol for continue mode`)
  }

  if (expectedMode === 'prompt' && !isSelectionEditProtocol(definition.protocol)) {
    throw new Error(
      `Prompt "${definition.id}" must use selection-edit-v1 protocol for structured prompt mode`
    )
  }

  if (expectedMode === 'chat' && definition.protocol.type !== 'plain-text-v1') {
    throw new Error(`Prompt "${definition.id}" must use plain-text-v1 protocol for chat mode`)
  }
}

import { describe, expect, test } from 'bun:test'
import {
  renderTemplate,
  validatePromptTemplatesForMode,
  validateTemplateReferencesForMode,
} from './prompts'

describe('prompt template validation', () => {
  test('accepts allowed continue variables', () => {
    expect(() =>
      validatePromptTemplatesForMode(
        'continue',
        'System {{contextBefore}} {{gapMarker}}',
        'User {{instruction}} {{authorHintSection}} {{contextAfter}}'
      )
    ).not.toThrow()
  })

  test('rejects unknown variables for prompt mode', () => {
    expect(() =>
      validateTemplateReferencesForMode('prompt', 'userTemplate', 'Bad {{instruction}}')
    ).toThrow('Unknown template variable "instruction"')
  })

  test('accepts allowed chat variables', () => {
    expect(() =>
      validateTemplateReferencesForMode(
        'chat',
        'userTemplate',
        'File {{currentFilePath}} {{currentFileContent}} {{chatInstruction}} {{conversation}}'
      )
    ).not.toThrow()
  })

  test('rejects invalid variable names', () => {
    expect(() =>
      validateTemplateReferencesForMode('continue', 'userTemplate', 'Bad {{bad-var}}')
    ).toThrow('Invalid template variable "bad-var"')
  })
})

describe('renderTemplate', () => {
  test('renders known variables', () => {
    const output = renderTemplate('Hello {{name}}!', { name: 'world' })
    expect(output).toBe('Hello world!')
  })

  test('throws for missing variables', () => {
    expect(() => renderTemplate('Hello {{name}}!', {})).toThrow('Missing template variable: name')
  })

  test('throws for malformed variable names', () => {
    expect(() => renderTemplate('Hello {{bad-var}}!', { 'bad-var': 'x' })).toThrow(
      'Invalid template variable "bad-var"'
    )
  })
})

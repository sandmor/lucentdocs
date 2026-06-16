import { describe, expect, test } from 'bun:test'
import {
  getBundledLanguages,
  getLanguagePickerOptions,
  normalizeLanguage,
  PLAIN_LANGUAGE,
  toPickerValue,
} from './code-block-languages'

describe('getLanguagePickerOptions', () => {
  test('has unique labels with no duplicate Python or Plain Text entries', () => {
    const options = getLanguagePickerOptions('')
    const labels = options.map((option) => option.label)
    const uniqueLabels = new Set(labels)

    expect(uniqueLabels.size).toBe(labels.length)
    expect(labels.filter((label) => label === 'Python')).toHaveLength(1)
    expect(labels.filter((label) => label === 'Plain Text')).toHaveLength(1)
  })

  test('excludes alias and plain-variant ids from the picker list', () => {
    const values = getLanguagePickerOptions('').map((option) => option.value)

    expect(values).toContain('python')
    expect(values).not.toContain('py')
    expect(values).not.toContain('text')
    expect(values).not.toContain('plaintext')
    expect(values.filter((value) => value === PLAIN_LANGUAGE)).toHaveLength(1)
  })

  test('appends unknown custom languages once as unsupported', () => {
    const options = getLanguagePickerOptions('not-a-real-language')

    expect(options.filter((option) => option.value === 'not-a-real-language')).toEqual([
      {
        value: 'not-a-real-language',
        label: 'Not A Real Language',
        unsupported: true,
      },
    ])
  })
})

describe('normalizeLanguage', () => {
  test('maps plain variants to plain', () => {
    expect(normalizeLanguage('plain')).toBe(PLAIN_LANGUAGE)
    expect(normalizeLanguage('text')).toBe(PLAIN_LANGUAGE)
    expect(normalizeLanguage('plaintext')).toBe(PLAIN_LANGUAGE)
  })
})

describe('toPickerValue', () => {
  test('maps empty stored language to plain', () => {
    expect(toPickerValue('')).toBe(PLAIN_LANGUAGE)
    expect(toPickerValue(undefined)).toBe(PLAIN_LANGUAGE)
  })

  test('maps aliases to canonical picker ids', () => {
    expect(toPickerValue('js')).toBe('javascript')
    expect(toPickerValue('html')).toBe('markup')
  })

  test('returns unknown custom languages as-is', () => {
    expect(toPickerValue('not-a-real-language')).toBe('not-a-real-language')
  })
})

describe('getBundledLanguages', () => {
  test('includes canonical ids that are filtered out of the picker', () => {
    const bundled = getBundledLanguages()

    expect(bundled).toContain('python')
    expect(bundled).not.toContain('py')
  })
})

import { describe, expect, test } from 'bun:test'
import {
  escapeXmlAttribute,
  escapeXmlText,
  formatXmlElement,
  formatXmlSelfClosingTag,
} from './structured-output.js'

describe('structured-output', () => {
  test('escapeXmlAttribute encodes attribute-breaking characters', () => {
    expect(escapeXmlAttribute('chapters/"one".md')).toBe('chapters/&quot;one&quot;.md')
    expect(escapeXmlAttribute('a & b <c>')).toBe('a &amp; b &lt;c&gt;')
  })

  test('escapeXmlText encodes text-breaking characters', () => {
    expect(escapeXmlText('Moonlight & <annotation />')).toBe('Moonlight &amp; &lt;annotation /&gt;')
  })

  test('formatXmlElement escapes attributes and text content', () => {
    const rendered = formatXmlElement('annotation', {
      attributes: { id: 'n1', anchor: 'block' },
      text: 'Author note with "quotes" & symbols',
    })

    expect(rendered).toContain('id="n1"')
    expect(rendered).toContain('anchor="block"')
    expect(rendered).toContain('Author note with "quotes" &amp; symbols')
  })

  test('formatXmlSelfClosingTag escapes attribute values', () => {
    expect(formatXmlSelfClosingTag('meta', { truncated: true, next_offset: 42 })).toBe(
      '<meta truncated="true" next_offset="42" />'
    )
  })
})

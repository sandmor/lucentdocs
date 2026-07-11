type XmlAttributeValue = string | number | boolean

export function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function formatXmlAttributes(attributes: Record<string, XmlAttributeValue>): string {
  const parts = Object.entries(attributes).map(
    ([name, value]) => `${name}="${escapeXmlAttribute(String(value))}"`
  )
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

export function formatXmlOpenTag(
  tag: string,
  attributes: Record<string, XmlAttributeValue> = {}
): string {
  return `<${tag}${formatXmlAttributes(attributes)}>`
}

export function formatXmlCloseTag(tag: string): string {
  return `</${tag}>`
}

export function formatXmlSelfClosingTag(
  tag: string,
  attributes: Record<string, XmlAttributeValue> = {}
): string {
  return `<${tag}${formatXmlAttributes(attributes)} />`
}

export function formatXmlElement(
  tag: string,
  options: {
    attributes?: Record<string, XmlAttributeValue>
    text?: string
    children?: string[]
  } = {}
): string {
  const body =
    options.text !== undefined
      ? escapeXmlText(options.text)
      : (options.children ?? []).join('\n')

  return `${formatXmlOpenTag(tag, options.attributes)}\n${body}\n${formatXmlCloseTag(tag)}`
}

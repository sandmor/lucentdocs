import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import { schema } from '@lucentdocs/shared'
import { createTestAdapter } from '../../testing/factory.js'
import { markdownToProseMirrorDoc, planMarkdownImport, runNativeMassImport } from './native.js'

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw result.error
  return result.value
}

function normalizePmJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePmJson(entry))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const input = value as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const key of Object.keys(input).sort()) {
    const child = input[key]
    const normalizedChild = normalizePmJson(child)

    if (key === 'attrs') {
      if (
        normalizedChild &&
        typeof normalizedChild === 'object' &&
        !Array.isArray(normalizedChild)
      ) {
        const attrs = { ...(normalizedChild as Record<string, unknown>) }
        if (attrs.tight === true) delete attrs.tight
        const filtered = Object.fromEntries(
          Object.entries(attrs).filter(([, value]) => value != null)
        )
        if (Object.keys(filtered).length === 0) continue
        out[key] = filtered
        continue
      }
    }

    out[key] = normalizedChild
  }

  return out
}

describe('planMarkdownImport', () => {
  test('splits on headings at selected level', () => {
    const markdown = ['# One', 'a', '', '# Two', 'b', '', '# Three', 'c'].join('\n')
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'heading', level: 1 },
      })
    )

    expect(result.parts.map((p) => p.suggestedTitle)).toEqual(['One', 'Two', 'Three'])
    expect(result.parts).toHaveLength(3)
  })

  test('splits on setext headings at selected level', () => {
    const markdown = ['One', '---', 'a', '', 'Two', '---', 'b', '', 'Three', '---', 'c'].join('\n')
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'heading', level: 2 },
      })
    )

    expect(result.parts.map((p) => p.suggestedTitle)).toEqual(['One', 'Two', 'Three'])
    expect(result.parts).toHaveLength(3)
  })

  test('does not split inside fenced code blocks', () => {
    const markdown = ['# One', '```', '# Not a heading', '```', '', '# Two', 'b'].join('\n')

    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'heading', level: 1 },
      })
    )

    expect(result.parts).toHaveLength(2)
  })

  test('converts inline HTML elements like br', () => {
    const markdown = ['Line<br>Two', '', 'A<br>B'].join('\n')
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    expect(result.parts[0]?.markdown).toContain('Line\\\nTwo')
    expect(result.parts[0]?.markdown).toContain('A\\\nB')
  })

  test('preserves links and images from HTML blocks', () => {
    const markdown = [
      '<p>See <a href="https://example.com">Example</a></p>',
      '<img src="image.png" alt="Alt text" />',
    ].join('\n')

    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('[Example](https://example.com)')
    expect(out).toContain('![Alt text](image.png)')
  })

  test('strips inline span anchors', () => {
    const markdown = 'Start <span id="chapter_1.xhtml"></span> End'
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('Start')
    expect(out).toContain('End')
  })

  test('does not touch span-like text inside inline code spans', () => {
    const markdown = 'Literal `<span id="x"></span>` stays'
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    expect(result.parts[0]?.markdown).toContain('`<span id="x"></span>`')
  })

  test('preserves CommonMark autolinks while converting other inline HTML', () => {
    const markdown = 'Link: <https://example.com> <span id="x"></span>'
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
      })
    )

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('<https://example.com>')
    expect(out).not.toContain('<span')
  })

  test('strips unsupported HTML blocks when rawHtmlMode is drop', () => {
    const markdown = ['Before', '', '<table><tr><td>Cell</td></tr></table>', '', 'After'].join('\n')
    const result = unwrap(
      planMarkdownImport(markdown, {
        maxDocChars: 10_000,
        split: { type: 'none' },
        rawHtmlMode: 'drop',
      })
    )

    const out = result.parts[0]?.markdown ?? ''
    expect(out).toContain('Before')
    expect(out).toContain('After')
    expect(out).not.toContain('<table')
    expect(out).not.toContain('```html')
  })
})

describe('markdownToProseMirrorDoc', () => {
  test('parses canonical inline and display math', () => {
    const result = markdownToProseMirrorDoc('Area $r^2$\n\n$$\n\\int_0^1 x\\,dx\n$$')
    expect(result).toEqual({
      ok: true,
      value: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Area ' },
              { type: 'math_inline', attrs: { latex: 'r^2' } },
            ],
          },
          { type: 'math_block', attrs: { latex: '\\int_0^1 x\\,dx' } },
        ],
      },
    })
  })

  test('parses nested GFM checklists into task-list attributes', () => {
    const result = markdownToProseMirrorDoc('- [x] Done\n  - [ ] Follow up\n- Plain')
    expect(result).toEqual({
      ok: true,
      value: {
        type: 'doc',
        content: [
          {
            type: 'bullet_list',
            attrs: { kind: 'task', tight: true },
            content: [
              {
                type: 'list_item',
                attrs: { checked: true },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Done' }] },
                  {
                    type: 'bullet_list',
                    attrs: { kind: 'task', tight: true },
                    content: [
                      {
                        type: 'list_item',
                        attrs: { checked: false },
                        content: [
                          { type: 'paragraph', content: [{ type: 'text', text: 'Follow up' }] },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'list_item',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain' }] }],
              },
            ],
          },
        ],
      },
    })
  })
})

describe('runNativeMassImport', () => {
  test('persists Yjs content that y-prosemirror can decode to parser-equivalent JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lucentdocs-native-import-yjs-'))
    const dbPath = join(dir, 'sqlite.db')
    const adapter = createTestAdapter({ dbPath })

    try {
      const project = await adapter.services.projects.create('Import', { ownerUserId: 'owner_1' })

      const markdown = [
        '# Heading',
        '',
        'A **bold** paragraph with a [link](https://example.com).',
        '',
        '- One',
        '- Two',
        '',
        '```ts',
        'console.log("x")',
        '```',
      ].join('\n')

      const parsed = markdownToProseMirrorDoc(markdown, { rawHtmlMode: 'code_block' })
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const result = await runNativeMassImport(adapter.adapter.engine, {
        projectId: project.id,
        documents: [{ title: 'rich.md', markdown }],
        parseFailureMode: 'fail',
        rawHtmlMode: 'code_block',
      })

      expect(result.failed).toHaveLength(0)
      expect(result.imported).toHaveLength(1)

      const importedId = result.imported[0]?.id
      expect(importedId).toBeTruthy()
      if (!importedId) return

      const persisted = await adapter.repositories.yjsDocuments.getPersisted(importedId)
      expect(persisted).toBeTruthy()
      expect((persisted?.length ?? 0) > 0).toBe(true)
      if (!persisted) return

      const ydoc = new Y.Doc()
      try {
        Y.applyUpdate(ydoc, new Uint8Array(persisted))
        const fromYjs = yXmlFragmentToProseMirrorRootNode(
          ydoc.getXmlFragment('prosemirror'),
          schema
        ).toJSON()
        expect(normalizePmJson(fromYjs)).toEqual(normalizePmJson(parsed.value))
      } finally {
        ydoc.destroy()
      }
    } finally {
      void adapter.adapter.engine.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('respects rawHtmlMode=drop in persisted Yjs output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lucentdocs-native-import-drop-html-'))
    const dbPath = join(dir, 'sqlite.db')
    const adapter = createTestAdapter({ dbPath })

    try {
      const project = await adapter.services.projects.create('Import', { ownerUserId: 'owner_1' })
      const markdown = ['Before', '', '<table><tr><td>Cell</td></tr></table>', '', 'After'].join(
        '\n'
      )

      const parsed = markdownToProseMirrorDoc(markdown, { rawHtmlMode: 'drop' })
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const result = await runNativeMassImport(adapter.adapter.engine, {
        projectId: project.id,
        documents: [{ title: 'drop.md', markdown }],
        parseFailureMode: 'fail',
        rawHtmlMode: 'drop',
      })

      expect(result.failed).toHaveLength(0)
      expect(result.imported).toHaveLength(1)

      const importedId = result.imported[0]?.id
      expect(importedId).toBeTruthy()
      if (!importedId) return

      const persisted = await adapter.repositories.yjsDocuments.getPersisted(importedId)
      expect(persisted).toBeTruthy()
      if (!persisted) return

      const ydoc = new Y.Doc()
      try {
        Y.applyUpdate(ydoc, new Uint8Array(persisted))
        const fromYjs = yXmlFragmentToProseMirrorRootNode(
          ydoc.getXmlFragment('prosemirror'),
          schema
        ).toJSON()
        expect(normalizePmJson(fromYjs)).toEqual(normalizePmJson(parsed.value))
      } finally {
        ydoc.destroy()
      }
    } finally {
      void adapter.adapter.engine.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

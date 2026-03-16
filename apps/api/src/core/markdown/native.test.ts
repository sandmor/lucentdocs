import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { createSqliteAdapter } from '../../infrastructure/sqlite/factory.js'
import {
  markdownToProseMirrorDoc,
  planMarkdownImport,
  runNativeMassImportSqlite,
} from './native.js'

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

  for (const [key, child] of Object.entries(input)) {
    const normalizedChild = normalizePmJson(child)

    if (key === 'attrs') {
      if (
        normalizedChild &&
        typeof normalizedChild === 'object' &&
        !Array.isArray(normalizedChild) &&
        Object.keys(normalizedChild as Record<string, unknown>).length === 0
      ) {
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

describe('runNativeMassImportSqlite', () => {
  test('persists Yjs content that y-prosemirror can decode to parser-equivalent JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lucentdocs-native-import-yjs-'))
    const dbPath = join(dir, 'sqlite.db')
    const adapter = createSqliteAdapter(dbPath)

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

      const result = await runNativeMassImportSqlite(dbPath, {
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
        const fromYjs = yDocToProsemirrorJSON(ydoc)
        expect(normalizePmJson(fromYjs)).toEqual(normalizePmJson(parsed.value))
      } finally {
        ydoc.destroy()
      }
    } finally {
      adapter.connection.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('respects rawHtmlMode=drop in persisted Yjs output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lucentdocs-native-import-drop-html-'))
    const dbPath = join(dir, 'sqlite.db')
    const adapter = createSqliteAdapter(dbPath)

    try {
      const project = await adapter.services.projects.create('Import', { ownerUserId: 'owner_1' })
      const markdown = ['Before', '', '<table><tr><td>Cell</td></tr></table>', '', 'After'].join(
        '\n'
      )

      const parsed = markdownToProseMirrorDoc(markdown, { rawHtmlMode: 'drop' })
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const result = await runNativeMassImportSqlite(dbPath, {
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
        const fromYjs = yDocToProsemirrorJSON(ydoc)
        expect(normalizePmJson(fromYjs)).toEqual(normalizePmJson(parsed.value))
      } finally {
        ydoc.destroy()
      }
    } finally {
      adapter.connection.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

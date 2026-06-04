import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Check, Copy } from 'lucide-react'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const PLAIN_LANGUAGE = 'plain'

const LANGUAGES = [
  { value: PLAIN_LANGUAGE, label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'bash', label: 'Bash' },
]

function toSelectLanguage(language: string): string {
  return language || PLAIN_LANGUAGE
}

function fromSelectLanguage(language: string): string {
  return language === PLAIN_LANGUAGE ? '' : language
}

function LanguageSelector({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  return (
    <Select
      value={toSelectLanguage(value)}
      onValueChange={(val) => onChange(fromSelectLanguage(val ?? PLAIN_LANGUAGE))}
    >
      <SelectTrigger
        className="h-7 w-32 border-none bg-transparent text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:ring-0 shadow-none px-2"
      >
        <SelectValue placeholder="Language" />
      </SelectTrigger>
      <SelectContent align="start" className="w-40">
        {LANGUAGES.map((lang) => (
          <SelectItem key={lang.value} value={lang.value}>
            {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function CopyCodeButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = React.useState(false)

  return (
    <button
      type="button"
      className="code-block-copy-btn"
      title={copied ? 'Copied' : 'Copy code'}
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

export class CodeBlockNodeView implements NodeView {
  node: ProseMirrorNode
  view: EditorView
  getPos: boolean | (() => number | undefined)
  dom: HTMLElement
  contentDOM: HTMLElement
  reactRoot: Root | null = null
  reactRootElement: HTMLDivElement
  copyRoot: Root | null = null
  copyRootElement: HTMLDivElement

  constructor(node: ProseMirrorNode, view: EditorView, getPos: boolean | (() => number | undefined)) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('div')
    this.dom.className = 'code-block-wrapper'

    const header = document.createElement('div')
    header.className = 'code-block-header'
    header.contentEditable = 'false'

    this.reactRootElement = document.createElement('div')
    header.appendChild(this.reactRootElement)
    this.reactRoot = createRoot(this.reactRootElement)

    this.copyRootElement = document.createElement('div')
    header.appendChild(this.copyRootElement)
    this.copyRoot = createRoot(this.copyRootElement)

    this.renderReact()

    const pre = document.createElement('pre')
    pre.setAttribute('data-language', node.attrs.language || '')

    this.contentDOM = document.createElement('code')
    this.contentDOM.spellcheck = false

    pre.appendChild(this.contentDOM)
    this.dom.appendChild(header)
    this.dom.appendChild(pre)
  }

  handleLanguageChange = (val: string) => {
    if (typeof this.getPos !== 'function') return
    const pos = this.getPos()
    if (typeof pos === 'number') {
      const tr = this.view.state.tr.setNodeMarkup(pos, null, {
        ...this.node.attrs,
        language: val,
      })
      this.view.dispatch(tr)
    }
  }

  renderReact() {
    if (this.reactRoot) {
      this.reactRoot.render(
        <LanguageSelector
          value={this.node.attrs.language || ''}
          onChange={this.handleLanguageChange}
        />
      )
    }

    if (this.copyRoot) {
      this.copyRoot.render(<CopyCodeButton getText={() => this.node.textContent} />)
    }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node

    this.renderReact()

    const pre = this.dom.querySelector('pre')
    if (pre) {
      pre.setAttribute('data-language', node.attrs.language || '')
    }

    return true
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false
    return (mutation.target as HTMLElement).closest('.code-block-header') !== null
  }

  stopEvent(event: Event): boolean {
    return (event.target as HTMLElement).closest('.code-block-header') !== null
  }

  destroy() {
    if (this.reactRoot) {
      this.reactRoot.unmount()
      this.reactRoot = null
    }
    if (this.copyRoot) {
      this.copyRoot.unmount()
      this.copyRoot = null
    }
  }
}

export function createCodeBlockNodeView() {
  return {
    code_block(node: ProseMirrorNode, view: EditorView, getPos: boolean | (() => number | undefined)) {
      return new CodeBlockNodeView(node, view, getPos)
    },
  }
}

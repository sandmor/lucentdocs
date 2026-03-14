declare module 'parse5' {
  export function parseFragment(input: string): unknown
  export function serialize(node: unknown): string
}

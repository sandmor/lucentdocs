import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { NativeStorageEngine } from '@lucentdocs/core'

export function openRustStorageSync(dbPath: string): NativeStorageEngine {
  const resolvedPath = dbPath === ':memory:' ? dbPath : resolve(dbPath)
  if (resolvedPath !== ':memory:') {
    mkdirSync(dirname(resolvedPath), { recursive: true })
  }

  return NativeStorageEngine.openSync(resolvedPath)
}

export async function openRustStorage(dbPath: string): Promise<NativeStorageEngine> {
  const resolvedPath = dbPath === ':memory:' ? dbPath : resolve(dbPath)
  if (resolvedPath !== ':memory:') {
    mkdirSync(dirname(resolvedPath), { recursive: true })
  }

  return NativeStorageEngine.open(resolvedPath)
}

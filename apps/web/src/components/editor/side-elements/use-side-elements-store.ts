import { createContext, useContext, useSyncExternalStore } from 'react'
import type { SideElementDescriptor } from './side-element-types'

export interface SideElementsStore {
  layoutEpoch: number
  resolvedTops: Map<string, number>
}

export interface SideElementsContextValue {
  register: (descriptor: SideElementDescriptor) => void
  unregister: (id: string) => void
  updateDescriptor: (id: string, patch: Partial<Omit<SideElementDescriptor, 'id'>>) => void
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SideElementsStore
}

export const SideElementsContext = createContext<SideElementsContextValue | null>(null)

export function useSideElementsContext(): SideElementsContextValue {
  const context = useContext(SideElementsContext)
  if (!context) {
    throw new Error('useSideElementsContext must be used within SideElementsProvider')
  }
  return context
}

export function useSideElementsStore(): SideElementsStore {
  const { subscribe, getSnapshot } = useSideElementsContext()
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

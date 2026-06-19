import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { EditorView } from 'prosemirror-view'
import { subscribeEditorView } from '../prosemirror/view-store'
import { stackSideElements } from './layout'
import type { SideElementDescriptor, SideElementGutter } from './side-element-types'
import {
  SideElementsContext,
  type SideElementsContextValue,
  type SideElementsStore,
} from './use-side-elements-store'

function recomputeResolvedTops(
  registry: Map<string, SideElementDescriptor>
): Map<string, number> {
  const byGutter = new Map<SideElementGutter, SideElementDescriptor[]>()
  for (const descriptor of registry.values()) {
    const list = byGutter.get(descriptor.gutter) ?? []
    list.push(descriptor)
    byGutter.set(descriptor.gutter, list)
  }

  const resolved = new Map<string, number>()
  for (const [, items] of byGutter) {
    const sorted = [...items].sort((left, right) => {
      if (left.desiredTop !== right.desiredTop) return left.desiredTop - right.desiredTop
      return left.order - right.order
    })
    const positions = stackSideElements(
      sorted.map((item) => ({
        id: item.id,
        desiredTop: item.desiredTop,
        height: item.height,
      }))
    )
    for (const [id, top] of positions) {
      resolved.set(id, top)
    }
  }
  return resolved
}

interface SideElementsProviderProps {
  view: EditorView | null
  container: HTMLElement | null
  children: React.ReactNode
}

export function SideElementsProvider({ view, container, children }: SideElementsProviderProps) {
  const registryRef = useRef(new Map<string, SideElementDescriptor>())
  const storeRef = useRef<SideElementsStore>({
    layoutEpoch: 0,
    resolvedTops: new Map(),
  })
  const listenersRef = useRef(new Set<() => void>())

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) {
      listener()
    }
  }, [])

  const recompute = useCallback(() => {
    storeRef.current = {
      ...storeRef.current,
      resolvedTops: recomputeResolvedTops(registryRef.current),
    }
    notify()
  }, [notify])

  const register = useCallback(
    (descriptor: SideElementDescriptor) => {
      registryRef.current.set(descriptor.id, descriptor)
      recompute()
    },
    [recompute]
  )

  const unregister = useCallback(
    (id: string) => {
      if (!registryRef.current.has(id)) return
      registryRef.current.delete(id)
      recompute()
    },
    [recompute]
  )

  const updateDescriptor = useCallback(
    (id: string, patch: Partial<Omit<SideElementDescriptor, 'id'>>) => {
      const existing = registryRef.current.get(id)
      if (!existing) return
      registryRef.current.set(id, { ...existing, ...patch })
      recompute()
    },
    [recompute]
  )

  const layoutFrameRef = useRef(0)

  useEffect(() => {
    if (!view) return

    const scheduleRefresh = () => {
      cancelAnimationFrame(layoutFrameRef.current)
      layoutFrameRef.current = requestAnimationFrame(() => {
        storeRef.current = {
          ...storeRef.current,
          layoutEpoch: storeRef.current.layoutEpoch + 1,
        }
        notify()
      })
    }

    const unsubscribe = subscribeEditorView(view, scheduleRefresh)
    const resizeObserver = new ResizeObserver(scheduleRefresh)
    resizeObserver.observe(view.dom)
    if (container) resizeObserver.observe(container)
    window.addEventListener('resize', scheduleRefresh)
    window.addEventListener('scroll', scheduleRefresh, true)

    return () => {
      cancelAnimationFrame(layoutFrameRef.current)
      unsubscribe()
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleRefresh)
      window.removeEventListener('scroll', scheduleRefresh, true)
    }
  }, [view, container, notify])

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  const getSnapshot = useCallback(() => storeRef.current, [])

  const contextValue = useMemo(
    (): SideElementsContextValue => ({
      register,
      unregister,
      updateDescriptor,
      subscribe,
      getSnapshot,
    }),
    [register, unregister, updateDescriptor, subscribe, getSnapshot]
  )

  return (
    <SideElementsContext.Provider value={contextValue}>{children}</SideElementsContext.Provider>
  )
}

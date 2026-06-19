import { useCallback, useEffect, useRef, useState } from 'react'
import type { SideElementGutter } from './side-element-types'
import { useSideElementsContext, useSideElementsStore } from './use-side-elements-store'

interface UseSideElementOptions {
  id: string
  gutter: SideElementGutter
  desiredTop: number
  order?: number
  enabled?: boolean
}

export function useSideElement({
  id,
  gutter,
  desiredTop,
  order = 0,
  enabled = true,
}: UseSideElementOptions) {
  const { register, unregister, updateDescriptor } = useSideElementsContext()
  const store = useSideElementsStore()
  const [measuredNode, setMeasuredNode] = useState<HTMLElement | null>(null)
  const heightRef = useRef(40)

  useEffect(() => {
    if (!enabled) return
    register({
      id,
      gutter,
      desiredTop,
      height: heightRef.current,
      order,
    })
    return () => unregister(id)
  }, [enabled, id, gutter, desiredTop, order, register, unregister])

  useEffect(() => {
    if (!enabled || !measuredNode) return

    const reportHeight = () => {
      const height = measuredNode.getBoundingClientRect().height
      if (height <= 0) return
      if (Math.abs(heightRef.current - height) < 0.5) return
      heightRef.current = height
      updateDescriptor(id, { height })
    }

    reportHeight()
    const observer = new ResizeObserver(reportHeight)
    observer.observe(measuredNode)
    return () => observer.disconnect()
  }, [enabled, id, measuredNode, updateDescriptor])

  const measureRef = useCallback((node: HTMLElement | null) => {
    setMeasuredNode(node)
  }, [])

  const resolvedTop = enabled ? store.resolvedTops.get(id) : undefined

  return {
    resolvedTop,
    measureRef,
  }
}

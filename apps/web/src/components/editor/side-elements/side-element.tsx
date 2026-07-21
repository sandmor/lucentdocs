import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { SideElementGutter } from './side-element-types'
import { useSideElement } from './use-side-element'

interface SideElementProps {
  id: string
  gutter: SideElementGutter
  desiredTop: number
  left: number
  order?: number
  enabled?: boolean
  className?: string
  children: React.ReactNode
  /** Attach to the element whose height drives stacking (defaults to the outer wrapper). */
  measureTarget?: 'self' | 'child'
}

function positionTransition(reducedMotion: boolean | null) {
  if (reducedMotion) return { duration: 0 }
  return { duration: 0.14, ease: [0.22, 1, 0.36, 1] as const }
}

export function SideElement({
  id,
  gutter,
  desiredTop,
  left,
  order = 0,
  enabled = true,
  className,
  children,
  measureTarget = 'self',
}: SideElementProps) {
  const shouldReduceMotion = useReducedMotion()
  const { resolvedTop, measureRef } = useSideElement({
    id,
    gutter,
    desiredTop,
    order,
    enabled,
  })

  const top = resolvedTop ?? desiredTop
  const transition = positionTransition(shouldReduceMotion)

  return (
    <motion.div
      ref={measureTarget === 'self' ? measureRef : undefined}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={transition}
      className={cn('pointer-events-auto absolute z-58', className)}
      data-editor-floating-obstacle="true"
      style={{
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
      }}
    >
      {measureTarget === 'child' ? (
        <div ref={measureRef}>{children}</div>
      ) : (
        children
      )}
    </motion.div>
  )
}

export function SideElementLayer({ children }: { children: React.ReactNode }) {
  return <AnimatePresence>{children}</AnimatePresence>
}

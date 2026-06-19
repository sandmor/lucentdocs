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
  return { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.8 }
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
      layout="position"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={transition}
      className={cn('pointer-events-auto absolute z-58', className)}
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

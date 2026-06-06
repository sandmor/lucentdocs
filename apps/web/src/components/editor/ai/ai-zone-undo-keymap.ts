import type { Command } from 'prosemirror-state'
import { undo as yUndo, redo as yRedo } from 'y-prosemirror'
import { canUndoSessionTurn } from '@lucentdocs/shared'
import { toast } from 'sonner'
import { hasStreamingAIZone } from './ai-zone-protection'
import { resolveSessionUndoTarget } from './ai-zone-undo-target'
import type { AIWriterController } from './writer/types'

export function buildAIZoneUndoCommands(controller: AIWriterController): Record<string, Command> {
  const undoWithAIZonePolicy: Command = (state, dispatch, view) => {
    if (!view) return false

    if (hasStreamingAIZone(view)) {
      toast.message('Finish or stop AI generation before undoing.')
      return true
    }

    const target = resolveSessionUndoTarget(view, {
      isInlineAIControlsInteracting: controller.isInlineAIControlsInteracting,
    })
    if (target) {
      const session = controller.getSessionById(target.sessionId)
      if (canUndoSessionTurn(session)) {
        void controller.undoSessionTurn(view, target.sessionId)
        return true
      }
    }

    return yUndo(state, dispatch, view)
  }

  const redoWithAIZonePolicy: Command = (state, dispatch, view) => {
    if (!view) return false

    if (hasStreamingAIZone(view)) {
      toast.message('Finish or stop AI generation before redoing.')
      return true
    }

    const target = resolveSessionUndoTarget(view, {
      isInlineAIControlsInteracting: controller.isInlineAIControlsInteracting,
    })
    if (target) {
      const session = controller.getSessionById(target.sessionId)
      if ((session?.redoTurnCheckpoints?.length ?? 0) > 0) {
        void controller.redoSessionTurn(view, target.sessionId)
        return true
      }
    }

    return yRedo(state, dispatch, view)
  }

  return {
    'Mod-z': undoWithAIZonePolicy,
    'Mod-Shift-z': redoWithAIZonePolicy,
    'Mod-y': redoWithAIZonePolicy,
  }
}

/**
 * Stuck detection algorithm for AI streaming.
 *
 * The spinner in floating controls should only appear when generation is "stuck"
 * (i.e., no tokens have arrived for an unusually long time). This avoids showing
 * a distracting spinner during normal fast streaming.
 *
 * Algorithm:
 * 1. Track timestamps of incoming chunks in a rolling buffer (max MAX_SAMPLES)
 * 2. Only consider "stuck" after 2+ chunks (need a baseline average)
 * 3. When a chunk arrives:
 *    - Calculate delta from previous chunk
 *    - If delta >= current_average * SPIKE_MULTIPLIER, it's a "spike" pause -
 *      DON'T add to average (prevents skewing baseline after long pauses)
 *    - Otherwise, add timestamp to rolling buffer
 * 4. Set a "stuck timeout" = max(current_average * STUCK_MULTIPLIER, MIN_TIMEOUT_MS)
 * 5. If timeout fires before next chunk → call onStuckStart callback
 * 6. On next chunk → clear timeout, call onStuckStop callback
 *
 * Constants:
 * - MIN_TIMEOUT_MS (1000): Floor to prevent flicker on fast connections
 * - STUCK_MULTIPLIER (3): Show spinner after 3x average wait time
 * - SPIKE_MULTIPLIER (3): Pauses this long are excluded from average calculation
 * - MAX_SAMPLES (5): Rolling average window size
 *
 * Example flow:
 *   Chunk 1: 0ms     → no avg yet, no stuck detection
 *   Chunk 2: 100ms   → avg=100ms, timeout=300ms
 *   Chunk 3: 150ms   → avg=125ms, timeout=375ms
 *   ...5000ms pause (spinner shows at ~375ms)...
 *   Chunk 4: 5000ms  → delta=4850ms > 125*3, SPIKE - keep avg=125ms
 *   Chunk 5: 130ms   → delta=130ms, add to avg → avg=~128ms
 */

const MIN_TIMEOUT_MS = 1000
const STUCK_MULTIPLIER = 3
const SPIKE_MULTIPLIER = 3
const MAX_SAMPLES = 5

export interface StuckDetectorCallbacks {
  onStuckStart: () => void
  onStuckStop: () => void
}

export class StuckDetector {
  private chunkTimestamps: number[] = []
  private stuckTimeoutId: ReturnType<typeof setTimeout> | null = null
  private readonly callbacks: StuckDetectorCallbacks

  constructor(callbacks: StuckDetectorCallbacks) {
    this.callbacks = callbacks
  }

  onChunk(): void {
    const now = Date.now()
    const avgInterval = this.calculateAverageInterval()

    this.clearStuckTimeout()
    this.callbacks.onStuckStop()

    if (avgInterval !== null && this.chunkTimestamps.length > 0) {
      const lastDelta = now - this.chunkTimestamps[this.chunkTimestamps.length - 1]
      if (lastDelta >= avgInterval * SPIKE_MULTIPLIER) {
        this.chunkTimestamps = [now]
        return
      }
    }

    this.chunkTimestamps.push(now)
    if (this.chunkTimestamps.length > MAX_SAMPLES) {
      this.chunkTimestamps = this.chunkTimestamps.slice(-MAX_SAMPLES)
    }

    const currentAvg = this.calculateAverageInterval()
    if (currentAvg !== null) {
      const timeoutMs = Math.max(currentAvg * STUCK_MULTIPLIER, MIN_TIMEOUT_MS)
      this.stuckTimeoutId = setTimeout(() => this.callbacks.onStuckStart(), timeoutMs)
    }
  }

  reset(): void {
    this.clearStuckTimeout()
    this.chunkTimestamps = []
  }

  private clearStuckTimeout(): void {
    if (this.stuckTimeoutId) {
      clearTimeout(this.stuckTimeoutId)
      this.stuckTimeoutId = null
    }
  }

  private calculateAverageInterval(): number | null {
    if (this.chunkTimestamps.length < 2) return null
    const intervals: number[] = []
    for (let i = 1; i < this.chunkTimestamps.length; i++) {
      intervals.push(this.chunkTimestamps[i] - this.chunkTimestamps[i - 1])
    }
    return intervals.reduce((a, b) => a + b, 0) / intervals.length
  }
}

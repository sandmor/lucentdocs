import type {
  EmbeddingIndexRuntimeConfig,
  EmbeddingIndexService,
} from '../core/services/embeddingIndex.service.js'

const EMBEDDING_RUNTIME_TICK_MS = 1_000
const EMBEDDING_RUNTIME_ERROR_BACKOFF_BASE_MS = 5_000
const EMBEDDING_RUNTIME_ERROR_BACKOFF_MAX_MS = 30_000

export interface EmbeddingRuntimeOptions {
  tickMs?: number
  now?: () => number
  errorBackoffBaseMs?: number
  errorBackoffMaxMs?: number
}

export class EmbeddingRuntime {
  #timer: ReturnType<typeof setInterval> | null = null
  #running = false
  #config: EmbeddingIndexRuntimeConfig
  #service: EmbeddingIndexService
  #tickMs: number
  #now: () => number
  #errorBackoffBaseMs: number
  #errorBackoffMaxMs: number
  #cooldownUntil = 0
  #consecutiveFailures = 0

  constructor(
    service: EmbeddingIndexService,
    config: EmbeddingIndexRuntimeConfig,
    options: EmbeddingRuntimeOptions = {}
  ) {
    this.#service = service
    this.#config = config
    this.#tickMs = options.tickMs ?? EMBEDDING_RUNTIME_TICK_MS
    this.#now = options.now ?? Date.now
    this.#errorBackoffBaseMs = options.errorBackoffBaseMs ?? EMBEDDING_RUNTIME_ERROR_BACKOFF_BASE_MS
    this.#errorBackoffMaxMs = options.errorBackoffMaxMs ?? EMBEDDING_RUNTIME_ERROR_BACKOFF_MAX_MS
  }

  async tickOnce(now = this.#now()): Promise<void> {
    if (this.#cooldownUntil > 0 && now < this.#cooldownUntil) return

    try {
      await this.#service.flushDueQueue(this.#config, now)
      this.#consecutiveFailures = 0
      this.#cooldownUntil = 0
    } catch (error) {
      this.#consecutiveFailures += 1
      const exponent = Math.min(10, Math.max(0, this.#consecutiveFailures - 1))
      const backoffMs = Math.min(this.#errorBackoffMaxMs, this.#errorBackoffBaseMs * 2 ** exponent)
      this.#cooldownUntil = now + backoffMs
      console.error(
        `Failed to flush embedding queue (attempt ${this.#consecutiveFailures}). Next attempt in ${backoffMs}ms.`,
        error
      )
    }
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#timer = setInterval(() => {
      if (!this.#running) return
      void this.tickOnce()
    }, this.#tickMs)

    if (typeof this.#timer.unref === 'function') {
      this.#timer.unref()
    }
  }

  stop(): void {
    this.#running = false
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = null
    this.#cooldownUntil = 0
    this.#consecutiveFailures = 0
  }

  reloadConfig(config: EmbeddingIndexRuntimeConfig): void {
    this.#config = config
  }

  async flushNow(): Promise<void> {
    await this.#service.flushDueQueue(this.#config)
  }
}

export function createEmbeddingRuntime(
  service: EmbeddingIndexService,
  config: EmbeddingIndexRuntimeConfig,
  options?: EmbeddingRuntimeOptions
): EmbeddingRuntime {
  return new EmbeddingRuntime(service, config, options)
}

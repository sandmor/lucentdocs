import type {
  EmbeddingIndexRuntimeConfig,
  EmbeddingIndexService,
} from '../core/services/embeddingIndex.service.js'

const EMBEDDING_RUNTIME_TICK_MS = 1_000

export class EmbeddingRuntime {
  #timer: ReturnType<typeof setInterval> | null = null
  #running = false
  #config: EmbeddingIndexRuntimeConfig
  #service: EmbeddingIndexService

  constructor(service: EmbeddingIndexService, config: EmbeddingIndexRuntimeConfig) {
    this.#service = service
    this.#config = config
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#timer = setInterval(() => {
      void this.#service.flushDueQueue(this.#config).catch((error) => {
        console.error('Failed to flush embedding queue:', error)
      })
    }, EMBEDDING_RUNTIME_TICK_MS)

    if (typeof this.#timer.unref === 'function') {
      this.#timer.unref()
    }
  }

  stop(): void {
    this.#running = false
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = null
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
  config: EmbeddingIndexRuntimeConfig
): EmbeddingRuntime {
  return new EmbeddingRuntime(service, config)
}

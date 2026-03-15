import type { JobQueuePort } from '../../core/ports/jobQueue.port.js'

export class InMemoryJobQueue<Job> implements JobQueuePort<Job> {
  #queue: Job[] = []
  #handler: ((job: Job) => Promise<void>) | null = null
  #isDraining = false

  start(handler: (job: Job) => Promise<void>): void {
    this.#handler = handler
    void this.#drain()
  }

  async enqueue(job: Job): Promise<void> {
    this.#queue.push(job)
    void this.#drain()
  }

  async #drain(): Promise<void> {
    if (this.#isDraining || !this.#handler) return

    this.#isDraining = true
    try {
      while (this.#queue.length > 0) {
        const next = this.#queue.shift()
        if (!next) continue
        await this.#handler(next)
      }
    } finally {
      this.#isDraining = false
    }
  }
}

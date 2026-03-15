export interface JobQueuePort<Job> {
  enqueue(job: Job): Promise<void>
  start(handler: (job: Job) => Promise<void>): void
}

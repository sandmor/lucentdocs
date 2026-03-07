import type { JsonObject } from './json.js'

export interface Project {
  id: string
  title: string
  ownerUserId: string
  metadata: JsonObject | null
  createdAt: number
  updatedAt: number
}

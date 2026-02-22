import type { JsonObject } from './json.js'

export interface Document {
  id: string
  title: string
  type: string
  metadata: JsonObject | null
  createdAt: number
  updatedAt: number
}

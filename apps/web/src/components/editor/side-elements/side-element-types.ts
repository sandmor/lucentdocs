export type SideElementGutter = 'left' | 'right'

export interface SideElementDescriptor {
  id: string
  gutter: SideElementGutter
  desiredTop: number
  height: number
  order: number
}

const ID_REGEX = /^[A-Za-z0-9_-]+$/

export function isValidId(id: string): boolean {
  return ID_REGEX.test(id)
}

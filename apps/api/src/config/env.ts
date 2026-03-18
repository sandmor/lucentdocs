function hasEnvValue(env: NodeJS.ProcessEnv, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key)
}

export function readTrimmedEnvValue(
  env: NodeJS.ProcessEnv,
  key: string,
  options: { allowEmpty?: boolean } = {}
): string | undefined {
  if (!hasEnvValue(env, key)) return undefined
  const raw = env[key]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!options.allowEmpty && trimmed.length === 0) return undefined
  return trimmed
}

export function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

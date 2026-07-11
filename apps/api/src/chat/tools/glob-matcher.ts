export function globPatternToRegExp(pattern: string): RegExp {
  let regex = '^'
  let index = 0

  while (index < pattern.length) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        regex += '(?:.*/)?'
        index += 3
        continue
      }
      regex += '.*'
      index += 2
      continue
    }

    if (char === '*') {
      regex += '[^/]*'
      index += 1
      continue
    }

    if (char === '?') {
      regex += '[^/]'
      index += 1
      continue
    }

    regex += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    index += 1
  }

  regex += '$'
  return new RegExp(regex)
}

export function pathMatchesGlob(pattern: string, path: string): boolean {
  return globPatternToRegExp(pattern).test(path)
}

export function pathMatchesInclude(include: string, path: string): boolean {
  const fileName = path.split('/').pop() ?? path
  return pathMatchesGlob(include, fileName) || pathMatchesGlob(include, path)
}

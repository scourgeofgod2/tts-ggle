export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** Split free text into API-sized chunks at sentence boundaries. */
export function chunkText(text: string, maxChars = 1500): string[] {
  const t = normalizeNewlines(text).trim()
  if (!t) return []
  if (t.length <= maxChars) return [t]

  const sentences = t.split(/(?<=[.!?…])\s+/)
  const pieces: string[] = []
  let current = ''

  for (const s of sentences) {
    if (current && current.length + s.length + 1 > maxChars) {
      pieces.push(current)
      current = s
    } else {
      current = current ? `${current} ${s}` : s
    }
  }
  if (current) pieces.push(current)

  return pieces.flatMap((p) => {
    if (p.length <= maxChars) return [p]
    const hard: string[] = []
    for (let i = 0; i < p.length; i += maxChars) hard.push(p.slice(i, i + maxChars))
    return hard
  })
}

const KNOWN_TAG_RE = /<([^>]+)>/g

export function validateTags(text: string, known: readonly string[]): string[] {
  const warnings: string[] = []
  const set = new Set(known.map((t) => t.toLowerCase()))
  let m: RegExpExecArray | null
  while ((m = KNOWN_TAG_RE.exec(text)) !== null) {
    const tag = m[1].trim().toLowerCase()
    if (!set.has(tag)) warnings.push(`Bilinmeyen etiket: <${m[1].trim()}>`)
  }
  return warnings
}

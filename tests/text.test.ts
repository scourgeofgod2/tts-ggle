import { describe, expect, it } from 'vitest'
import { chunkText, validateTags } from '../src/lib/text'
import { INLINE_TAGS } from '../src/config/constants'

describe('chunkText', () => {
  it('returns empty for blank input', () => {
    expect(chunkText('   ')).toEqual([])
  })

  it('keeps short text as one chunk', () => {
    expect(chunkText('Merhaba dünya.')).toEqual(['Merhaba dünya.'])
  })

  it('splits long text at sentence boundaries', () => {
    const sentence = 'Bu bir test cümlesidir. '
    const text = sentence.repeat(200)
    const chunks = chunkText(text, 500)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 500)).toBe(true)
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim().length).toBeGreaterThan(0)
  })
})

describe('validateTags', () => {
  it('accepts known vocal burst tags', () => {
    expect(validateTags('Merhaba <laugh> nasılsın <short pause> ?', INLINE_TAGS)).toEqual([])
  })

  it('warns on unknown tags', () => {
    const warnings = validateTags('Test <bilinmeyen> etiket', INLINE_TAGS)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('bilinmeyen')
  })
})

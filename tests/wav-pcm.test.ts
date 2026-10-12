import { describe, expect, it } from 'vitest'
import { concatInt16, stripWavHeaderIfPresent, bytesToInt16, int16ToBytes } from '../src/lib/pcm'
import { encodeWav } from '../src/lib/wav'

describe('pcm', () => {
  it('concats Int16 chunks', () => {
    const a = new Int16Array([1, 2, 3])
    const b = new Int16Array([4, 5])
    const all = concatInt16([a, b])
    expect(Array.from(all)).toEqual([1, 2, 3, 4, 5])
  })

  it('handles empty chunks', () => {
    expect(concatInt16([]).length).toBe(0)
    expect(concatInt16([new Int16Array(0), new Int16Array([1])]).length).toBe(1)
  })

  it('round-trips bytes and Int16', () => {
    const pcm = new Int16Array([1000, -2000, 3000])
    const bytes = int16ToBytes(pcm)
    const back = bytesToInt16(bytes)
    expect(Array.from(back)).toEqual([1000, -2000, 3000])
  })

  it('strips RIFF header when present', () => {
    const pcm = new Int16Array([1, 2, 3, 4])
    const wav = encodeWav(pcm)
    // encodeWav returns Blob — not ideal for unit test of strip; build bytes manually
    const payload = int16ToBytes(pcm)
    const full = new Uint8Array(44 + payload.length)
    full.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    full.set([0x57, 0x41, 0x56, 0x45], 8) // WAVE
    full.set(payload, 44)
    const stripped = stripWavHeaderIfPresent(full)
    expect(stripped.length).toBe(payload.length)
  })

  it('leaves non-wav bytes alone', () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    expect(stripWavHeaderIfPresent(raw)).toBe(raw)
  })
})

describe('wav', () => {
  it('encodes valid WAV structure', async () => {
    const pcm = new Int16Array(100).fill(1234)
    const blob = encodeWav(pcm, 24000)
    const buf = new Uint8Array(await blob.arrayBuffer())
    expect(buf.length).toBe(44 + 200)
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...buf.slice(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...buf.slice(36, 40))).toBe('data')
  })
})

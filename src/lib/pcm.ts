export function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  // Ensure even length for 16-bit samples
  const even = bytes.length - (bytes.length % 2)
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + even))
}

export function concatInt16(chunks: Int16Array[]): Int16Array {
  const nonEmpty = chunks.filter((c) => c.length > 0)
  if (nonEmpty.length === 0) return new Int16Array(0)
  if (nonEmpty.length === 1) return nonEmpty[0]
  let total = 0
  for (const c of nonEmpty) total += c.length
  const out = new Int16Array(total)
  let offset = 0
  for (const c of nonEmpty) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/** If buffer starts with RIFF/WAVE, return PCM payload after 44-byte header. */
export function stripWavHeaderIfPresent(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 44) {
    const riff = String.fromCharCode(...bytes.slice(0, 4))
    const wave = String.fromCharCode(...bytes.slice(8, 12))
    if (riff === 'RIFF' && wave === 'WAVE') {
      // Find "data" chunk for robustness; fall back to 44-byte header
      for (let i = 12; i < bytes.length - 8; i++) {
        const tag = String.fromCharCode(...bytes.slice(i, i + 4))
        if (tag === 'data') {
          return bytes.slice(i + 8)
        }
      }
      return bytes.slice(44)
    }
  }
  return bytes
}

export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const even = bytes.length - (bytes.length % 2)
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + even))
}

export function int16ToBytes(pcm: Int16Array): Uint8Array {
  return new Uint8Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength))
}

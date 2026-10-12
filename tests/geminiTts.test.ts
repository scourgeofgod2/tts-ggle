import { describe, expect, it } from 'vitest'
import {
  buildGenerateContentTtsRequest,
  decodeAudioToInt16,
} from '../src/lib/geminiTts'
import { DEFAULT_MODEL, TTS_MODELS } from '../src/config/constants'
import { int16ToBytes } from '../src/lib/pcm'

describe('buildGenerateContentTtsRequest', () => {
  it('matches generateContent TTS schema', () => {
    const req = buildGenerateContentTtsRequest({
      text: 'Merhaba dünya <laugh>',
      voice: 'voice_abc123',
      style: 'warm and conversational',
    })

    expect(req.contents[0].role).toBe('user')
    const part = req.contents[0].parts[0]
    expect(part.text).toBe('Merhaba dünya <laugh>')
    expect(part.speech_metadata).toEqual({ style: 'warm and conversational' })

    expect(req.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(req.generationConfig.speechConfig.voiceConfig).toEqual({
      voice: 'voice_abc123',
    })
    expect(req.generationConfig.responseFormat?.audio.mimeType).toBe('AUDIO_L16')
    expect(req.generationConfig.responseFormat?.audio.sampleRate).toBe(24000)
    expect(DEFAULT_MODEL).toBe('gemini-3.8-flash-lite-tts')
    expect(TTS_MODELS.map((m) => m.id)).toEqual([
      'gemini-3.8-flash-tts',
      'gemini-3.8-flash-lite-tts',
    ])
  })

  it('omits speech_metadata when style empty', () => {
    const req = buildGenerateContentTtsRequest({ text: 'x', voice: 'Kore' })
    expect(req.contents[0].parts[0].speech_metadata).toBeUndefined()
  })
})

describe('decodeAudioToInt16', () => {
  it('decodes base64 raw PCM', () => {
    const pcm = new Int16Array([100, -200, 300])
    const rawB64 = btoa(String.fromCharCode(...int16ToBytes(pcm)))
    const decoded = decodeAudioToInt16(rawB64)
    expect(Array.from(decoded)).toEqual([100, -200, 300])
  })
})

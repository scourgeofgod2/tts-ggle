import { API_BASE, DEFAULT_MODEL, MAX_RETRIES, type TtsModelId } from '../config/constants'
import { base64ToInt16, bytesToInt16, stripWavHeaderIfPresent } from './pcm'
import { withRetry } from './retry'

export class TtsError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'TtsError'
    this.status = status
  }
}

export interface SpeechMetadata {
  style?: string
  speaker?: string
}

export interface TtsPart {
  text: string
  speech_metadata?: SpeechMetadata
}

export interface GenerateContentTtsRequest {
  contents: Array<{
    role: 'user'
    parts: TtsPart[]
  }>
  generationConfig: {
    responseModalities: Array<'AUDIO'>
    responseFormat?: {
      audio: {
        mimeType: 'AUDIO_L16' | 'AUDIO_WAV'
        sampleRate?: number
      }
    }
    speechConfig: {
      voiceConfig?: { voice: string }
      multiSpeakerVoiceConfig?: {
        speakerVoiceConfigs: Array<{
          speaker: string
          voiceConfig: { prebuiltVoiceConfig?: { voiceName: string }; voice?: string }
        }>
      }
    }
  }
}

export interface SynthesizeOptions {
  text: string
  voice: string
  style?: string
  apiKey: string
  model?: TtsModelId
  signal?: AbortSignal
  maxRetries?: number
  onRetry?: (attempt: number, error: unknown) => void
}

export function buildGenerateContentTtsRequest(opts: {
  text: string
  voice: string
  style?: string
}): GenerateContentTtsRequest {
  const speech_metadata: SpeechMetadata = opts.style ? { style: opts.style } : {}

  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: opts.text,
            ...(Object.keys(speech_metadata).length > 0 ? { speech_metadata } : {}),
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      // Headerless PCM so multi-chunk concat works cleanly
      responseFormat: {
        audio: {
          mimeType: 'AUDIO_L16',
          sampleRate: 24000,
        },
      },
      speechConfig: {
        voiceConfig: { voice: opts.voice },
      },
    },
  }
}

function extractAudioBase64(json: unknown): string {
  const root = json as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string }
          inline_data?: { data?: string; mime_type?: string }
        }>
      }
    }>
    // legacy / convenience shapes
    output_audio?: { data?: string }
    interaction?: {
      output_audio?: { data?: string }
      steps?: Array<{ content?: Array<{ type?: string; data?: string }> }>
    }
    steps?: Array<{ content?: Array<{ type?: string; data?: string }> }>
  }

  // generateContent shape
  for (const cand of root.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      const data = part.inlineData?.data ?? part.inline_data?.data
      if (data) return data
    }
  }

  // interactions leftovers
  const stepBuckets = [root.steps, root.interaction?.steps].filter(Boolean) as NonNullable<
    typeof root.steps
  >[]
  for (const steps of stepBuckets) {
    const audioParts: string[] = []
    for (const step of steps) {
      for (const item of step.content ?? []) {
        if (item.type === 'audio' && item.data) audioParts.push(item.data)
        else if (item.data && item.type === undefined) audioParts.push(item.data)
      }
    }
    if (audioParts.length > 0) return audioParts.join('')
  }

  const convenience = root.output_audio?.data ?? root.interaction?.output_audio?.data
  if (convenience) return convenience

  throw new TtsError('Response contained no audio data')
}

/** Decode base64 audio payload to Int16 PCM (handles WAV wrapper). */
export function decodeAudioToInt16(b64: string): Int16Array {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return bytesToInt16(stripWavHeaderIfPresent(raw))
}

export async function synthesizeTurn(opts: SynthesizeOptions): Promise<Int16Array> {
  const body = buildGenerateContentTtsRequest(opts)
  const url = `${API_BASE}/models/${opts.model ?? DEFAULT_MODEL}:generateContent`

  return withRetry(
    async (signal) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': opts.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: signal ?? opts.signal,
      })

      if (!res.ok) {
        let message = `TTS request failed (${res.status})`
        try {
          const errBody = await res.json()
          const apiMsg =
            errBody?.error?.message ??
            errBody?.message ??
            (typeof errBody === 'string' ? errBody : undefined)
          if (apiMsg) message = apiMsg
        } catch {
          // keep default message
        }
        throw new TtsError(message, res.status)
      }

      const json = await res.json()
      return decodeAudioToInt16(extractAudioBase64(json))
    },
    {
      retries: opts.maxRetries ?? MAX_RETRIES,
      signal: opts.signal,
      onRetry: opts.onRetry,
    }
  )
}

export async function previewVoice(opts: {
  voice: string
  style?: string
  text: string
  apiKey: string
  model?: TtsModelId
  signal?: AbortSignal
}): Promise<Int16Array> {
  return synthesizeTurn({
    text: opts.text,
    voice: opts.voice,
    style: opts.style,
    apiKey: opts.apiKey,
    model: opts.model,
    signal: opts.signal,
    maxRetries: 1,
  })
}

export { base64ToInt16 }

export const TTS_MODELS = [
  { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS' },
  { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS' },
] as const

export type TtsModelId = (typeof TTS_MODELS)[number]['id']

export const DEFAULT_MODEL: TtsModelId = 'gemini-3.8-flash-lite-tts'

export function isTtsModelId(value: string | null | undefined): value is TtsModelId {
  return TTS_MODELS.some((m) => m.id === value)
}

export const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta'

export const INTERACTIONS_URL = `${API_BASE}/interactions`
export const VOICES_URL = `${API_BASE}/voices`

export const SAMPLE_RATE = 24000
export const RESPONSE_MIME = 'audio/l16'
export const MAX_SEGMENT_CHARS = 1500
export const DEFAULT_TURN_DELAY_MS = 250
export const MAX_RETRIES = 3

/** Inline vocal bursts & non-speech sounds (Gemini TTS tags). */
export const INLINE_TAGS = [
  'argh',
  'breath',
  'heavy breath',
  'exhales',
  'cackle',
  'cheer',
  'chuckle',
  'chuckles',
  'cough',
  'cry',
  'gasp',
  'giggle',
  'groan',
  'growl',
  'grunt',
  'grr',
  'hiss',
  'laugh',
  'laughter',
  'moan',
  'pant',
  'pff',
  'phew',
  'scream',
  'shout',
  'shriek',
  'sigh',
  'sighs',
  'sneeze',
  'snicker',
  'snort',
  'sob',
  'throat-clearing',
  'tsk',
  'whimper',
  'whispers',
  'whispering',
  'yawn',
  'short pause',
  'long pause',
] as const

export const STYLE_PRESETS = [
  'warm and conversational',
  'excited and energetic',
  'calm and soothing',
  'sad and reflective',
  'dramatic and intense',
  'whispered and intimate',
  'cheerful and bright',
  'serious and formal',
  'playful and teasing',
  'mysterious and soft',
] as const

export const PREVIEW_TEXT = 'Merhaba, bu bir ses testidir. Nasılsınız?'

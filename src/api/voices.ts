export interface VoiceInfo {
  id: string
  displayName: string
  description: string
  type: 'prebuilt' | 'replicated' | 'prompted'
  accent?: string
  gender?: string
  pitch?: string
  languageCode?: string
}

export const PREBUILT_VOICES: VoiceInfo[] = [
  { id: 'Zephyr', displayName: 'Zephyr', description: 'Bright', type: 'prebuilt', gender: 'female' },
  { id: 'Puck', displayName: 'Puck', description: 'Upbeat', type: 'prebuilt', gender: 'male' },
  { id: 'Charon', displayName: 'Charon', description: 'Informative', type: 'prebuilt', gender: 'male' },
  { id: 'Kore', displayName: 'Kore', description: 'Firm', type: 'prebuilt', gender: 'female' },
  { id: 'Fenrir', displayName: 'Fenrir', description: 'Excitable', type: 'prebuilt', gender: 'male' },
  { id: 'Leda', displayName: 'Leda', description: 'Youthful', type: 'prebuilt', gender: 'female' },
  { id: 'Orus', displayName: 'Orus', description: 'Firm', type: 'prebuilt', gender: 'male' },
  { id: 'Aoede', displayName: 'Aoede', description: 'Breezy', type: 'prebuilt', gender: 'female' },
  { id: 'Callirrhoe', displayName: 'Callirrhoe', description: 'Easy-going', type: 'prebuilt', gender: 'female' },
  { id: 'Autonoe', displayName: 'Autonoe', description: 'Bright', type: 'prebuilt', gender: 'female' },
  { id: 'Enceladus', displayName: 'Enceladus', description: 'Breathy', type: 'prebuilt', gender: 'male' },
  { id: 'Iapetus', displayName: 'Iapetus', description: 'Clear', type: 'prebuilt', gender: 'male' },
  { id: 'Umbriel', displayName: 'Umbriel', description: 'Easy-going', type: 'prebuilt', gender: 'neutral' },
  { id: 'Algieba', displayName: 'Algieba', description: 'Smooth', type: 'prebuilt', gender: 'female' },
  { id: 'Despina', displayName: 'Despina', description: 'Smooth', type: 'prebuilt', gender: 'female' },
  { id: 'Erinome', displayName: 'Erinome', description: 'Clear', type: 'prebuilt', gender: 'female' },
  { id: 'Algenib', displayName: 'Algenib', description: 'Gravelly', type: 'prebuilt', gender: 'male' },
  { id: 'Rasalgethi', displayName: 'Rasalgethi', description: 'Informative', type: 'prebuilt', gender: 'male' },
  { id: 'Laomedeia', displayName: 'Laomedeia', description: 'Upbeat', type: 'prebuilt', gender: 'female' },
  { id: 'Achernar', displayName: 'Achernar', description: 'Soft', type: 'prebuilt', gender: 'male' },
  { id: 'Alnilam', displayName: 'Alnilam', description: 'Firm', type: 'prebuilt', gender: 'male' },
  { id: 'Schedar', displayName: 'Schedar', description: 'Even', type: 'prebuilt', gender: 'neutral' },
  { id: 'Gacrux', displayName: 'Gacrux', description: 'Mature', type: 'prebuilt', gender: 'female' },
  { id: 'Pulcherrima', displayName: 'Pulcherrima', description: 'Forward', type: 'prebuilt', gender: 'female' },
  { id: 'Achird', displayName: 'Achird', description: 'Friendly', type: 'prebuilt', gender: 'male' },
  { id: 'Zubenelgenubi', displayName: 'Zubenelgenubi', description: 'Casual', type: 'prebuilt', gender: 'neutral' },
  { id: 'Vindemiatrix', displayName: 'Vindemiatrix', description: 'Gentle', type: 'prebuilt', gender: 'female' },
  { id: 'Sadachbia', displayName: 'Sadachbia', description: 'Lively', type: 'prebuilt', gender: 'female' },
  { id: 'Sadaltager', displayName: 'Sadaltager', description: 'Knowledgeable', type: 'prebuilt', gender: 'male' },
  { id: 'Sulafat', displayName: 'Sulafat', description: 'Warm', type: 'prebuilt', gender: 'female' },
]

export type CustomVoiceType = 'replicated' | 'prompted'

interface ApiVoice {
  id?: string
  display_name?: string
  type?: string
  description?: string
  language_code?: string
  language_codes?: string[]
  gender?: string
  pitch?: string
  accent?: string
  persona?: string | string[]
  contexts?: string[] | string
}

function mapApiVoice(v: ApiVoice): VoiceInfo | null {
  if (!v.id) return null
  const rawType = (v.type ?? '').toLowerCase()
  const type: VoiceInfo['type'] =
    rawType === 'prompted' ? 'prompted' : rawType === 'prebuilt' ? 'prebuilt' : 'replicated'

  const langs = v.language_codes ?? (v.language_code ? [v.language_code] : [])
  const extra = [v.accent, v.gender, v.pitch].filter(Boolean).join(' · ')

  return {
    id: v.id,
    displayName: v.display_name || v.id,
    description: v.description || extra || langs.join(', '),
    type,
    accent: v.accent,
    gender: v.gender,
    pitch: v.pitch,
    languageCode: langs[0],
  }
}

function voicesBaseUrl(): string {
  return `${import.meta.env.VITE_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta'}/voices`
}

async function fetchVoicesByType(apiKey: string, type: CustomVoiceType): Promise<VoiceInfo[]> {
  const url = new URL(voicesBaseUrl())
  url.searchParams.set('type', type)

  const res = await fetch(url.toString(), {
    headers: { 'x-goog-api-key': apiKey },
  })

  if (!res.ok) {
    let message = `Ses listesi alınamadı (${res.status})`
    try {
      const body = await res.json()
      message = body?.error?.message ?? body?.message ?? message
    } catch {
      // keep default
    }
    throw new Error(message)
  }

  const json = (await res.json()) as { voices?: ApiVoice[] }
  return (json.voices ?? []).map(mapApiVoice).filter((v): v is VoiceInfo => v !== null)
}

/**
 * List stored custom voices (Voice Design `prompted` + Voice Cloning `replicated`).
 * Pass `types` to fetch only one category.
 */
export async function listStoredVoices(
  apiKey: string,
  opts: { types?: CustomVoiceType[] } = {}
): Promise<VoiceInfo[]> {
  const types = opts.types ?? ['replicated', 'prompted']
  const results = await Promise.all(types.map((t) => fetchVoicesByType(apiKey, t)))
  // de-dupe by id (shouldn't collide across types, but be safe)
  const seen = new Set<string>()
  const out: VoiceInfo[] = []
  for (const v of results.flat()) {
    if (seen.has(v.id)) continue
    seen.add(v.id)
    out.push(v)
  }
  return out
}

/** Fetch a single voice with `sample_audio` (available on GetVoice for prompted voices). */
export async function getVoice(
  apiKey: string,
  id: string
): Promise<VoiceInfo & { sampleAudio?: { mimeType: string; data: string } }> {
  const res = await fetch(`${voicesBaseUrl()}/${id}`, {
    headers: { 'x-goog-api-key': apiKey },
  })
  if (!res.ok) {
    let message = `Ses detayı alınamadı (${res.status})`
    try {
      const body = await res.json()
      message = body?.error?.message ?? body?.message ?? message
    } catch {
      // keep default
    }
    throw new Error(message)
  }

  const v = (await res.json()) as ApiVoice & {
    sample_audio?: { mime_type?: string; mimeType?: string; data?: string }
  }
  const mapped = mapApiVoice(v)
  if (!mapped) throw new Error('Geçersiz ses kaydı')
  return {
    ...mapped,
    sampleAudio: v.sample_audio?.data
      ? {
          mimeType: v.sample_audio.mime_type ?? v.sample_audio.mimeType ?? 'audio/wav',
          data: v.sample_audio.data,
        }
      : undefined,
  }
}

export function voiceTypeLabel(type: VoiceInfo['type']): string {
  if (type === 'prompted') return 'tasarım'
  if (type === 'replicated') return 'klon'
  return 'hazır'
}

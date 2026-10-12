import { API_BASE, DEFAULT_MODEL, type TtsModelId } from '../config/constants'
import {
  buildGenerateContentTtsRequest,
  decodeAudioToInt16,
  TtsError,
  type GenerateContentTtsRequest,
} from '../lib/geminiTts'

export type BatchJobState =
  | 'JOB_STATE_PENDING'
  | 'JOB_STATE_RUNNING'
  | 'JOB_STATE_SUCCEEDED'
  | 'JOB_STATE_FAILED'
  | 'JOB_STATE_CANCELLED'
  | 'JOB_STATE_EXPIRED'

export interface BatchJob {
  name: string
  displayName?: string
  state: BatchJobState
  error?: string
  /** Inline results when created with inline requests */
  inlinedResponses?: Array<{
    key?: string
    ok: boolean
    audioB64?: string
    error?: string
  }>
  /** File name when results are in a file */
  resultFileName?: string
  failedRequestCount?: number
  requestCount?: number
}

export interface BatchChunk {
  key: string
  text: string
  style?: string
}

function headers(apiKey: string) {
  return {
    'x-goog-api-key': apiKey,
    'Content-Type': 'application/json',
  }
}

function mapState(raw: unknown): BatchJobState {
  const s = typeof raw === 'string' ? raw : (raw as { name?: string })?.name
  switch (s) {
    case 'JOB_STATE_PENDING':
    case 'JOB_STATE_RUNNING':
    case 'JOB_STATE_SUCCEEDED':
    case 'JOB_STATE_FAILED':
    case 'JOB_STATE_CANCELLED':
    case 'JOB_STATE_EXPIRED':
      return s
    default:
      return 'JOB_STATE_RUNNING'
  }
}

function buildBatchRequest(chunk: BatchChunk, voice: string): GenerateContentTtsRequest {
  return buildGenerateContentTtsRequest({
    text: chunk.text,
    voice,
    style: chunk.style,
  })
}

/**
 * Submit an inline batch TTS job via generateContent Batch API.
 * 50% of standard cost, ~24h turnaround (often faster).
 */
export async function createTtsBatchJob(opts: {
  apiKey: string
  voice: string
  chunks: BatchChunk[]
  displayName?: string
  model?: TtsModelId
}): Promise<BatchJob> {
  const url = `${API_BASE}/models/${opts.model ?? DEFAULT_MODEL}:batchGenerateContent`

  const body = {
    batch: {
      display_name: opts.displayName ?? `tts-batch-${Date.now()}`,
      input_config: {
        requests: {
          requests: opts.chunks.map((c) => ({
            request: buildBatchRequest(c, opts.voice),
            metadata: { key: c.key },
          })),
        },
      },
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let message = `Batch job oluşturulamadı (${res.status})`
    try {
      const err = await res.json()
      message = err?.error?.message ?? err?.message ?? message
    } catch {
      // keep default
    }
    throw new TtsError(message, res.status)
  }

  const json = await res.json()
  const name: string = json.name ?? json.batch?.name ?? ''
  if (!name) throw new TtsError('Batch job name alınamadı')

  return {
    name,
    displayName: json.metadata?.displayName ?? opts.displayName,
    state: mapState(json.metadata?.state ?? json.state ?? 'JOB_STATE_PENDING'),
    requestCount: opts.chunks.length,
  }
}

export async function getTtsBatchJob(apiKey: string, name: string): Promise<BatchJob> {
  const res = await fetch(`${API_BASE}/${name}`, {
    headers: headers(apiKey),
  })

  if (!res.ok) {
    let message = `Batch durumu alınamadı (${res.status})`
    try {
      const err = await res.json()
      message = err?.error?.message ?? err?.message ?? message
    } catch {
      // keep default
    }
    throw new TtsError(message, res.status)
  }

  const json = await res.json()
  const state = mapState(json.metadata?.state ?? json.state)
  const dest = json.response ?? json.dest ?? {}
  const job: BatchJob = {
    name: json.name ?? name,
    displayName: json.metadata?.displayName ?? json.displayName,
    state,
    error:
      typeof json.error === 'string'
        ? json.error
        : json.error?.message ?? json.metadata?.error?.message,
    resultFileName: dest.file_name ?? dest.fileName ?? dest.responsesFile,
    failedRequestCount:
      json.metadata?.batchStats?.failedRequestCount ?? dest.failedRequestCount,
    requestCount: json.metadata?.batchStats?.requestCount ?? dest.requestCount,
    inlinedResponses: [],
  }

  const inline = dest.inlinedResponses ?? dest.inlined_responses
  if (Array.isArray(inline)) {
    job.inlinedResponses = inline.map((item: Record<string, unknown>, i: number) => {
      const key = (item?.metadata as { key?: string })?.key ?? `request-${i + 1}`
      const response = item?.response as
        | {
            candidates?: Array<{
              content?: {
                parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }>
              }
            }>
          }
        | undefined
      const error = item?.error as { message?: string } | undefined

      let audioB64: string | undefined
      for (const part of response?.candidates?.[0]?.content?.parts ?? []) {
        const d = part.inlineData?.data ?? part.inline_data?.data
        if (d) {
          audioB64 = d
          break
        }
      }

      return {
        key,
        ok: !!audioB64 && !error,
        audioB64,
        error: error?.message ?? (audioB64 ? undefined : 'Ses verisi yok'),
      }
    })
  }

  return job
}

/** Download a batch result JSONL file and parse per-request audio. */
export async function downloadTtsBatchResults(
  apiKey: string,
  fileName: string
): Promise<BatchJob['inlinedResponses']> {
  // Try download endpoint first, fall back to get media
  const urls = [
    `${API_BASE}/download/${fileName}:download?alt=media`,
    `${API_BASE}/${fileName}:download?alt=media`,
    `${API_BASE}/${fileName}`,
  ]

  let text = ''
  let lastErr: Error | null = null

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: headers(apiKey) })
      if (!res.ok) continue
      text = await res.text()
      if (text.trim()) break
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (!text.trim()) {
    throw new TtsError(
      lastErr?.message ?? `Sonuç dosyası indirilemedi: ${fileName}`
    )
  }

  const results: NonNullable<BatchJob['inlinedResponses']> = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>
      const key = (row?.metadata as { key?: string })?.key ?? `request-${results.length + 1}`
      const response = row.response as
        | {
            candidates?: Array<{
              content?: {
                parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }>
              }
            }>
          }
        | undefined
      const error = row.error as { message?: string } | undefined

      let audioB64: string | undefined
      for (const part of response?.candidates?.[0]?.content?.parts ?? []) {
        const d = part.inlineData?.data ?? part.inline_data?.data
        if (d) {
          audioB64 = d
          break
        }
      }

      results.push({
        key,
        ok: !!audioB64 && !error,
        audioB64,
        error: error?.message ?? (audioB64 ? undefined : 'Ses verisi yok'),
      })
    } catch {
      // skip malformed lines
    }
  }

  return results
}

export async function cancelTtsBatchJob(apiKey: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${name}:cancel`, {
    method: 'POST',
    headers: headers(apiKey),
  })
  if (!res.ok) {
    let message = `Batch iptal edilemedi (${res.status})`
    try {
      const err = await res.json()
      message = err?.error?.message ?? err?.message ?? message
    } catch {
      // keep default
    }
    throw new TtsError(message, res.status)
  }
}

export async function listTtsBatchJobs(apiKey: string): Promise<BatchJob[]> {
  const res = await fetch(`${API_BASE}/batches`, {
    headers: headers(apiKey),
  })
  if (!res.ok) {
    let message = `Batch listesi alınamadı (${res.status})`
    try {
      const err = await res.json()
      message = err?.error?.message ?? err?.message ?? message
    } catch {
      // keep default
    }
    throw new TtsError(message, res.status)
  }

  const json = await res.json()
  const list = (json.batches ?? json.jobs ?? []) as Array<Record<string, unknown>>
  return list.map((j) => ({
    name: (j.name as string) ?? '',
    displayName: (j.metadata as { displayName?: string })?.displayName ?? (j.displayName as string),
    state: mapState((j.metadata as { state?: string })?.state ?? j.state),
    requestCount: (j.metadata as { batchStats?: { requestCount?: number } })?.batchStats
      ?.requestCount,
    failedRequestCount: (j.metadata as { batchStats?: { failedRequestCount?: number } })
      ?.batchStats?.failedRequestCount,
  }))
}

export { decodeAudioToInt16 }

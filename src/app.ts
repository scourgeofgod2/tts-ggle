import Alpine from 'alpinejs'
import './styles.css'
import {
  listStoredVoices,
  PREBUILT_VOICES,
  voiceTypeLabel,
  type VoiceInfo,
} from './api/voices'
import {
  cancelTtsBatchJob,
  createTtsBatchJob,
  decodeAudioToInt16,
  downloadTtsBatchResults,
  getTtsBatchJob,
  listTtsBatchJobs,
  type BatchJob,
  type BatchChunk,
} from './api/batch'
import {
  INLINE_TAGS,
  PREVIEW_TEXT,
  MAX_SEGMENT_CHARS,
  DEFAULT_TURN_DELAY_MS,
  DEFAULT_MODEL,
  TTS_MODELS,
  isTtsModelId,
  type TtsModelId,
} from './config/constants'
import { previewVoice, synthesizeTurn } from './lib/geminiTts'
import {
  costFromDuration,
  estimateCostFromText,
  formatTime,
  formatTry,
  sumCosts,
  type CostBreakdown,
} from './lib/cost'
import { concatInt16 } from './lib/pcm'
import { sleep } from './lib/retry'
import { chunkText, validateTags } from './lib/text'
import { encodeWav } from './lib/wav'

const DEFAULT_DISCLAIMER = `ÖNEMLİ UYARI
Bu video NİSAN KUMRU tarafından Youtube'da ÇANTADA KİTAP kanalı için seslendirilmiştir. Başka bir kanalda video olarak veya ses olarak yayımlanamaz. Buradaki seslendirme, üzerine klonlanmış bir ses giydirerek (yapay zekâ ile yeniden üretilerek) başka bir kanalda yayımlanamaz. Tespiti halinde ihlal bildirim gönderilir.`

interface StudioState {
  apiKey: string
  title: string
  text: string
  style: string
  model: TtsModelId
  models: typeof TTS_MODELS
  voiceId: string
  disclaimer: string
  /** Voice Design (prompted) + Voice Cloning (replicated) from Voices API */
  customVoices: VoiceInfo[]
  showCloned: boolean
  showDesigned: boolean
  showPrebuilt: boolean
  voicesLoading: boolean
  voicesError: string

  generating: boolean
  progress: number
  progressLabel: string
  error: string
  audioUrl: string
  durationSec: number

  tagSearch: string
  lastFocusStart: number
  lastFocusEnd: number

  // batch
  batchMode: boolean
  batchSeparator: string
  batchConcurrency: number
  batchRunning: boolean
  batchJobs: BatchChunk[]
  batchResults: Array<{ key: string; label: string; audioUrl: string; durationSec: number; error?: string }>
  batchProgress: number
  batchLabel: string
  batchJobName: string
  batchPolling: boolean
  batchState: string
  remoteBatches: BatchJob[]
  lastFocusBatch: number
  /** Persisted job metadata so results survive browser/PC restart */
  savedJobs: SavedBatchJob[]
  batchListLoading: boolean

  init(): void
  persist(): void
  get knownTags(): string[]
  get tagWarnings(): string[]
  get filteredTags(): string[]
  get selectedVoice(): VoiceInfo | undefined
  get allVoices(): VoiceInfo[]
  get clonedVoices(): VoiceInfo[]
  get designedVoices(): VoiceInfo[]
  get canGenerate(): boolean
  voiceBadge(type: VoiceInfo['type']): string
  get batchItems(): Array<{ key: string; label: string; text: string }>
  get fileBase(): string
  get textCost(): CostBreakdown
  get textActualCost(): CostBreakdown | null
  get batchEstCost(): CostBreakdown
  get batchActualCost(): CostBreakdown | null
  fmtTry(n: number): string
  fmtTime(sec: number): string

  loadVoices(): Promise<void>
  insertTag(tag: string): void
  insertStyle(style: string): void
  onTextFocus(e: FocusEvent): void
  generate(): Promise<void>
  preview(): Promise<void>
  cancel(): void
  clearAudio(): void
  clearBatchResults(): void
  downloadDisclaimer(): void
  reset(): void

  runBatchLocal(): Promise<void>
  submitBatchApi(): Promise<void>
  checkBatchOnce(name?: string): Promise<void>
  watchBatch(): Promise<void>
  stopWatchBatch(): void
  cancelBatchApi(): Promise<void>
  refreshBatches(): Promise<void>
  downloadBatchJob(name: string): Promise<void>
  forgetSavedJob(name: string): void
  formatJobTime(ts: number): string
}

interface SavedBatchJob {
  name: string
  displayName: string
  title: string
  chunkCount: number
  voiceId: string
  submittedAt: number
}

let abortController: AbortController | null = null

function splitBatchItems(text: string, sep: string): Array<{ key: string; label: string; text: string }> {
  const parts = sep.trim()
    ? text.split(new RegExp(`\\s*${escapeRe(sep.trim())}\\s*`))
    : text.split(/\n{2,}/)

  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p, i) => {
      const firstLine = p.split('\n')[0].trim()
      const label = firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine
      return {
        key: `item-${String(i + 1).padStart(3, '0')}`,
        label: label || `Parça ${i + 1}`,
        text: p,
      }
    })
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function loadSavedJobs(): SavedBatchJob[] {
  try {
    const raw = localStorage.getItem('tts:savedJobs')
    if (!raw) return []
    const list = JSON.parse(raw) as SavedBatchJob[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function saveSavedJobs(list: SavedBatchJob[]) {
  // Keep last 30
  localStorage.setItem('tts:savedJobs', JSON.stringify(list.slice(0, 30)))
}

function mapBatchItemsToResults(
  items: NonNullable<BatchJob['inlinedResponses']>
): StudioState['batchResults'] {
  return items.map((r) => {
    if (r.ok && r.audioB64) {
      const pcm = decodeAudioToInt16(r.audioB64)
      const blob = encodeWav(pcm)
      return {
        key: r.key ?? `request-${Math.random()}`,
        label: r.key ?? '',
        audioUrl: URL.createObjectURL(blob),
        durationSec: pcm.length / 24000,
      }
    }
    return {
      key: r.key ?? `request-${Math.random()}`,
      label: r.key ?? '',
      audioUrl: '',
      durationSec: 0,
      error: r.error ?? 'Hata',
    }
  })
}

/** Minimal custom audio player — one instance per audio source. */
function audioPlayer() {
  return {
    src: '',
    fileName: 'ses.wav',
    playing: false,
    current: 0,
    duration: 0,
    seeking: false,
    seekValue: 0,

    audioEl(): HTMLAudioElement | null {
      const root = (this as unknown as { $el?: HTMLElement }).$el
      return root?.querySelector('audio') ?? null
    },

    setSrc(url: string) {
      if (url === this.src) return
      this.src = url
      this.playing = false
      this.current = 0
      this.duration = 0
      this.seekValue = 0
      this.seeking = false
      queueMicrotask(() => this.audioEl()?.load())
    },

    setFileName(name: string) {
      this.fileName = name || 'ses.wav'
    },

    toggle() {
      const a = this.audioEl()
      if (!a || !this.src) return
      if (a.paused) void a.play()
      else a.pause()
    },

    onPlay() {
      this.playing = true
      const a = this.audioEl()
      document.querySelectorAll<HTMLAudioElement>('.ap-audio').forEach((other) => {
        if (other !== a) other.pause()
      })
    },

    onPause() {
      this.playing = false
    },

    onEnded() {
      this.playing = false
      this.current = 0
      this.seekValue = 0
    },

    onTimeUpdate() {
      if (this.seeking) return
      const a = this.audioEl()
      if (!a) return
      this.current = a.currentTime
      if (this.duration > 0) this.seekValue = (this.current / this.duration) * 1000
    },

    onLoaded() {
      const a = this.audioEl()
      this.duration = a && Number.isFinite(a.duration) ? a.duration : 0
    },

    seekFromInput(e: Event) {
      const input = e.target as HTMLInputElement
      this.seeking = true
      this.seekValue = Number(input.value)
      const a = this.audioEl()
      if (a && this.duration > 0) {
        a.currentTime = (this.seekValue / 1000) * this.duration
        this.current = a.currentTime
      }
    },

    onSeekEnd() {
      this.seeking = false
      const a = this.audioEl()
      if (a) {
        this.current = a.currentTime
        if (this.duration > 0) this.seekValue = (this.current / this.duration) * 1000
      }
    },

    fmt(sec: number) {
      return formatTime(sec)
    },

    download() {
      if (!this.src) return
      const a = document.createElement('a')
      a.href = this.src
      a.download = this.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
    },
  }
}

function studio(): StudioState {
  return {
    apiKey: localStorage.getItem('tts:apiKey') ?? '',
    title: localStorage.getItem('tts:title') ?? 'Yeni Seslendirme',
    text: localStorage.getItem('tts:text') ?? '',
    style: localStorage.getItem('tts:style') ?? '',
    model: isTtsModelId(localStorage.getItem('tts:model'))
      ? (localStorage.getItem('tts:model') as TtsModelId)
      : DEFAULT_MODEL,
    voiceId: localStorage.getItem('tts:voiceId') ?? '',
    disclaimer: localStorage.getItem('tts:disclaimer') ?? DEFAULT_DISCLAIMER,
    customVoices: [],
    showCloned: localStorage.getItem('tts:showCloned') !== '0',
    showDesigned: localStorage.getItem('tts:showDesigned') !== '0',
    showPrebuilt: localStorage.getItem('tts:showPrebuilt') === '1',
    voicesLoading: false,
    voicesError: '',

    generating: false,
    progress: 0,
    progressLabel: '',
    error: '',
    audioUrl: '',
    durationSec: 0,

    tagSearch: '',
    lastFocusStart: 0,
    lastFocusEnd: 0,

    batchMode: false,
    batchSeparator: localStorage.getItem('tts:batchSep') ?? '---',
    batchConcurrency: 2,
    batchRunning: false,
    batchJobs: [],
    batchResults: [],
    batchProgress: 0,
    batchLabel: '',
    batchJobName: '',
    batchPolling: false,
    batchState: '',
    remoteBatches: [],
    lastFocusBatch: 0,
    savedJobs: loadSavedJobs(),
    batchListLoading: false,

    models: TTS_MODELS,

    init() {
      if (!this.voiceId) this.voiceId = 'Kore'
      if (this.apiKey) {
        void this.loadVoices()
        void this.refreshBatches()
      }
    },

    persist() {
      localStorage.setItem('tts:apiKey', this.apiKey)
      localStorage.setItem('tts:title', this.title)
      localStorage.setItem('tts:text', this.text)
      localStorage.setItem('tts:style', this.style)
      localStorage.setItem('tts:model', this.model)
      localStorage.setItem('tts:voiceId', this.voiceId)
      localStorage.setItem('tts:disclaimer', this.disclaimer)
      localStorage.setItem('tts:batchSep', this.batchSeparator)
      localStorage.setItem('tts:showCloned', this.showCloned ? '1' : '0')
      localStorage.setItem('tts:showDesigned', this.showDesigned ? '1' : '0')
      localStorage.setItem('tts:showPrebuilt', this.showPrebuilt ? '1' : '0')
    },

    get knownTags() {
      return INLINE_TAGS as unknown as string[]
    },

    get tagWarnings() {
      return validateTags(this.text, INLINE_TAGS as unknown as string[])
    },

    get filteredTags() {
      const q = this.tagSearch.trim().toLowerCase()
      const all = this.knownTags
      return q ? all.filter((t) => t.includes(q)) : all
    },

    get selectedVoice() {
      return this.allVoices.find((v) => v.id === this.voiceId)
    },

    get clonedVoices() {
      return this.customVoices.filter((v) => v.type === 'replicated')
    },

    get designedVoices() {
      return this.customVoices.filter((v) => v.type === 'prompted')
    },

    get allVoices() {
      const out: VoiceInfo[] = []
      if (this.showCloned) out.push(...this.clonedVoices)
      if (this.showDesigned) out.push(...this.designedVoices)
      if (this.showPrebuilt) out.push(...PREBUILT_VOICES)
      // If every filter is off or nothing custom loaded yet, fall back so the list isn't empty
      if (out.length === 0 && this.customVoices.length === 0 && !this.showPrebuilt) {
        return PREBUILT_VOICES
      }
      return out
    },

    get canGenerate() {
      return (
        !this.generating &&
        !this.batchRunning &&
        this.text.trim().length > 0 &&
        !!this.voiceId &&
        !!this.apiKey.trim()
      )
    },

    voiceBadge(type: VoiceInfo['type']) {
      return voiceTypeLabel(type)
    },

    get batchItems() {
      return splitBatchItems(this.text, this.batchSeparator)
    },

    get fileBase() {
      return sanitize(this.title) || 'seslendirme'
    },

    get textCost() {
      return estimateCostFromText(this.text, this.model)
    },

    get textActualCost() {
      return this.durationSec > 0
        ? costFromDuration(this.durationSec, this.text, this.model)
        : null
    },

    get batchEstCost() {
      return sumCosts(this.batchItems.map((i) => estimateCostFromText(i.text, this.model)))
    },

    get batchActualCost() {
      const ok = this.batchResults.filter((r) => !r.error && r.durationSec > 0)
      if (ok.length === 0) return null
      const textByKey = new Map(this.batchItems.map((i) => [i.key, i.text]))
      return sumCosts(
        ok.map((r) => costFromDuration(r.durationSec, textByKey.get(r.key) ?? '', this.model)),
      )
    },

    fmtTry(n: number) {
      return formatTry(n)
    },

    fmtTime(sec: number) {
      return formatTime(sec)
    },

    async loadVoices() {
      if (!this.apiKey.trim()) {
        this.voicesError = 'Önce API key girin.'
        return
      }
      this.voicesLoading = true
      this.voicesError = ''
      try {
        // Fetch Voice Design (prompted) + Voice Cloning (replicated) together
        const voices = await listStoredVoices(this.apiKey.trim(), {
          types: ['replicated', 'prompted'],
        })
        this.customVoices = voices

        const nClone = voices.filter((v) => v.type === 'replicated').length
        const nDesign = voices.filter((v) => v.type === 'prompted').length

        if (voices.length === 0) {
          this.voicesError =
            'Klonlanmış veya tasarlanmış ses bulunamadı. Hazır sesleri gösterebilirsiniz.'
          this.showPrebuilt = true
        } else {
          this.voicesError = ''
          // Prefer keeping current selection if still available
          const visible = this.allVoices
          if (!visible.some((v) => v.id === this.voiceId) && visible[0]) {
            this.voiceId = visible[0].id
          }
          this.persist()
          // Surface counts as soft status (not error)
          if (nClone === 0 && nDesign > 0 && !this.showDesigned) this.showDesigned = true
          if (nDesign === 0 && nClone > 0 && !this.showCloned) this.showCloned = true
        }
      } catch (err) {
        this.voicesError = err instanceof Error ? err.message : 'Sesler yüklenemedi.'
        this.showPrebuilt = true
      } finally {
        this.voicesLoading = false
      }
    },

    insertTag(tag: string) {
      const el = document.getElementById('script-text') as HTMLTextAreaElement | null
      const snippet = `<${tag}>`
      if (!el) {
        this.text += (this.text && !this.text.endsWith(' ') ? ' ' : '') + snippet
        return
      }
      const start = el.selectionStart ?? this.text.length
      const end = el.selectionEnd ?? this.text.length
      const before = this.text.slice(0, start)
      const after = this.text.slice(end)
      const needsSpace = before.length > 0 && !/\s$/.test(before)
      const insert = (needsSpace ? ' ' : '') + snippet
      this.text = before + insert + after
      this.persist()
      requestAnimationFrame(() => {
        const pos = start + insert.length
        el.focus()
        el.setSelectionRange(pos, pos)
      })
    },

    insertStyle(style: string) {
      this.style = style
      this.persist()
    },

    onTextFocus(e: FocusEvent) {
      const el = e.target as HTMLTextAreaElement
      this.lastFocusStart = el.selectionStart ?? 0
      this.lastFocusEnd = el.selectionEnd ?? 0
    },

    async generate() {
      if (!this.canGenerate) return
      this.error = ''
      this.clearAudio()
      this.generating = true
      this.progress = 0
      this.progressLabel = 'Hazırlanıyor…'
      abortController = new AbortController()

      try {
        const chunks = chunkText(this.text, MAX_SEGMENT_CHARS)
        const style = this.style.trim() || undefined
        const parts: Int16Array[] = []

        for (let i = 0; i < chunks.length; i++) {
          if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
          this.progressLabel = `Seslendiriliyor ${i + 1}/${chunks.length}`
          this.progress = Math.round((i / chunks.length) * 100)

          const pcm = await synthesizeTurn({
            text: chunks[i],
            voice: this.voiceId,
            style,
            model: this.model,
            apiKey: this.apiKey.trim(),
            signal: abortController.signal,
          })
          parts.push(pcm)

          if (i < chunks.length - 1) await sleep(DEFAULT_TURN_DELAY_MS, abortController.signal)
        }

        this.progressLabel = 'WAV yazılıyor…'
        const pcmAll = concatInt16(parts)
        if (pcmAll.length === 0) throw new Error('Ses üretilemedi (boş çıktı).')

        const blob = encodeWav(pcmAll)
        this.audioUrl = URL.createObjectURL(blob)
        this.durationSec = pcmAll.length / 24000
        this.progress = 100
        this.progressLabel = 'Tamamlandı'
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          this.progressLabel = 'İptal edildi'
        } else {
          this.error = err instanceof Error ? err.message : 'Üretim başarısız.'
          this.progressLabel = 'Hata'
        }
      } finally {
        this.generating = false
        abortController = null
      }
    },

    /** Local batch: multiple items → concurrent generateContent → per-item WAV. */
    async runBatchLocal() {
      if (!this.apiKey.trim() || !this.voiceId) {
        this.error = 'API key ve ses seçimi gerekli.'
        return
      }
      const items = this.batchItems
      if (items.length === 0) {
        this.error = 'Batch için metin parçası yok.'
        return
      }

      this.error = ''
      this.clearBatchResults()
      this.batchRunning = true
      this.batchProgress = 0
      this.batchLabel = `0 / ${items.length}`
      abortController = new AbortController()

      const style = this.style.trim() || undefined
      const results: StudioState['batchResults'] = []
      let completed = 0
      let next = 0
      const concurrency = Math.max(1, Math.min(4, this.batchConcurrency))

      const worker = async () => {
        while (next < items.length) {
          const idx = next++
          const item = items[idx]
          const signal = abortController?.signal
          if (signal?.aborted) return
          this.batchLabel = `Üretiliyor: ${item.label} (${completed + 1}/${items.length})`
          try {
            // Each item may itself be long → chunk internally
            const chunks = chunkText(item.text, MAX_SEGMENT_CHARS)
            const parts: Int16Array[] = []
            for (const c of chunks) {
              if (signal?.aborted) return
              const pcm = await synthesizeTurn({
                text: c,
                voice: this.voiceId,
                style,
                model: this.model,
                apiKey: this.apiKey.trim(),
                signal,
              })
              parts.push(pcm)
            }
            const pcmAll = concatInt16(parts)
            const blob = encodeWav(pcmAll)
            results.push({
              key: item.key,
              label: item.label,
              audioUrl: URL.createObjectURL(blob),
              durationSec: pcmAll.length / 24000,
            })
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            results.push({
              key: item.key,
              label: item.label,
              audioUrl: '',
              durationSec: 0,
              error: err instanceof Error ? err.message : 'Hata',
            })
          }
          completed++
          this.batchProgress = Math.round((completed / items.length) * 100)
          this.batchLabel = `${completed} / ${items.length}`
        }
      }

      try {
        await Promise.all(Array.from({ length: concurrency }, () => worker()))
        // Keep original order
        const order = new Map(items.map((it, i) => [it.key, i]))
        results.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
        this.batchResults = results
        const ok = results.filter((r) => !r.error).length
        this.batchLabel = `Bitti: ${ok}/${items.length} başarılı`
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'Batch çalıştırma hatası.'
      } finally {
        this.batchRunning = false
        abortController = null
      }
    },

    /**
     * Official Batch API: 50% cost, async ~24h.
     * Job Google tarafında saklanır — bilgisayarını kapatabilirsin.
     * Job adı localStorage'a yazılır, sonradan listeden çekebilirsin.
     */
    async submitBatchApi() {
      if (!this.apiKey.trim() || !this.voiceId) {
        this.error = 'API key ve ses seçimi gerekli.'
        return
      }
      const items = this.batchItems
      if (items.length === 0) {
        this.error = 'Batch için metin parçası yok.'
        return
      }

      this.error = ''
      this.batchLabel = 'Batch job gönderiliyor…'
      this.batchState = 'PENDING'

      try {
        const chunks: BatchChunk[] = items.map((it) => ({
          key: it.key,
          text: it.text,
          style: this.style.trim() || undefined,
        }))

        const displayName = `${this.title || 'tts'}-${Date.now()}`
        const job = await createTtsBatchJob({
          apiKey: this.apiKey.trim(),
          voice: this.voiceId,
          chunks,
          displayName,
          model: this.model,
        })

        this.batchJobName = job.name
        this.batchState = job.state
        this.batchLabel = `Gönderildi. Bilgisayarını kapatabilirsin — job sunucuda: ${job.name}`

        // Persist so we can find it after restart
        const saved: SavedBatchJob = {
          name: job.name,
          displayName,
          title: this.title,
          chunkCount: items.length,
          voiceId: this.voiceId,
          submittedAt: Date.now(),
        }
        this.savedJobs = [saved, ...this.savedJobs.filter((s) => s.name !== job.name)]
        saveSavedJobs(this.savedJobs)

        void this.refreshBatches()
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'Batch gönderilemedi.'
        this.batchLabel = 'Hata'
      }
    },

    /** One-shot status check. No need to leave the browser open. */
    async checkBatchOnce(name?: string) {
      const target = name || this.batchJobName
      if (!target || !this.apiKey.trim()) return
      this.batchListLoading = true
      try {
        const job = await getTtsBatchJob(this.apiKey.trim(), target)
        this.batchJobName = target
        this.batchState = job.state
        this.batchLabel = `Durum: ${job.state}`

        if (job.state === 'JOB_STATE_SUCCEEDED') {
          this.batchLabel = 'Sonuçlar indiriliyor…'
          let items = job.inlinedResponses ?? []
          if (items.length === 0 && job.resultFileName) {
            items = (await downloadTtsBatchResults(this.apiKey.trim(), job.resultFileName)) ?? []
          }
          this.batchResults = mapBatchItemsToResults(items)
          this.batchLabel = `Tamamlandı (${this.batchResults.filter((r) => !r.error).length}/${this.batchResults.length})`
        } else if (job.state === 'JOB_STATE_FAILED') {
          this.batchLabel = 'Batch FAILED'
          if (job.error) this.error = job.error
        } else if (job.state === 'JOB_STATE_EXPIRED') {
          this.batchLabel = 'Batch süresi doldu (48s)'
        }

        await this.refreshBatches()
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'Batch sorgulanamadı.'
      } finally {
        this.batchListLoading = false
        this.batchPolling = false
      }
    },

    /** Optional: watch while the tab is open (auto-check every 30s). */
    async watchBatch() {
      if (!this.batchJobName || !this.apiKey.trim()) return
      this.batchPolling = true
      this.batchLabel = 'İzleniyor… (sekmeyi açık tutmana gerek yok)'
      const terminal = new Set([
        'JOB_STATE_SUCCEEDED',
        'JOB_STATE_FAILED',
        'JOB_STATE_CANCELLED',
        'JOB_STATE_EXPIRED',
      ])

      try {
        while (this.batchPolling) {
          const job = await getTtsBatchJob(this.apiKey.trim(), this.batchJobName)
          this.batchState = job.state
          this.batchLabel = `Durum: ${job.state}`

          if (terminal.has(job.state)) {
            await this.checkBatchOnce(this.batchJobName)
            break
          }
          await sleep(30000)
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'İzleme hatası.'
        this.batchPolling = false
      }
    },

    stopWatchBatch() {
      this.batchPolling = false
      this.batchLabel = 'İzleme durdu — istediğinde “Durum” ile bakabilirsin.'
    },

    async cancelBatchApi() {
      this.batchPolling = false
      if (!this.batchJobName || !this.apiKey.trim()) return
      try {
        await cancelTtsBatchJob(this.apiKey.trim(), this.batchJobName)
        this.batchState = 'JOB_STATE_CANCELLED'
        this.batchLabel = 'İptal edildi'
        await this.refreshBatches()
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'İptal edilemedi.'
      }
    },

    /**
     * Merge remote API jobs with locally saved job names.
     * After a PC restart this is how you get your jobs back.
     */
    async refreshBatches() {
      if (!this.apiKey.trim()) return
      this.batchListLoading = true
      try {
        const remote = await listTtsBatchJobs(this.apiKey.trim())
        const byName = new Map(remote.map((j) => [j.name, j]))

        // Ensure locally saved jobs appear even if list endpoint is incomplete
        for (const s of this.savedJobs) {
          if (!byName.has(s.name)) {
            byName.set(s.name, {
              name: s.name,
              displayName: s.displayName,
              state: 'JOB_STATE_PENDING',
              requestCount: s.chunkCount,
            })
          }
        }

        // Sort: newest first (by saved submittedAt when known)
        const savedAt = new Map(this.savedJobs.map((s) => [s.name, s.submittedAt]))
        this.remoteBatches = [...byName.values()].sort(
          (a, b) => (savedAt.get(b.name) ?? 0) - (savedAt.get(a.name) ?? 0)
        )
      } catch (err) {
        // Fall back to saved-only list so UI still works offline-ish
        this.remoteBatches = this.savedJobs.map((s) => ({
          name: s.name,
          displayName: s.displayName,
          state: 'JOB_STATE_PENDING' as const,
          requestCount: s.chunkCount,
        }))
        this.error = err instanceof Error ? err.message : 'Batch listesi alınamadı.'
      } finally {
        this.batchListLoading = false
      }
    },

    async downloadBatchJob(name: string) {
      if (!this.apiKey.trim()) return
      await this.checkBatchOnce(name)
    },

    forgetSavedJob(name: string) {
      this.savedJobs = this.savedJobs.filter((s) => s.name !== name)
      saveSavedJobs(this.savedJobs)
      this.remoteBatches = this.remoteBatches.filter((b) => b.name !== name)
    },

    formatJobTime(ts: number) {
      return new Date(ts).toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    },

    async preview() {
      if (!this.apiKey.trim() || !this.voiceId) {
        this.error = 'API key ve ses seçimi gerekli.'
        return
      }
      this.error = ''
      const style = this.style.trim() || undefined
      try {
        const pcm = await previewVoice({
          voice: this.voiceId,
          style,
          text: PREVIEW_TEXT,
          apiKey: this.apiKey.trim(),
          model: this.model,
        })
        const blob = encodeWav(pcm)
        this.clearAudio()
        this.audioUrl = URL.createObjectURL(blob)
        this.durationSec = pcm.length / 24000
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'Önizleme başarısız.'
      }
    },

    cancel() {
      abortController?.abort()
    },

    clearAudio() {
      if (this.audioUrl) {
        URL.revokeObjectURL(this.audioUrl)
        this.audioUrl = ''
      }
      this.durationSec = 0
    },

    clearBatchResults() {
      for (const r of this.batchResults) {
        if (r.audioUrl) URL.revokeObjectURL(r.audioUrl)
      }
      this.batchResults = []
      this.batchProgress = 0
    },

    downloadDisclaimer() {
      const blob = new Blob([this.disclaimer], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${sanitize(this.title) || 'yasal-uyari'}_yasal-uyari.txt`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },

    reset() {
      if (!confirm('Metin, stil ve ayarlar temizlenecek. Devam?')) return
      this.text = ''
      this.style = ''
      this.error = ''
      this.progress = 0
      this.progressLabel = ''
      this.clearAudio()
      this.clearBatchResults()
      this.persist()
    },
  }
}

function sanitize(s: string): string {
  return s.replace(/[^\w\-çğıöşüÇĞİÖŞÜ ]+/g, '').trim().replace(/\s+/g, '-')
}

Alpine.data('studio', studio)
Alpine.data('audioPlayer', audioPlayer)
;(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine
Alpine.start()

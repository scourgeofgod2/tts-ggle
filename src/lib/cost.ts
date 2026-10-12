/**
 * Gemini 3.8 Flash / Flash-Lite TTS — 2026 cost estimates.
 *
 * spokenChars  = |text without <...> tags and whitespace|
 * est.duration = spokenChars / SPOKEN_CHARS_PER_SECOND
 * inputTokens  = ceil(|raw text| / CHARS_PER_INPUT_TOKEN)
 * audioTokens  = durationSec * 25
 * inputUsd     = inputTokens * $0.50 / 1e6
 * outputUsd    = audioTokens * modelOutputUsd / 1e6
 *   Flash-Lite: $6.00 / 1M ≡ durationSec * $0.00015
 *   Flash:      $9.00 / 1M ≡ durationSec * $0.000225
 * standardUsd  = inputUsd + outputUsd
 * batchUsd     = standardUsd * 0.50   (API Batch / Flex)
 */

import { DEFAULT_MODEL, type TtsModelId } from '../config/constants'

/** 2026 Gemini TTS pricing per model (USD per 1M tokens). */
export const MODEL_PRICING = {
  'gemini-3.8-flash-tts': {
    INPUT_USD_PER_1M_TOKENS: 0.5,
    OUTPUT_USD_PER_1M_TOKENS: 9.0,
  },
  'gemini-3.8-flash-lite-tts': {
    INPUT_USD_PER_1M_TOKENS: 0.5,
    OUTPUT_USD_PER_1M_TOKENS: 6.0,
  },
} as const

/** Shared constants + Flash-Lite rates (default model). */
export const PRICING = {
  INPUT_USD_PER_1M_TOKENS: 0.5,
  OUTPUT_USD_PER_1M_TOKENS: 6.0,
  AUDIO_TOKENS_PER_SECOND: 25,
  BATCH_DISCOUNT: 0.5,
} as const

export function pricingFor(model: TtsModelId = DEFAULT_MODEL) {
  return MODEL_PRICING[model]
}

/** Heuristics — Turkish narration. */
export const CHARS_PER_INPUT_TOKEN = 4
export const SPOKEN_CHARS_PER_SECOND = 14

/** Display rate: 1 USD = 49 TL. */
export const USD_TO_TRY = 49

const TAG_RE = /<[^>]*>/g

export function stripInlineTags(text: string): string {
  return text.replace(TAG_RE, '')
}

export function spokenCharCount(text: string): number {
  return stripInlineTags(text).replace(/\s+/g, '').length
}

export function estimateSpeechSec(text: string): number {
  return spokenCharCount(text) / SPOKEN_CHARS_PER_SECOND
}

export function estimateInputTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_INPUT_TOKEN)
}

export function audioTokensFromSec(sec: number): number {
  return sec * PRICING.AUDIO_TOKENS_PER_SECOND
}

export interface CostBreakdown {
  inputTokens: number
  audioTokens: number
  durationSec: number
  inputUsd: number
  outputUsd: number
  standardUsd: number
  batchUsd: number
}

function build(
  durationSec: number,
  inputTokens: number,
  audioTokens: number,
  inputUsd: number,
  outputUsd: number,
): CostBreakdown {
  const standardUsd = inputUsd + outputUsd
  return {
    inputTokens,
    audioTokens,
    durationSec,
    inputUsd,
    outputUsd,
    standardUsd,
    batchUsd: standardUsd * PRICING.BATCH_DISCOUNT,
  }
}

/** Estimate BEFORE generation from text only. */
export function estimateCostFromText(
  text: string,
  model: TtsModelId = DEFAULT_MODEL,
): CostBreakdown {
  const rates = pricingFor(model)
  const durationSec = estimateSpeechSec(text)
  const inputTokens = estimateInputTokens(text)
  const audioTokens = audioTokensFromSec(durationSec)
  const inputUsd = (inputTokens * rates.INPUT_USD_PER_1M_TOKENS) / 1_000_000
  const outputUsd = (audioTokens * rates.OUTPUT_USD_PER_1M_TOKENS) / 1_000_000
  return build(durationSec, inputTokens, audioTokens, inputUsd, outputUsd)
}

/** Actual AFTER generation from real audio duration (+ optional text for input side). */
export function costFromDuration(
  durationSec: number,
  inputText = '',
  model: TtsModelId = DEFAULT_MODEL,
): CostBreakdown {
  const rates = pricingFor(model)
  const sec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const inputTokens = inputText ? estimateInputTokens(inputText) : 0
  const audioTokens = audioTokensFromSec(sec)
  const inputUsd = (inputTokens * rates.INPUT_USD_PER_1M_TOKENS) / 1_000_000
  const outputUsd = (audioTokens * rates.OUTPUT_USD_PER_1M_TOKENS) / 1_000_000
  return build(sec, inputTokens, audioTokens, inputUsd, outputUsd)
}

export function sumCosts(list: CostBreakdown[]): CostBreakdown {
  const acc = list.reduce(
    (a, c) => ({
      inputTokens: a.inputTokens + c.inputTokens,
      audioTokens: a.audioTokens + c.audioTokens,
      durationSec: a.durationSec + c.durationSec,
      inputUsd: a.inputUsd + c.inputUsd,
      outputUsd: a.outputUsd + c.outputUsd,
    }),
    { inputTokens: 0, audioTokens: 0, durationSec: 0, inputUsd: 0, outputUsd: 0 },
  )
  return build(acc.durationSec, acc.inputTokens, acc.audioTokens, acc.inputUsd, acc.outputUsd)
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  const abs = Math.abs(n)
  if (abs < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

/** Format USD amount as Turkish Lira (1 USD = 49 TL). */
export function formatTry(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return '₺0'
  const tryAmount = usd * USD_TO_TRY
  const digits = Math.abs(tryAmount) < 1 ? 4 : 2
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(tryAmount)
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

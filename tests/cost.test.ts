import { describe, expect, it } from 'vitest'
import {
  audioTokensFromSec,
  costFromDuration,
  estimateCostFromText,
  estimateInputTokens,
  estimateSpeechSec,
  formatTime,
  formatTry,
  formatUsd,
  PRICING,
  spokenCharCount,
  sumCosts,
  USD_TO_TRY,
} from '../src/lib/cost'

describe('spokenCharCount', () => {
  it('strips tags and whitespace', () => {
    expect(spokenCharCount('Merhaba <laugh> dünya')).toBe(12)
  })

  it('returns 0 for empty or tags-only', () => {
    expect(spokenCharCount('')).toBe(0)
    expect(spokenCharCount('   ')).toBe(0)
    expect(spokenCharCount('<laugh><sigh>')).toBe(0)
  })
})

describe('estimateSpeechSec', () => {
  it('uses 14 spoken chars per second', () => {
    const text = 'a'.repeat(2400)
    expect(estimateSpeechSec(text)).toBeCloseTo(2400 / 14, 6)
  })

  it('returns 0 for empty text', () => {
    expect(estimateSpeechSec('')).toBe(0)
  })
})

describe('estimateInputTokens', () => {
  it('ceil(raw length / 4)', () => {
    expect(estimateInputTokens('a'.repeat(3000))).toBe(750)
    expect(estimateInputTokens('a')).toBe(1)
    expect(estimateInputTokens('')).toBe(0)
  })
})

describe('audioTokensFromSec', () => {
  it('25 tokens per second', () => {
    expect(audioTokensFromSec(42.5)).toBe(1062.5)
    expect(audioTokensFromSec(0)).toBe(0)
  })
})

describe('costFromDuration', () => {
  it('computes output-only cost for 42.5s', () => {
    const c = costFromDuration(42.5)
    expect(c.outputUsd).toBeCloseTo(42.5 * 0.00015, 10)
    expect(c.standardUsd).toBeCloseTo(c.outputUsd, 10)
    expect(c.batchUsd).toBeCloseTo(c.standardUsd / 2, 10)
    expect(c.inputTokens).toBe(0)
    expect(c.inputUsd).toBe(0)
  })

  it('includes input side when text given', () => {
    const c = costFromDuration(42.5, 'a'.repeat(3000))
    expect(c.inputTokens).toBe(750)
    expect(c.inputUsd).toBeCloseTo(750 * 0.5 / 1e6, 12)
    expect(c.standardUsd).toBeCloseTo(c.inputUsd + c.outputUsd, 12)
  })

  it('guards non-finite duration', () => {
    expect(costFromDuration(NaN).durationSec).toBe(0)
    expect(costFromDuration(-5).durationSec).toBe(0)
  })
})

describe('estimateCostFromText', () => {
  it('matches worked example (3000 raw / 2400 spoken)', () => {
    const text = 'a'.repeat(2400) + ' '.repeat(600)
    const c = estimateCostFromText(text)
    expect(c.durationSec).toBeCloseTo(2400 / 14, 6)
    expect(c.inputTokens).toBe(750)
    expect(c.inputUsd).toBeCloseTo(0.000375, 10)
    expect(c.outputUsd).toBeCloseTo((2400 / 14) * 0.00015, 10)
    expect(c.standardUsd).toBeCloseTo(0.000375 + (2400 / 14) * 0.00015, 10)
    expect(c.batchUsd).toBeCloseTo(c.standardUsd / 2, 10)
  })

  it('returns zeros for empty text', () => {
    const c = estimateCostFromText('')
    expect(c.durationSec).toBe(0)
    expect(c.standardUsd).toBe(0)
    expect(Number.isFinite(c.standardUsd)).toBe(true)
  })
})

describe('sumCosts', () => {
  it('sums fields consistently', () => {
    const a = costFromDuration(10, 'abcd')
    const b = costFromDuration(20, 'efgh')
    const s = sumCosts([a, b])
    expect(s.durationSec).toBe(30)
    expect(s.inputTokens).toBe(a.inputTokens + b.inputTokens)
    expect(s.standardUsd).toBeCloseTo(a.standardUsd + b.standardUsd, 12)
    expect(s.batchUsd).toBeCloseTo(s.standardUsd / 2, 12)
  })
})

describe('formatUsd', () => {
  it('formats edge cases', () => {
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(NaN)).toBe('$0')
    expect(formatUsd(0.0261)).toBe('$0.0261')
    expect(formatUsd(1.5)).toBe('$1.50')
    expect(formatUsd(0.0004)).toBe('$0.0004')
  })
})

describe('formatTry', () => {
  it('converts USD to TL at 49 and formats tr-TR', () => {
    expect(USD_TO_TRY).toBe(49)
    expect(formatTry(0)).toBe('₺0')
    expect(formatTry(NaN)).toBe('₺0')
    // 0.0261 * 49 = 1.2789 → 2 digits
    expect(formatTry(0.0261)).toBe('₺1,28')
    // 0.0004 * 49 = 0.0196 → 4 digits
    expect(formatTry(0.0004)).toBe('₺0,0196')
    // 42.5s output-only: 0.006375 * 49 = 0.312375 → 4 digits
    expect(formatTry(costFromDuration(42.5).standardUsd)).toBe('₺0,3124')
  })
})

describe('formatTime', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(42.5)).toBe('00:42')
    expect(formatTime(3661)).toBe('1:01:01')
    expect(formatTime(NaN)).toBe('00:00')
    expect(formatTime(-1)).toBe('00:00')
  })
})

describe('PRICING identity', () => {
  it('audio rate is $0.00015 per second (Flash-Lite)', () => {
    const rate =
      (PRICING.AUDIO_TOKENS_PER_SECOND * PRICING.OUTPUT_USD_PER_1M_TOKENS) / 1_000_000
    expect(rate).toBeCloseTo(0.00015, 12)
  })

  it('Flash audio rate is $0.000225 per second', () => {
    const c = costFromDuration(42.5, '', 'gemini-3.8-flash-tts')
    expect(c.outputUsd).toBeCloseTo(42.5 * 0.000225, 10)
  })
})

describe('model pricing', () => {
  it('defaults to Flash-Lite rates', () => {
    const lite = estimateCostFromText('a'.repeat(2400) + ' '.repeat(600))
    expect(lite.outputUsd).toBeCloseTo((2400 / 14) * 0.00015, 10)
  })

  it('Flash costs more than Lite on audio side', () => {
    const text = 'a'.repeat(2400)
    const lite = estimateCostFromText(text, 'gemini-3.8-flash-lite-tts')
    const flash = estimateCostFromText(text, 'gemini-3.8-flash-tts')
    expect(flash.inputUsd).toBeCloseTo(lite.inputUsd, 12)
    expect(flash.outputUsd).toBeCloseTo(lite.outputUsd * 1.5, 10)
  })
})

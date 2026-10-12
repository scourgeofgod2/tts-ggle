export interface RetryOptions {
  retries?: number
  baseMs?: number
  signal?: AbortSignal
  onRetry?: (attempt: number, error: unknown) => void
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const retries = opts.retries ?? 3
  const baseMs = opts.baseMs ?? 500
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(opts.signal)
    } catch (err) {
      lastError = err
      if (opts.signal?.aborted) throw err
      if (err instanceof DOMException && err.name === 'AbortError') throw err

      const status = (err as { status?: number })?.status
      const retriable =
        status === undefined ||
        status === 429 ||
        status >= 500 ||
        (err instanceof TypeError) // network error

      if (!retriable || attempt === retries) throw err

      opts.onRetry?.(attempt + 1, err)
      const delay = baseMs * Math.pow(2, attempt)
      await sleep(delay, opts.signal)
    }
  }
  throw lastError
}

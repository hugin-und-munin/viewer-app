export function scheduleAtInterval(
  intervalMinutes: 15 | 30 | 60,
  callback: () => void,
): () => void {
  const intervalMs = intervalMinutes * 60 * 1000

  const now = Date.now()
  const delay = intervalMs - (now % intervalMs)

  let intervalId: ReturnType<typeof setInterval> | undefined

  const timeoutId = setTimeout(() => {
    callback()
    intervalId = setInterval(callback, intervalMs)
  }, delay)

  return () => {
    clearTimeout(timeoutId)
    if (intervalId) clearInterval(intervalId)
  }
}

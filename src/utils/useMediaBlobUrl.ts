import { useEffect, useRef, useState } from 'react'
import { getApi } from '../api/api'

// Fetches /media/{mediaId} as a blob URL, revoking the previous object URL as
// mediaId changes. `settled` distinguishes "still loading" from "confirmed no
// image" — needed by callers (e.g. Chat) that gate playback timing on it.
export function useMediaBlobUrl(mediaId: string | undefined): {
  url: string | null
  settled: boolean
} {
  const [state, setState] = useState<{
    url: string | null
    settledFor: string | undefined
  }>({
    url: null,
    settledFor: undefined,
  })
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!mediaId) return
    let cancelled = false
    getApi()
      .getBlob(`/media/${mediaId}`)
      .then((url) => {
        if (cancelled) return
        if (url) {
          if (urlRef.current) URL.revokeObjectURL(urlRef.current)
          urlRef.current = url
        }
        setState({ url: url ?? null, settledFor: mediaId })
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, settledFor: mediaId })
      })
    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      setState({ url: null, settledFor: undefined })
    }
  }, [mediaId])

  return { url: state.url, settled: state.settledFor === mediaId }
}

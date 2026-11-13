/** Normalises a channel/handle so the same target typed differently still matches. */
export function normalizeTarget(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.|m\.)/, '')
    .replace(/^(youtube\.com\/|youtu\.be\/|instagram\.com\/|tiktok\.com\/|t\.me\/)/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/(videos|featured|shorts|streams|about|reels)?\/*$/, '')
    .replace(/^@/, '')
}

export const isYoutubeTarget = (value: string) =>
  /^@[\w.-]{2,}$/.test(value) || /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/\S+$/i.test(value)

export const isInstagramTarget = (value: string) =>
  /^@[\w.]{2,30}$/.test(value) || /^https?:\/\/(www\.)?instagram\.com\/[\w.]{2,30}\/?$/i.test(value)

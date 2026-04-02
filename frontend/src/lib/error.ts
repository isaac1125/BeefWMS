export function toUserErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const lower = raw.toLowerCase()

  if (lower.includes('fetch failed') || lower.includes('enotfound')) {
    return '無法連線到 Supabase，請確認 `VITE_SUPABASE_URL` 是否為正確的專案網址（Project URL）。'
  }

  return raw && raw !== 'undefined' ? raw : fallback
}


import type { ItemRow } from '../types/db'

const KEY = 'beefwms:itemOrderIds'

export function readStoredItemOrder(): string[] | null {
  try {
    const s = localStorage.getItem(KEY)
    if (!s) return null
    const a = JSON.parse(s) as unknown
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

export function writeStoredItemOrder(ids: string[]) {
  localStorage.setItem(KEY, JSON.stringify(ids))
}

/** 依儲存的 id 順序重排品項；多出或缺少的品項接在後面 */
export function applyStoredItemOrder(itemsArr: ItemRow[]): ItemRow[] {
  const order = readStoredItemOrder()
  if (!order?.length) return itemsArr
  const map = new Map(itemsArr.map((x) => [x.id, x]))
  const next: ItemRow[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const x = map.get(id)
    if (x) {
      next.push(x)
      seen.add(id)
    }
  }
  for (const it of itemsArr) {
    if (!seen.has(it.id)) next.push(it)
  }
  return next
}

export function isMissingSortOrderColumn(err: unknown): boolean {
  const o = err as { message?: string; code?: string }
  const m = String(o?.message ?? err ?? '')
  const code = String(o?.code ?? '')
  if (code === '42703') return true
  return (
    m.includes('sort_order') &&
    (m.includes('does not exist') ||
      m.includes('schema cache') ||
      m.includes('Could not find') ||
      m.includes('42703'))
  )
}

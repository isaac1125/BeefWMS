import { formatISO } from 'date-fns'

/**
 * 日期工具：一律使用 YYYY-MM-DD（ISO date）
 */
export function toISODate(d: Date): string {
  // date-fns formatISO 預設輸出 YYYY-MM-DD
  return formatISO(d, { representation: 'date' })
}


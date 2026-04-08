/** 工資「本月斤數」換算用：16 兩 = 1 斤（計價仍要求兩為 0～15） */
export const LIANG_PER_JIN = 16

/** 將斤兩進位成「兩 < 16」，供工資加總換算成小數斤 */
export function normalizeJinLiang(jin: number, liang: number): { jin: number; liang: number } {
  let j = Math.trunc(Number(jin))
  let l = Math.trunc(Number(liang))
  if (!Number.isFinite(j)) j = 0
  if (!Number.isFinite(l)) l = 0
  if (j < 0) j = 0
  if (l < 0) l = 0
  j += Math.floor(l / LIANG_PER_JIN)
  l = l % LIANG_PER_JIN
  return { jin: j, liang: l }
}

/** 總兩數（整數），用於計價；兩必須在 [0, 15] */
export function jinLiangToTotalLiang(jin: number, liang: number): number {
  const j = Number(jin)
  const l = Number(liang)

  if (!Number.isFinite(j) || !Number.isFinite(l)) throw new Error('Invalid jin/liang')
  if (l < 0 || l >= 16) throw new Error('liang must be in range [0, 15]')
  if (j < 0) throw new Error('jin must be >= 0')

  return j * 16 + l
}

/** 換算成小數「斤」（僅工資統計） */
export function jinLiangToJinDecimal(jin: number, liang: number): number {
  const { jin: j, liang: l } = normalizeJinLiang(jin, liang)
  return j + l / LIANG_PER_JIN
}

export function calcAmountByTotalLiang(
  totalLiang: number,
  pricePerJin: number,
): number {
  const p = Number(pricePerJin)
  if (!Number.isFinite(p) || p < 0) throw new Error('Invalid pricePerJin')

  return (totalLiang * (p / 16))
}

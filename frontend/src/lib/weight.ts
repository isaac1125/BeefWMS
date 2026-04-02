export function jinLiangToTotalLiang(jin: number, liang: number): number {
  const j = Number(jin)
  const l = Number(liang)

  if (!Number.isFinite(j) || !Number.isFinite(l)) throw new Error('Invalid jin/liang')
  if (l < 0 || l >= 16) throw new Error('liang must be in range [0, 15]')
  if (j < 0) throw new Error('jin must be >= 0')

  return j * 16 + l
}

export function calcAmountByTotalLiang(
  totalLiang: number,
  pricePerJin: number,
): number {
  // total two * (price per jin / 16)
  const p = Number(pricePerJin)
  if (!Number.isFinite(p) || p < 0) throw new Error('Invalid pricePerJin')

  return (totalLiang * (p / 16))
}


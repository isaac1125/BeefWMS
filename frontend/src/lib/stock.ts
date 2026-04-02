export function calcOnHandPackages(basePackages: number, takenPackages: number): number {
  const base = Number(basePackages)
  const taken = Number(takenPackages)
  if (!Number.isFinite(base) || !Number.isFinite(taken)) throw new Error('Invalid stock numbers')
  return base - taken
}


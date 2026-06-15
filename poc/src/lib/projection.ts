export interface ProjectionPoint {
  month: number
  amplified: number
  plain?: number
  pessimistic: number
  optimistic: number
  band: number
}

export interface BuildProjectionInput {
  deposit: number
  apyPercent: number
  baseApyPercent?: number
  years: 1 | 3 | 5
}

export function buildProjection({ deposit, apyPercent, baseApyPercent, years }: BuildProjectionInput): ProjectionPoint[] {
  const months = years * 12
  const points: ProjectionPoint[] = []

  for (let m = 0; m <= months; m++) {
    const t = m / 12
    const amplified = deposit * Math.pow(1 + apyPercent / 100, t)
    const pessimistic = deposit * Math.pow(1 + (apyPercent * 0.7) / 100, t)
    const optimistic = deposit * Math.pow(1 + (apyPercent * 1.3) / 100, t)
    const band = optimistic - pessimistic
    const plain = baseApyPercent !== undefined
      ? deposit * Math.pow(1 + baseApyPercent / 100, t)
      : undefined
    points.push({ month: m, amplified, plain, pessimistic, optimistic, band })
  }

  return points
}

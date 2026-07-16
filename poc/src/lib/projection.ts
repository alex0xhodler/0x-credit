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

export type ProjectionPeriodMonths = 1 | 6 | 12

export interface YieldComparisonSeries {
  id: string
  apyPercent: number
}

export interface YieldComparisonPoint {
  month: number
  [seriesId: string]: number
}

/**
 * A forward yield-only illustration. Every series begins from 1 ETH-equivalent
 * so the chart compares APY assumptions rather than incompatible token units.
 */
export function buildYieldComparisonProjection({
  months,
  series,
}: {
  months: ProjectionPeriodMonths
  series: readonly YieldComparisonSeries[]
}): YieldComparisonPoint[] {
  const steps = months === 1 ? 30 : months
  const points: YieldComparisonPoint[] = []

  for (let step = 0; step <= steps; step++) {
    const month = months === 1 ? step / 30 : step
    const point: YieldComparisonPoint = { month }
    for (const item of series) {
      point[item.id] = Math.pow(1 + item.apyPercent / 100, month / 12)
    }
    points.push(point)
  }

  return points
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

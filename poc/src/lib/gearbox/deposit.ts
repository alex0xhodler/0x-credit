export interface DepositPreset {
  label: string
  value: number
}

export interface DepositControls {
  reset: number
  presets: DepositPreset[]
  steps: [number, number, number]
}

export function getDepositControls(minDeposit: number): DepositControls {
  const reset = minDeposit

  let steps: [number, number, number]
  if (minDeposit >= 500) {
    steps = [100, 500, 1000]
  } else if (minDeposit >= 50) {
    steps = [10, 50, 100]
  } else if (minDeposit >= 5) {
    steps = [1, 5, 10]
  } else {
    steps = [0.1, 1, 5]
  }

  const presets: DepositPreset[] = [
    { label: 'Min', value: minDeposit },
    { label: '2×', value: minDeposit * 2 },
    { label: '5×', value: minDeposit * 5 },
  ]

  return { reset, presets, steps }
}

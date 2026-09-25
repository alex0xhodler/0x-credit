import { beforeEach, describe, expect, it, vi } from 'vitest'

const attach = vi.fn()
const listOpportunities = vi.fn()

vi.mock('@gearbox-protocol/sdk/onchain', async () => {
  const actual = await vi.importActual<typeof import('@gearbox-protocol/sdk/onchain')>('@gearbox-protocol/sdk/onchain')
  return {
    ...actual,
    OnchainSDK: vi.fn(function () {
      return { attach, opportunities: { list: listOpportunities } }
    }),
  }
})

vi.mock('@gearbox-protocol/sdk/plugins/bots', async () => {
  const actual = await vi.importActual<typeof import('@gearbox-protocol/sdk/plugins/bots')>('@gearbox-protocol/sdk/plugins/bots')
  return {
    ...actual,
    BotsPlugin: vi.fn(function () {
      return { load: vi.fn().mockResolvedValue(undefined), loaded: false, bots: [] }
    }),
  }
})

vi.mock('./apyFeed', () => ({
  fetchCollateralApys: vi.fn().mockResolvedValue(new Map()),
}))

const { loadMainnetOpportunities, resetGearboxOpportunityCache } = await import('./live')

describe('loadMainnetOpportunities', () => {
  beforeEach(() => {
    resetGearboxOpportunityCache()
    attach.mockReset()
    listOpportunities.mockReset()
  })

  it('does not keep a failed load cached, so the next call attaches again', async () => {
    attach.mockRejectedValue(new Error('getMarkets reverted'))
    await expect(loadMainnetOpportunities()).rejects.toThrow('getMarkets reverted')

    attach.mockResolvedValue(undefined)
    listOpportunities.mockResolvedValue([])
    await expect(loadMainnetOpportunities()).resolves.toEqual([])
  })

  it('retries attach once before failing', async () => {
    attach.mockRejectedValueOnce(new Error('getMarkets reverted')).mockResolvedValueOnce(undefined)
    listOpportunities.mockResolvedValue([])

    await expect(loadMainnetOpportunities()).resolves.toEqual([])
    expect(attach).toHaveBeenCalledTimes(2)
  })
})

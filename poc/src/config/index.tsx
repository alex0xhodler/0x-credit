import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { monad } from '@reown/appkit/networks'
import type { AppKitNetwork } from '@reown/appkit/networks'

// Get projectId from https://dashboard.reown.com
const configuredProjectId = import.meta.env.VITE_REOWN_PROJECT_ID || import.meta.env.VITE_PROJECT_ID || ''
const localhostProjectId = 'b56e18d47c72ab683b10814fe9495694'
export const isReownProjectConfigured = Boolean(configuredProjectId)
export const projectId = configuredProjectId || localhostProjectId

export const metadata = {
  name: '0x.credit',
  description: 'Amplified USDC yield routes on Monad',
  url: typeof window === 'undefined' ? 'https://0x.credit' : window.location.origin,
  icons: ['https://avatars.githubusercontent.com/u/179229932'],
}

export const networks = [monad] as [AppKitNetwork, ...AppKitNetwork[]]

//Set up the Wagmi Adapter (Config)
export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
})

export const config = wagmiAdapter.wagmiConfig

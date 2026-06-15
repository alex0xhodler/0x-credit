# 0x.credit PoC

This is the Vite + React frontend for 0x.credit. It uses Reown AppKit, wagmi, viem, recharts, and the local Gearbox SDK checkout in `../sdk`.

The UI is a single-screen cockpit: a two-pane card with an earnings projection chart on the left and a deposit builder on the right. Strategy selection is a persistent tab bar in the card header. The old 2-step landing → deposit flow has been replaced entirely by this cockpit layout.

## Usage

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env.local` for local development.

Required:

- `VITE_REOWN_PROJECT_ID`: Reown project id for wallet connections.

Optional:

- `VITE_MONAD_RPC_URL`: Monad RPC used by the Gearbox SDK. Defaults to `https://rpc.monad.xyz`.
- `VITE_MAINNET_RPC_URL`: Ethereum Mainnet RPC. Defaults to `https://ethereum-rpc.publicnode.com`.
- `VITE_GEARBOX_APY_URL`: APY snapshot URL. Defaults to `/gearbox-apy/latest.json`, proxied by Vite locally and Vercel in production.

## Resources

- [Reown — Docs](https://docs.reown.com)
- [Gearbox Dev Docs](https://dev.gearbox.finance/)

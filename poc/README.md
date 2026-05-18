# 0x.credit PoC

This is the Vite + React frontend for 0x.credit. It uses Reown AppKit, wagmi, viem, and the local Gearbox SDK checkout in `../sdk`.

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
- `VITE_GEARBOX_APY_URL`: APY snapshot URL. Defaults to `/gearbox-apy/latest.json`.

## Resources

- [Reown — Docs](https://docs.reown.com)
- [Gearbox Dev Docs](https://dev.gearbox.finance/)

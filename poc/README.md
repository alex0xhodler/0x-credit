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

- `VITE_MAINNET_RPC_URL`: Ethereum Mainnet RPC used by the Gearbox SDK. Set a dedicated RPC in production; the public default occasionally fails. Defaults to `https://ethereum-rpc.publicnode.com`.
- `VITE_GEARBOX_API_URL`: Base URL of the Gearbox backend (`GearboxAPI` from `@gearbox-protocol/sdk/offchain`), used for collateral APY and the strategy back-test chart — the only off-chain strategy inputs. Defaults to `https://api.gearbox.foundation`.

## Resources

- [Reown — Docs](https://docs.reown.com)
- [Gearbox Dev Docs](https://dev.gearbox.finance/)

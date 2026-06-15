# 0x.credit

0x.credit is a focused Gearbox earning-route proof of concept. It uses Reown AppKit, wagmi, viem, and the Gearbox SDK to let a user configure a deposit, visualise projected earnings, and open a Gearbox credit account — all from a single cockpit screen.

## Run locally

```sh
git submodule update --init --recursive
cd poc
npm install
npm run dev
```

The app reads `VITE_REOWN_PROJECT_ID` from `poc/.env.local` when present.


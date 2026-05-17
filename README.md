# 0x.credit

0x.credit is a focused Gearbox earning-route proof of concept. It uses Reown AppKit, wagmi, viem, and the Gearbox SDK to help a user choose an opportunity, approve the deposit token, and open a Gearbox credit account from one focused flow.

## Run locally

```sh
git submodule update --init --recursive
cd poc
npm install
npm run dev
```

The app reads `VITE_REOWN_PROJECT_ID` from `poc/.env.local` when present.


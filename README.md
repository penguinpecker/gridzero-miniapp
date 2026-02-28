# GridZero V4 — Farcaster Mini App

**Zero Knowledge. Full Degen.** Pick a cell on the 5×5 grid. If VRF picks yours, you win the pot.

Built from TheGrid.js — adapted for Farcaster/Base MiniKit.

## Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| GridZeroV4 | `0x58497ADCc524ee9a0DA11900af32bFa973fE55d3` |
| ZeroToken | `0x5E9335199d98402897fA5d3A5F21572280cdCDD0` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## What changed from TheGrid.js

| Original (Privy) | Mini App (MiniKit) |
|---|---|
| `usePrivy()` login/logout | `useAccount()` isConnected/address |
| `useWallets()` + manual walletClient | `useSendTransaction()` via wagmi |
| Desktop sidebar + mobile drawer | Single column (mini app webview) |
| Privy embedded wallet | Coinbase Smart Wallet |

Everything else is identical: V4 ABIs, multicall polling, SSE, Supabase history, Base logo grid, 60fps timer, scan line, CRT overlay, double-tap, all animations.

## Setup

```bash
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_ONCHAINKIT_API_KEY from portal.cdp.coinbase.com
npm run dev
```

## Deploy

1. Push to GitHub → Import in Vercel
2. Set env: `NEXT_PUBLIC_URL`, `NEXT_PUBLIC_ONCHAINKIT_API_KEY`
3. Sign manifest at warpcast.com/~/developers/mini-apps/manifest
4. Add `FARCASTER_HEADER`, `FARCASTER_PAYLOAD`, `FARCASTER_SIGNATURE`
5. Redeploy → Cast URL = embedded mini app

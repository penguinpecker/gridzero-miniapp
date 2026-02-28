import { NextResponse } from "next/server";
const APP_URL = process.env.NEXT_PUBLIC_URL ?? "https://gridzero.vercel.app";

export async function GET() {
  return NextResponse.json({
    accountAssociation: {
      header: process.env.FARCASTER_HEADER ?? "",
      payload: process.env.FARCASTER_PAYLOAD ?? "",
      signature: process.env.FARCASTER_SIGNATURE ?? "",
    },
    frame: {
      version: "next",
      name: "GridZero",
      subtitle: "Zero Knowledge. Full Degen.",
      description: "Pick a cell on the 5×5 grid. If VRF picks yours, you win the pot. On-chain on Base.",
      iconUrl: `${APP_URL}/icon.png`,
      splashImageUrl: `${APP_URL}/splash.png`,
      splashBackgroundColor: "#060A14",
      homeUrl: APP_URL,
      webhookUrl: `${APP_URL}/api/webhook`,
      primaryCategory: "games",
      tags: ["gaming", "zk", "defi", "base", "usdc"],
    },
  });
}

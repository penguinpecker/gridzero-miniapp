"use client";
import { useEffect } from "react";
import { useAccount } from "wagmi";
import sdk from "@farcaster/frame-sdk";
import TheGrid from "@/components/TheGrid";
import ConnectScreen from "@/components/ConnectScreen";

export default function Page() {
  const { isConnected } = useAccount();

  useEffect(() => {
    sdk.actions.ready();
  }, []);

  if (!isConnected) return <ConnectScreen />;
  return <TheGrid />;
}

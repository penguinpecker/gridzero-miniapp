"use client";
import { useEffect } from "react";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import TheGrid from "@/components/TheGrid";

export default function Page() {
  const { setFrameReady, isFrameReady } = useMiniKit();
  useEffect(() => { if (!isFrameReady) setFrameReady(); }, [setFrameReady, isFrameReady]);
  return <TheGrid />;
}

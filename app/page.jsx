"use client";
import { useEffect } from "react";
import sdk from "@farcaster/frame-sdk";
import TheGrid from "@/components/TheGrid";

export default function Page() {
  useEffect(() => { sdk.actions.ready(); }, []);
  return <TheGrid />;
}

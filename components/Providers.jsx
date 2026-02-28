"use client";
import { MiniKitProvider } from "@coinbase/onchainkit/minikit";
import { base } from "wagmi/chains";

export function Providers({ children }) {
  return (
    <MiniKitProvider
      apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY}
      chain={base}
      config={{
        appearance: {
          mode: "dark",
          name: "GridZero",
          logo: process.env.NEXT_PUBLIC_URL ? `${process.env.NEXT_PUBLIC_URL}/icon.png` : undefined,
        },
      }}
    >
      {children}
    </MiniKitProvider>
  );
}

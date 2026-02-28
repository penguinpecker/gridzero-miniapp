"use client";
import { MiniKitProvider } from "@coinbase/onchainkit/minikit";
import { base } from "wagmi/chains";

export function Providers({ children }) {
  return (
    <MiniKitProvider
      chain={base}
      rpcUrl="https://mainnet.base.org"
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

import { Providers } from "@/components/Providers";

const APP_URL = process.env.NEXT_PUBLIC_URL ?? "https://gridzero.vercel.app";

export async function generateMetadata() {
  return {
    title: "GridZero — Zero Knowledge. Full Degen.",
    description: "Pick a cell. Beat the grid. Win USDC. On-chain on Base.",
    other: {
      "fc:frame": JSON.stringify({
        version: "next",
        imageUrl: `${APP_URL}/hero.png`,
        button: {
          title: "Play GridZero",
          action: {
            type: "launch_frame",
            name: "GridZero",
            url: APP_URL,
            splashImageUrl: `${APP_URL}/splash.png`,
            splashBackgroundColor: "#060A14",
          },
        },
      }),
    },
  };
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#060A14", overflowX: "hidden" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

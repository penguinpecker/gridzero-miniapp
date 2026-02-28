"use client";
import { useConnect } from "wagmi";
import { useState } from "react";

export default function ConnectScreen() {
  const { connect, connectors, isPending } = useConnect();
  const [error, setError] = useState(null);

  const handleConnect = () => {
    setError(null);
    try {
      connect({ connector: connectors[0] });
    } catch (e) {
      setError(e.shortMessage || e.message || "Connection failed");
    }
  };

  return (
    <div style={styles.root}>
      <div style={styles.scanLines} />

      <div style={styles.container}>
        {/* Logo */}
        <svg width="64" height="64" viewBox="0 0 80 80" fill="none">
          <defs>
            <linearGradient id="lgConnect" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#3B7BF6" />
              <stop offset="100%" stopColor="#1652F0" />
            </linearGradient>
          </defs>
          <rect x="4" y="4" width="72" height="72" rx="16" fill="url(#lgConnect)" />
          <line x1="30" y1="4" x2="30" y2="76" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
          <line x1="50" y1="4" x2="50" y2="76" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
          <line x1="4" y1="30" x2="76" y2="30" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
          <line x1="4" y1="50" x2="76" y2="50" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
          <text x="40" y="56" textAnchor="middle" fontFamily="'Orbitron', sans-serif" fontWeight="900" fontSize="48" fill="white" letterSpacing="-2">0</text>
        </svg>

        <div style={styles.title}>
          <span style={styles.titleGrid}>GRID</span>
          <span style={styles.titleZero}>ZERO</span>
        </div>

        <div style={styles.tagline}>Zero Knowledge. Full Degen.</div>

        <div style={styles.desc}>
          Pick a cell on the 5×5 grid. If VRF picks yours, you win the pot.
          1 USDC per round · 30s rounds · On-chain on Base.
        </div>

        <button
          onClick={handleConnect}
          disabled={isPending}
          style={styles.btn}
        >
          {isPending ? "⟐ CONNECTING..." : "⚡ CONNECT WALLET"}
        </button>

        {error && (
          <div style={styles.error}>⚠ {error}</div>
        )}

        <div style={styles.footer}>
          <span style={styles.footerDot} />
          <span style={styles.footerText}>BASE · VRF · GROTH16</span>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap');
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes scanGlow {
          0% { text-shadow: 0 0 4px #3B7BF6; }
          50% { text-shadow: 0 0 12px #3B7BF6, 0 0 24px #3B7BF644; }
          100% { text-shadow: 0 0 4px #3B7BF6; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    fontFamily: "'JetBrains Mono', monospace",
    background: "radial-gradient(ellipse at 30% 20%, #0D1A30 0%, #080E1C 50%, #060A14 100%)",
    color: "#c8d6e5",
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
  },
  scanLines: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: "none",
    zIndex: 1,
    background: "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
  },
  container: {
    position: "relative",
    zIndex: 5,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    padding: "40px 24px",
    maxWidth: 380,
    width: "100%",
  },
  title: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 },
  titleGrid: {
    fontFamily: "'Orbitron', sans-serif", fontWeight: 900, fontSize: 28,
    color: "#3B7BF6", letterSpacing: 4,
  },
  titleZero: {
    fontFamily: "'Orbitron', sans-serif", fontWeight: 500, fontSize: 28,
    color: "#e0e8f0", letterSpacing: 3,
  },
  tagline: {
    fontFamily: "'Orbitron', sans-serif", fontSize: 10, fontWeight: 600,
    letterSpacing: 3, color: "#3B7BF6", textTransform: "uppercase",
    animation: "scanGlow 3s ease-in-out infinite",
  },
  desc: {
    fontSize: 12, lineHeight: 1.6, color: "#6a7b8e", textAlign: "center", maxWidth: 300,
  },
  btn: {
    fontFamily: "'Orbitron', sans-serif", fontSize: 13, fontWeight: 700,
    padding: "16px 20px", borderRadius: 10, border: "none", width: "100%",
    background: "linear-gradient(135deg, #1652F0, #3B7BF6)", color: "#fff",
    cursor: "pointer", letterSpacing: 1.5, marginTop: 8,
    boxShadow: "0 4px 24px rgba(22,82,240,0.35)",
  },
  error: {
    padding: "10px 14px", borderRadius: 6,
    border: "1px solid rgba(255,51,85,0.3)", background: "rgba(255,51,85,0.08)",
    color: "#ff3355", fontSize: 11, width: "100%", textAlign: "center",
  },
  footer: { display: "flex", alignItems: "center", gap: 8, marginTop: 16 },
  footerDot: {
    display: "inline-block", width: 6, height: 6, borderRadius: "50%",
    background: "#3B7BF6", boxShadow: "0 0 6px #3B7BF688",
    animation: "pulse 2s ease-in-out infinite",
  },
  footerText: { fontSize: 10, color: "#4a5a6e", letterSpacing: 1.5 },
};

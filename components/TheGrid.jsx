"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount, useSendTransaction, useDisconnect } from "wagmi";
import sdk from "@farcaster/frame-sdk";
import { useResolverSSE } from "@/lib/useResolverSSE";
import { createPublicClient, http, fallback, encodeFunctionData, parseUnits } from "viem";
import { base } from "viem/chains";

// ═══════════════════════════════════════════════════════════════
// V4 CONTRACT ABI — GridZero: Round-Based Betting on Base (Auto-Pay)
// GridZeroV4: 0x58497ADCc524ee9a0DA11900af32bFa973fE55d3
// ZeroToken: 0x5E9335199d98402897fA5d3A5F21572280cdCDD0
// USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
// Chain: Base Mainnet (8453)
// ═══════════════════════════════════════════════════════════════
const GRID_ABI = [
  { name: "currentRoundId", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getCurrentRound", type: "function", stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint256" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "totalDeposits", type: "uint256" },
      { name: "totalPlayers", type: "uint256" },
      { name: "timeRemaining", type: "uint256" },
    ] },
  { name: "rounds", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "totalDeposits", type: "uint256" },
      { name: "totalPlayers", type: "uint256" },
      { name: "winningCell", type: "uint8" },
      { name: "resolved", type: "bool" },
      { name: "isBonusRound", type: "bool" },
    ] },
  { name: "playerCell", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint8" }] },
  { name: "pickCell", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "cell", type: "uint8" }], outputs: [] },
  { name: "entryFee", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "roundDuration", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "zeroPerRound", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "hasJoined", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "player", type: "address" }],
    outputs: [{ name: "", type: "bool" }] },
  { name: "getCellCounts", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [{ name: "counts", type: "uint256[25]" }] },
  { name: "getCellPlayers", type: "function", stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }, { name: "cell", type: "uint8" }],
    outputs: [{ name: "", type: "address[]" }] },
  { name: "protocolFeeBps", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "resolverReward", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
];

const TOKEN_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

const USDC_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const GRID_ADDR = "0x58497ADCc524ee9a0DA11900af32bFa973fE55d3";
const TOKEN_ADDR = "0x5E9335199d98402897fA5d3A5F21572280cdCDD0";
const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CELL_COST = "1";
const CELL_COST_RAW = 1000000n;
const ROUND_DURATION = 60;
const PICK_BUFFER = 5; // seconds before endTime to disable picks (tx needs time to land on-chain)
const GRID_SIZE = 5;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const SUPABASE_URL = "https://dqvwpbggjlcumcmlliuj.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxdndwYmdnamxjdW1jbWxsaXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MzA2NjIsImV4cCI6MjA4NjIwNjY2Mn0.yrkg3mv62F-DiGA8-cajSSkwnhKBXRbVlr4ye6bdfTc";
const dbHeaders = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
const EXPLORER = "https://basescan.org";

const CELL_LABELS = [];
for (let r = 0; r < GRID_SIZE; r++)
  for (let c = 0; c < GRID_SIZE; c++)
    CELL_LABELS.push(`${String.fromCharCode(65 + r)}${c + 1}`);

// Our own public client — WE control the RPC, not MetaMask
const publicClient = createPublicClient({
  chain: base,
  batch: { multicall: true },
  transport: fallback([
    http("https://base-mainnet.g.alchemy.com/v2/demo", { timeout: 8_000, retryCount: 1, retryDelay: 500 }),
    http("https://1rpc.io/base", { timeout: 8_000, retryCount: 1, retryDelay: 500 }),
    http("https://mainnet.base.org", { timeout: 8_000, retryCount: 1, retryDelay: 500 }),
  ]),
});

const fmt = (v, d = 2) => {
  if (!v) return "0." + "0".repeat(d);
  return (Number(v) / 1e6).toFixed(d);
};
const fmtEth = (v, d = 4) => {
  if (!v) return "0." + "0".repeat(d);
  return (Number(v) / 1e18).toFixed(d);
};

// Base logo grid pattern
const DARK_CELLS = new Set([0,1,2,3,4, 5,9, 10,14, 15,19, 20,21,22,23,24]);
const OPENING_CELLS = new Set([11,12,13]);
const getCellZone = (idx) => {
  if (DARK_CELLS.has(idx)) return "dark";
  if (OPENING_CELLS.has(idx)) return "opening";
  return "light";
};

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function TheGrid() {
  // MiniKit: useAccount replaces usePrivy, useSendTransaction replaces manual walletClient
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { disconnect } = useDisconnect();

  // Contract state — identical to original
  const [round, setRound] = useState(0);
  const [roundStart, setRoundStart] = useState(0);
  const [roundEnd, setRoundEnd] = useState(0);
  const [potSize, setPotSize] = useState("0");
  const [activePlayers, setActivePlayers] = useState(0);
  const [resolved, setResolved] = useState(false);
  const [winningCell, setWinningCell] = useState(-1);
  const [claimedCells, setClaimedCells] = useState(new Set());
  const [cellCounts, setCellCounts] = useState(new Array(TOTAL_CELLS).fill(0));
  const [playerCell, setPlayerCell] = useState(-1);
  const [gridBalance, setGridBalance] = useState("0");
  const [ethBalance, setEthBalance] = useState("0");
  const [usdcApproved, setUsdcApproved] = useState(false);
  const [allowanceChecked, setAllowanceChecked] = useState(false);
  const [approving, setApproving] = useState(false);

  // UI state
  const [smoothTime, setSmoothTime] = useState(0);
  const [selectedCell, setSelectedCell] = useState(null);
  const lastTapRef = useRef({ cell: -1, time: 0 });
  const [hoveredCell, setHoveredCell] = useState(-1);
  const [claiming, setClaiming] = useState(false);
  const [feed, setFeed] = useState([]);
  const [userHistory, setUserHistory] = useState([]);
  const [userHistoryLoading, setUserHistoryLoading] = useState(false);
  const userHistoryLoaded = useRef(false);
  const [scanLine, setScanLine] = useState(0);
  const [error, setError] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const feeConfig = useRef({ feeBps: 500, resolverReward: 100000 });
  const [roundHistory, setRoundHistory] = useState([]);
  const [moneyFlow, setMoneyFlow] = useState(false);
  const [gridFlash, setGridFlash] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFullyLoaded, setHistoryFullyLoaded] = useState(false);
  const historyCursor = useRef(0);
  const resolverTxHash = useRef(null);
  const HISTORY_PAGE_SIZE = 10;

  const animFrame = useRef(null);
  const pollRef = useRef(null);
  const lastRoundRef = useRef(0);
  const resolvedRef = useRef(false);

  // ─── SSE: Real-time events from resolver ───
  const { connected: sseConnected } = useResolverSSE({
    url: "https://extraordinary-integrity-production-0b2a.up.railway.app/events",
    onRoundResolved: () => pollState(),
    onCellPicked: (data) => {
      setCellCounts(prev => {
        const next = [...prev];
        next[data.cell] = (next[data.cell] || 0) + 1;
        return next;
      });
      setClaimedCells(prev => new Set([...prev, data.cell]));
    },
  });

  // ─── Read fee config once on mount ───
  useEffect(() => {
    Promise.all([
      publicClient.readContract({ address: GRID_ADDR, abi: GRID_ABI, functionName: "protocolFeeBps" }).catch(() => 500n),
      publicClient.readContract({ address: GRID_ADDR, abi: GRID_ABI, functionName: "resolverReward" }).catch(() => 100000n),
    ]).then(([bps, rr]) => {
      feeConfig.current = { feeBps: Number(bps), resolverReward: Number(rr) };
    });
  }, []);

  // ─── Smooth 60fps Timer ───
  useEffect(() => {
    const tick = () => {
      if (roundEnd > 0) {
        const remaining = Math.max(0, roundEnd - Date.now() / 1000);
        setSmoothTime(remaining);
      }
      animFrame.current = requestAnimationFrame(tick);
    };
    animFrame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame.current);
  }, [roundEnd]);

  // ─── Scan Line ───
  useEffect(() => {
    const iv = setInterval(() => setScanLine((p) => (p + 1) % 100), 40);
    return () => clearInterval(iv);
  }, []);

  // ─── Poll Contract (uses OUR public client, not wallet) ───
  const pollBusy = useRef(false);
  const pollState = useCallback(async () => {
    if (pollBusy.current) return;
    pollBusy.current = true;
    try {
      let roundId;
      try {
        roundId = await publicClient.readContract({
          address: GRID_ADDR, abi: GRID_ABI, functionName: "currentRoundId",
        });
      } catch (e) {
        console.error("Poll: currentRoundId failed", e);
        return;
      }
      setRound(Number(roundId));

      // Fire ALL reads in parallel (multicall)
      const promises = [
        publicClient.readContract({ address: GRID_ADDR, abi: GRID_ABI, functionName: "rounds", args: [roundId] }).catch(() => null),
        publicClient.readContract({ address: GRID_ADDR, abi: GRID_ABI, functionName: "getCellCounts", args: [roundId] }).catch(() => null),
      ];

      if (address) {
        promises.push(
          publicClient.readContract({ address: GRID_ADDR, abi: GRID_ABI, functionName: "hasJoined", args: [roundId, address] }).catch(() => null),
          publicClient.readContract({ address: TOKEN_ADDR, abi: TOKEN_ABI, functionName: "balanceOf", args: [address] }).catch(() => null),
          publicClient.readContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: "balanceOf", args: [address] }).catch(() => null),
          publicClient.readContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: "allowance", args: [address, GRID_ADDR] }).catch(() => null),
        );
      }

      const results = await Promise.all(promises);
      const [rd, counts] = results;

      if (rd) {
        setRoundStart(Number(rd[0]));
        setRoundEnd(Number(rd[1]));
        setPotSize(rd[2].toString());
        setActivePlayers(Number(rd[3]));
        const isResolved = rd[5];
        setResolved(isResolved);
        resolvedRef.current = isResolved;
        if (isResolved && Number(rd[4]) >= 0) setWinningCell(Number(rd[4]));
        else if (!isResolved) setWinningCell(-1);
      }

      if (counts) {
        const claimed = new Set();
        const countsArr = new Array(TOTAL_CELLS).fill(0);
        for (let i = 0; i < TOTAL_CELLS; i++) {
          const count = Number(counts[i]);
          countsArr[i] = count;
          if (count > 0) claimed.add(i);
        }
        setClaimedCells(claimed);
        setCellCounts(countsArr);
      }

      if (address) {
        const [, , joined, gridBal, usdcBal, allowance] = results;
        if (joined === true) {
          try {
            const pc = await publicClient.readContract({
              address: GRID_ADDR, abi: GRID_ABI, functionName: "playerCell", args: [roundId, address],
            });
            setPlayerCell(Number(pc) - 1);
          } catch (e) { console.error("Poll: playerCell failed", e); }
        } else if (joined === false) {
          setPlayerCell(-1);
        }
        if (gridBal != null) setGridBalance(gridBal.toString());
        if (usdcBal != null) setEthBalance(usdcBal.toString());
        if (allowance != null) {
          setUsdcApproved(allowance >= CELL_COST_RAW);
          if (!allowanceChecked) setAllowanceChecked(true);
        }
      }
    } catch (e) {
      console.error("Poll error:", e);
    } finally {
      pollBusy.current = false;
    }
  }, [address, roundEnd, allowanceChecked]);

  useEffect(() => {
    pollState();
    const tick = () => {
      pollState();
      const resolving = roundEnd > 0 && Date.now() / 1000 > roundEnd && !resolvedRef.current;
      const interval = sseConnected ? 10000 : (resolving ? 500 : 3000);
      pollRef.current = setTimeout(tick, interval);
    };
    pollRef.current = setTimeout(tick, 3000);
    return () => { clearTimeout(pollRef.current); };
  }, [pollState, sseConnected]);

  // ─── Load round history from Supabase ───
  const historyLoaded = useRef(false);
  const historyLoadingRef = useRef(false);
  const historyFullyLoadedRef = useRef(false);
  const historyOffset = useRef(0);
  const historyTotal = useRef(0);

  const fetchRoundHistory = async (offset, limit = HISTORY_PAGE_SIZE) => {
    if (historyLoadingRef.current) return [];
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/gz_rounds?select=*&order=round_id.desc&limit=${limit}&offset=${offset}`,
        { headers: { ...dbHeaders, Prefer: "count=exact" } }
      );
      const total = parseInt(r.headers.get("content-range")?.split("/")[1] || "0", 10);
      historyTotal.current = total;
      const data = await r.json();
      const results = (data || []).map(r => ({
        roundId: r.round_id, cell: r.winning_cell, players: r.total_players,
        pot: r.total_deposits, resolved: true, txHash: r.resolve_tx_hash,
      }));
      historyOffset.current = offset + results.length;
      if (historyOffset.current >= historyTotal.current) {
        historyFullyLoadedRef.current = true;
        setHistoryFullyLoaded(true);
      }
      return results;
    } catch (e) { console.error("History fetch error:", e); return []; }
    finally { historyLoadingRef.current = false; setHistoryLoading(false); }
  };

  useEffect(() => {
    if (!historyLoaded.current) {
      historyLoaded.current = true;
      fetchRoundHistory(0, HISTORY_PAGE_SIZE).then(results => {
        if (results.length > 0) setRoundHistory(results);
      });
    }
  }, []);

  const loadOlderHistory = () => {
    if (historyLoadingRef.current || historyFullyLoadedRef.current) return;
    fetchRoundHistory(historyOffset.current, HISTORY_PAGE_SIZE).then(results => {
      if (results.length > 0) {
        setRoundHistory(prev => {
          const existingIds = new Set(prev.map(r => r.roundId));
          return [...prev, ...results.filter(r => !existingIds.has(r.roundId))];
        });
      }
    });
  };

  // ─── User History from Supabase ───
  const userHistoryOffset = useRef(0);
  const userHistoryTotal = useRef(0);

  const fetchUserHistory = async (offset, limit = 10) => {
    if (!address) return [];
    try {
      const addr = address.toLowerCase();
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/gz_round_players?select=round_id,player_address,cell_picked,is_winner,pick_tx_hash,claimed,claim_tx_hash,gz_rounds!inner(winning_cell,total_players,total_deposits,resolve_tx_hash)&player_address=eq.${addr}&order=round_id.desc&limit=${limit}&offset=${offset}`,
        { headers: { ...dbHeaders, Prefer: "count=exact" } }
      );
      const total = parseInt(r.headers.get("content-range")?.split("/")[1] || "0", 10);
      userHistoryTotal.current = total;
      const data = await r.json();
      const wonRoundIds = (data || []).filter(h => h.is_winner).map(h => h.round_id);
      let winnersMap = {};
      if (wonRoundIds.length > 0) {
        try {
          const wr = await fetch(
            `${SUPABASE_URL}/rest/v1/gz_round_players?select=round_id&is_winner=eq.true&round_id=in.(${wonRoundIds.join(",")})`,
            { headers: dbHeaders }
          );
          const wData = await wr.json();
          for (const w of (wData || [])) winnersMap[w.round_id] = (winnersMap[w.round_id] || 0) + 1;
        } catch {}
      }
      return (data || []).map(h => ({
        roundId: h.round_id, cell: h.cell_picked, won: h.is_winner,
        resolved: true, pot: h.gz_rounds?.total_deposits || "0",
        numWinners: winnersMap[h.round_id] || 1, cost: "1000000",
      }));
    } catch (e) { console.error("User history fetch error:", e); return []; }
  };

  useEffect(() => {
    if (address && !userHistoryLoaded.current) {
      userHistoryLoaded.current = true;
      userHistoryOffset.current = 0;
      setUserHistoryLoading(true);
      fetchUserHistory(0, 10).then(results => {
        setUserHistory(results);
        userHistoryOffset.current = results.length;
        setUserHistoryLoading(false);
      });
    }
  }, [address]);

  useEffect(() => {
    if (round > 1 && address && userHistoryLoaded.current) {
      fetchUserHistory(0, 10).then(results => {
        if (results.length > 0) {
          setUserHistory(prev => {
            const merged = [...results];
            const newIds = new Set(results.map(r => r.roundId));
            for (const old of prev) if (!newIds.has(old.roundId)) merged.push(old);
            return merged.sort((a, b) => b.roundId - a.roundId);
          });
          userHistoryOffset.current = Math.max(userHistoryOffset.current, results.length);
        }
      });
    }
  }, [round]);

  // ─── Round Change ───
  useEffect(() => {
    if (round > 0 && round !== lastRoundRef.current) {
      const prevRound = lastRoundRef.current;
      if (prevRound > 0) {
        publicClient.readContract({
          address: GRID_ADDR, abi: GRID_ABI, functionName: "rounds", args: [BigInt(prevRound)],
        }).then(rd => {
          const players = Number(rd[3]);
          const cell = Number(rd[4]);
          const pot = rd[2].toString();
          const isResolved = rd[5];
          if (players > 0) {
            const result = { roundId: prevRound, cell, players, pot, resolved: isResolved, txHash: resolverTxHash.current || null };
            setLastResult(result);
            setRoundHistory(prev => prev.some(r => r.roundId === prevRound) ? prev : [result, ...prev]);
            if (isResolved && players > 0) {
              addFeed(`★ Round ${prevRound} winner: Cell ${CELL_LABELS[cell] || cell}`);
              setMoneyFlow(true);
              setTimeout(() => setMoneyFlow(false), 2500);
            }
            setHistoryPage(0);
          }
          resolverTxHash.current = null;
        }).catch(() => {});
      }
      setGridFlash(true);
      setTimeout(() => setGridFlash(false), 600);
      addFeed(`◆ Round ${round} started`);
      lastRoundRef.current = round;
      setSelectedCell(null);
      setPlayerCell(-1);
      setClaimedCells(new Set());
      setCellCounts(new Array(TOTAL_CELLS).fill(0));
      setWinningCell(-1);
      setResolved(false);
      resolvedRef.current = false;
    }
  }, [round]);

  // ─── Winner detected ───
  useEffect(() => {
    if (resolved && winningCell >= 0 && round > 0) {
      const result = { roundId: round, cell: winningCell, players: activePlayers, pot: potSize, resolved: true, txHash: resolverTxHash.current || null };
      setLastResult(result);
      setMoneyFlow(true);
      setTimeout(() => setMoneyFlow(false), 2500);
      setRoundHistory(prev => {
        const idx = prev.findIndex(r => r.roundId === round);
        if (idx >= 0) { const updated = [...prev]; updated[idx] = result; return updated; }
        return [result, ...prev];
      });
      setHistoryPage(0);
    }
  }, [resolved, winningCell]);

  // ─── One-Time USDC Approval (via wagmi sendTransaction) ───
  const approveUsdc = async () => {
    if (!address || approving) return;
    setApproving(true);
    setError(null);
    try {
      addFeed("Approving USDC (one-time)...");
      const approveData = encodeFunctionData({
        abi: USDC_ABI, functionName: "approve",
        args: [GRID_ADDR, parseUnits("1000000", 6)],
      });
      const hash = await sendTransactionAsync({ to: USDC_ADDR, data: approveData });
      await publicClient.waitForTransactionReceipt({ hash });
      setUsdcApproved(true);
      addFeed("USDC approved ✓ — double-tap any cell to play!");
    } catch (e) {
      const msg = e.shortMessage || e.message || "Approval failed";
      setError(msg);
      addFeed(`✗ Approval failed: ${msg.slice(0, 80)}`);
    }
    setApproving(false);
  };

  // ─── Pick Cell (via wagmi sendTransaction) ───
  const claimCell = async (cellIndex) => {
    if (!address || claiming) return;
    // Double-check timer hasn't expired while user was tapping
    const remaining = roundEnd > 0 ? Math.max(0, roundEnd - Date.now() / 1000) : 0;
    if (remaining <= PICK_BUFFER) {
      setError("Round closing — too late to pick. Wait for next round!");
      return;
    }
    setClaiming(true);
    setError(null);
    try {
      const data = encodeFunctionData({
        abi: GRID_ABI, functionName: "pickCell", args: [cellIndex],
      });
      addFeed(`◈ Claiming cell ${CELL_LABELS[cellIndex]}...`);
      const hash = await sendTransactionAsync({ to: GRID_ADDR, data });
      await publicClient.waitForTransactionReceipt({ hash });
      addFeed(`✓ Cell ${CELL_LABELS[cellIndex]} claimed!`);
      setPlayerCell(cellIndex);
      setSelectedCell(null);
      pollState();
    } catch (e) {
      const msg = e.shortMessage || e.message || "Transaction failed";
      setError(msg);
      addFeed(`✗ Failed: ${msg.slice(0, 80)}`);
    }
    setClaiming(false);
  };

  const addFeed = (msg) => {
    setFeed((prev) => [{ msg, time: Date.now() }, ...prev].slice(0, 20));
  };

  // ─── Share win on Farcaster ───
  const shareWin = () => {
    try {
      sdk.actions.composeCast({
        text: `🏆 Won on GridZero! Cell ${CELL_LABELS[winningCell]} | Round #${round} | Pot $${fmt(potSize)}\n\nPick a cell. Beat the grid. Win USDC. ⚡`,
        embeds: [process.env.NEXT_PUBLIC_URL || "https://gridzero-miniapp.vercel.app"],
      });
    } catch {}
  };

  // ─── Derived UI State ───
  const actualDuration = (roundEnd > 0 && roundStart > 0) ? (roundEnd - roundStart) : ROUND_DURATION;
  const timerProgress = actualDuration > 0 ? smoothTime / actualDuration : 0;
  const timerColor = smoothTime > 10 ? "#3B7BF6" : smoothTime > 5 ? "#4D8EFF" : "#ff3355";

  const getStatus = () => {
    if (resolved) return `ROUND ${round} RESOLVED`;
    if (smoothTime <= 0 && round > 0) return `RESOLVING ROUND ${round}...`;
    if (smoothTime <= 0) return "WAITING...";
    if (smoothTime <= PICK_BUFFER && isConnected) return `ROUND ${round} — LOCKING...`;
    if (!isConnected) return `ROUND ${round} — CONNECT TO PLAY`;
    return `ROUND ${round} ACTIVE`;
  };

  const getCellState = (idx) => {
    if (resolved && winningCell === idx) return "winner";
    if (playerCell === idx) return "yours";
    if (claimedCells.has(idx)) return "claimed";
    return "empty";
  };

  const canClaim = (idx) => {
    return !resolved && smoothTime > PICK_BUFFER && isConnected && playerCell < 0 && usdcApproved;
  };

  const isWinner = resolved && playerCell >= 0 && playerCell === winningCell;

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={S.root}>
      {/* Scan line */}
      <div style={{
        ...S.scanOverlay,
        background: `linear-gradient(180deg,
          transparent ${scanLine - 2}%,
          rgba(22,82,240,0.12) ${scanLine - 1}%,
          rgba(22,82,240,0.35) ${scanLine}%,
          rgba(22,82,240,0.12) ${scanLine + 1}%,
          transparent ${scanLine + 2}%)`,
      }} />
      <div style={S.crtLines} />

      {/* ─── HEADER ─── */}
      <header style={S.header}>
        <div style={S.hLeft}>
          <LogoIcon size={28} />
          <span style={S.logo}>GRID</span>
          <span style={S.logoSub}>ZERO</span>
          <span style={S.badge}>BASE</span>
        </div>
        <div style={S.hRight}>
          <span style={S.hStat}>{fmtEth(gridBalance, 2)} <b style={{ color: "#1652F0" }}>ZERO</b></span>
          <span style={S.hStat}>{fmt(ethBalance, 2)} <b style={{ color: "#3B7BF6" }}>USDC</b></span>
          <button
            onClick={() => disconnect()}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid rgba(22,82,240,0.3)",
              background: "rgba(22,82,240,0.08)",
              color: "#7a8b9e",
              cursor: "pointer",
              letterSpacing: 0.5,
            }}
            title="Disconnect"
          >
            {address?.slice(0, 6)}…{address?.slice(-4)} ✕
          </button>
        </div>
      </header>

      {/* ─── GAME AREA (single column for mini app) ─── */}
      <div style={S.gameArea}>
        {/* Timer */}
        <div style={S.timerWrap}>
          <div style={S.timerBarBg}>
            <div style={{
              ...S.timerBarFill,
              width: `${timerProgress * 100}%`,
              backgroundColor: timerColor,
              boxShadow: `0 0 20px ${timerColor}66`,
            }} />
          </div>
          <div style={{ minWidth: 70, textAlign: "right" }}>
            <span style={{ ...S.timerNum, color: timerColor }}>
              {Math.floor(smoothTime)}<span style={S.timerMs}>.{Math.floor((smoothTime % 1) * 10)}</span>s
            </span>
          </div>
        </div>

        {/* Grid */}
        <div style={S.gridOuter}>
          <div style={S.cornerTL} /><div style={S.cornerTR} />
          <div style={S.cornerBL} /><div style={S.cornerBR} />

          {gridFlash && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              borderRadius: 8, zIndex: 15, pointerEvents: "none",
              animation: "gridResetFlash 0.6s ease-out forwards",
            }} />
          )}

          <div style={S.grid}>
            {CELL_LABELS.map((label, idx) => {
              const state = getCellState(idx);
              const zone = getCellZone(idx);
              const isSelected = selectedCell === idx;
              const isWinnerCell = resolved && winningCell === idx;
              const zoneStyle = zone === "dark" ? S.cellDark : zone === "opening" ? S.cellOpening : S.cellLight;
              const hoverZone = zone === "dark" ? S.cellDarkHover : zone === "opening" ? S.cellOpeningHover : S.cellLightHover;
              return (
                <button
                  key={idx}
                  style={{
                    ...S.cell,
                    ...zoneStyle,
                    ...(state === "winner" ? S.cellWinner : {}),
                    ...(state === "yours" ? S.cellYours : {}),
                    ...(state === "claimed" ? S.cellClaimed : {}),
                    ...(isSelected ? S.cellSelected : {}),
                    ...(hoveredCell === idx && state === "empty" ? {
                      ...hoverZone, transform: "translateY(-3px) scale(1.03)",
                    } : {}),
                    transition: "all 0.15s ease",
                    animationDelay: isWinnerCell ? "0s" : `${Math.floor(idx / GRID_SIZE) * 0.08}s`,
                  }}
                  onMouseEnter={() => setHoveredCell(idx)}
                  onMouseLeave={() => setHoveredCell(-1)}
                  onClick={() => {
                    if (!canClaim(idx)) return;
                    const now = Date.now();
                    const last = lastTapRef.current;
                    if (last.cell === idx && now - last.time < 400 && !claiming) {
                      claimCell(idx);
                      lastTapRef.current = { cell: -1, time: 0 };
                    } else {
                      setSelectedCell(idx);
                      lastTapRef.current = { cell: idx, time: now };
                    }
                  }}
                  onDoubleClick={() => { if (canClaim(idx) && !claiming) claimCell(idx); }}
                >
                  <span style={S.cellLabel}>{label}</span>
                  {state === "winner" && <span style={{ ...S.cellIcon, animation: "winnerPop 0.6s ease-out" }}>★</span>}
                  {state === "yours" && <span style={S.cellIcon}>◈</span>}
                  {state === "claimed" && state !== "yours" && <span style={S.cellIcon}>{cellCounts[idx] > 1 ? `${cellCounts[idx]}×` : "◈"}</span>}
                  {state === "empty" && <span style={{ fontSize: 14, opacity: 0.25 }}>◇</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status + dots */}
        <div style={S.statusBar}>
          <span style={{ fontWeight: 600 }}>{getStatus()}</span>
          <span style={{ color: "#7a8b9e" }}>{activePlayers} PLAYERS</span>
        </div>
        <div style={S.dots}>
          {Array.from({ length: TOTAL_CELLS }).map((_, i) => (
            <div key={i} style={{ ...S.progressDot, backgroundColor: i < activePlayers ? "#1652F0" : "rgba(22,82,240,0.1)" }} />
          ))}
        </div>

        {/* Sector Analysis */}
        <Panel title="SECTOR ANALYSIS" live>
          <Row label="POT SIZE" value={`${fmt(potSize)} USDC`} />
          <Row label="ACTIVE PLAYERS" value={activePlayers} />
          <Row label="ZERO/ROUND" value="10 ZERO" />
          <Row label="CELL COST" value={`${CELL_COST} USDC`} />
        </Panel>

        {/* Unit Status */}
        {isConnected && (
          <Panel title="UNIT STATUS">
            <Row label="YOUR CELL" value={playerCell >= 0 ? CELL_LABELS[playerCell] : "—"} hl />
            <Row label="ZERO BAL" value={fmtEth(gridBalance, 2)} />
            <Row label="USDC BAL" value={fmt(ethBalance)} />
          </Panel>
        )}

        {/* Approve USDC */}
        {isConnected && allowanceChecked && !usdcApproved && !approving && (
          <button style={S.claimBtn} onClick={approveUsdc}>
            🔓 APPROVE USDC TO PLAY (ONE-TIME)
          </button>
        )}
        {approving && (
          <div style={S.claimingBar}><div style={S.claimingDot} />APPROVING USDC...</div>
        )}

        {/* Instruction */}
        {isConnected && usdcApproved && playerCell < 0 && !resolved && smoothTime > PICK_BUFFER && (
          <div style={S.instruction}>◆ TAP TO SELECT · DOUBLE-TAP TO CLAIM ◆</div>
        )}
        {isConnected && usdcApproved && playerCell < 0 && !resolved && smoothTime > 0 && smoothTime <= PICK_BUFFER && (
          <div style={{ ...S.instruction, color: "#ff3355" }}>⏱ ROUND CLOSING — PICKS LOCKED</div>
        )}

        {/* Claim button */}
        {selectedCell !== null && !claiming && isConnected && usdcApproved && smoothTime > PICK_BUFFER && (
          <button style={S.claimBtn} onClick={() => claimCell(selectedCell)}>
            ⬡ LOCK CELL {CELL_LABELS[selectedCell]} — {CELL_COST} USDC
          </button>
        )}
        {claiming && (
          <div style={S.claimingBar}><div style={S.claimingDot} />CONFIRMING TX...</div>
        )}

        {/* Winner banner + Farcaster share */}
        {resolved && isWinner && (
          <div style={S.winBanner}>
            <div style={{ fontSize: 28 }}>🏆</div>
            <div style={S.winTitle}>YOU WON!</div>
            <div style={S.winSub}>Cell {CELL_LABELS[winningCell]} · Pot ${fmt(potSize)} · Round #{round}</div>
            <button style={{ ...S.claimBtn, marginTop: 10, background: "linear-gradient(135deg, #7C3AED, #3B7BF6)" }} onClick={shareWin}>
              📣 SHARE WIN ON FARCASTER
            </button>
          </div>
        )}
        {resolved && playerCell >= 0 && !isWinner && (
          <div style={S.loseBanner}>
            <span style={{ fontSize: 20 }}>😤</span>
            <div style={S.loseTitle}>NOT THIS TIME</div>
            <div style={{ fontSize: 12, color: "#6a7b8e", marginTop: 4 }}>
              Winner: <b style={{ color: "#FFD700" }}>{CELL_LABELS[winningCell]}</b> · Your pick: <b style={{ color: "#3B7BF6" }}>{CELL_LABELS[playerCell]}</b>
            </div>
          </div>
        )}

        {/* Error */}
        {error && <div style={S.errorBox} onClick={() => setError(null)}>⚠ {error.slice(0, 120)}</div>}

        {/* ─── User History ─── */}
        {isConnected && userHistory.length > 0 && (
          <div style={S.panel}>
            <div style={S.panelHead}>
              <span>YOUR HISTORY</span>
              <span style={{ fontSize: 10, color: "#5a6a7e", letterSpacing: 1 }}>
                {userHistoryLoading ? "SCANNING..." : `${userHistory.length} ROUNDS`}
              </span>
            </div>
            <div style={{ padding: "0 14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "40px 60px 32px 1fr", padding: "8px 0 4px", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={S.colHead}>RESULT</span>
                <span style={S.colHead}>ROUND</span>
                <span style={S.colHead}>CELL</span>
                <span style={{ ...S.colHead, textAlign: "right" }}>P&L</span>
              </div>
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {userHistory.map((h, i) => {
                  const isWin = h.won;
                  const potRaw = Number(h.pot || 0);
                  const { feeBps, resolverReward } = feeConfig.current;
                  const distributable = Math.max(potRaw - Math.floor(potRaw * feeBps / 10000) - resolverReward, 0);
                  const perWinner = distributable / (h.numWinners || 1);
                  const displayAmt = isWin ? (perWinner / 1e6) : 1;
                  return (
                    <div key={h.roundId} style={{ display: "grid", gridTemplateColumns: "40px 60px 32px 1fr", padding: "7px 0", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, padding: "2px 0", borderRadius: 3, textAlign: "center", background: isWin ? "rgba(0,204,136,0.12)" : "rgba(255,51,85,0.1)", color: isWin ? "#00cc88" : "#ff3355" }}>
                        {isWin ? "WON" : "LOST"}
                      </span>
                      <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, color: "#d0dce8" }}>#{h.roundId}</span>
                      <span style={{ fontSize: 11, color: "#8a9bae" }}>{CELL_LABELS[h.cell] || "?"}</span>
                      <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, color: isWin ? "#00cc88" : "#ff3355", textAlign: "right" }}>
                        {isWin ? "+" : "-"}{displayAmt.toFixed(2)} USDC
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── Round History ─── */}
        {(() => {
          const totalPages = Math.ceil(roundHistory.length / HISTORY_PAGE_SIZE) || 1;
          const pageStart = historyPage * HISTORY_PAGE_SIZE;
          const pageRows = roundHistory.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
          const hasOlder = roundHistory.length > 0 && (historyPage < totalPages - 1 || !historyFullyLoaded);
          const hasNewer = historyPage > 0;
          return (
            <div style={S.panel}>
              <div style={S.panelHead}>
                <span>ROUND HISTORY</span>
                <span style={{ fontSize: 10, color: "#5a6a7e", letterSpacing: 1 }}>
                  {historyLoading ? "SCANNING..." : `${roundHistory.length} ROUNDS${historyFullyLoaded ? "" : "+"}`}
                </span>
              </div>
              <div style={{ padding: "0 14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "55px 50px 45px 65px 1fr", padding: "8px 0 4px", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={S.colHead}>ROUND</span>
                  <span style={S.colHead}>WINNER</span>
                  <span style={S.colHead}>PLRS</span>
                  <span style={S.colHead}>POT</span>
                  <span style={{ ...S.colHead, textAlign: "right" }}>TX</span>
                </div>
                {pageRows.length === 0 && (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#5a6a7e", fontSize: 11 }}>
                    {historyLoading ? "⟐ SCANNING..." : "NO ROUNDS FOUND"}
                  </div>
                )}
                {pageRows.map((r, i) => {
                  const globalIdx = pageStart + i;
                  const isLatest = globalIdx === 0 && moneyFlow;
                  return (
                    <div key={r.roundId} style={{ display: "grid", gridTemplateColumns: "55px 50px 45px 65px 1fr", padding: "6px 0", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.03)", background: isLatest ? "rgba(255,200,0,0.06)" : "transparent" }}>
                      <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, color: isLatest ? "#ffc800" : "#d0dce8" }}>#{r.roundId}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: r.resolved === false ? "#ff6666" : "#ffc800" }}>
                        {r.resolved === false ? "⏳" : (CELL_LABELS[r.cell] || "?")} {globalIdx === 0 && r.resolved !== false ? "★" : ""}
                      </span>
                      <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, color: "#c8d6e5" }}>{r.players}</span>
                      <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, color: isLatest ? "#ffc800" : "#3B7BF6" }}>{fmt(r.pot)}</span>
                      <span style={{ textAlign: "right" }}>
                        {r.txHash ? (
                          <a href={`${EXPLORER}/tx/${r.txHash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#3B7BF6", textDecoration: "none" }}>
                            {r.txHash.slice(0, 6)}…↗
                          </a>
                        ) : (
                          <a href={`${EXPLORER}/address/${GRID_ADDR}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#5a6a7e", textDecoration: "none" }}>↗</a>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid rgba(22,82,240,0.1)" }}>
                <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={!hasNewer} style={{ ...S.pageBtn, opacity: hasNewer ? 1 : 0.3 }}>◀ NEWER</button>
                <span style={{ fontSize: 10, color: "#5a6a7e" }}>{pageStart + 1}–{Math.min(pageStart + HISTORY_PAGE_SIZE, roundHistory.length)}</span>
                <button onClick={() => { if (pageStart + HISTORY_PAGE_SIZE >= roundHistory.length - HISTORY_PAGE_SIZE && !historyFullyLoaded) loadOlderHistory(); setHistoryPage(historyPage + 1); }} disabled={!hasOlder} style={{ ...S.pageBtn, opacity: hasOlder ? 1 : 0.3 }}>OLDER ▶</button>
              </div>
            </div>
          );
        })()}

        {/* Feed */}
        <Panel title="EXTRACTION FEED">
          <div style={{ maxHeight: 140, overflowY: "auto" }}>
            {feed.length === 0 ? (
              <div style={{ color: "#3a4a5e", fontSize: 12, fontStyle: "italic", padding: "8px 0" }}>Waiting for activity...</div>
            ) : feed.map((f, i) => (
              <div key={f.time + "-" + i} style={{ fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", display: "flex", gap: 8, opacity: 1 - i * 0.06 }}>
                <span style={{ color: "#3a4a5e", fontSize: 10, flexShrink: 0 }}>
                  {new Date(f.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span>{f.msg}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* ─── FOOTER ─── */}
      <footer style={S.footer}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={S.greenDot} />
          <span style={S.gridOnline}>GRID ONLINE</span>
        </span>
        <span style={{ fontSize: 11, color: "#4a5a6e", letterSpacing: 1 }}>BASE · VRF · {sseConnected ? "LIVE" : "POLLING"}</span>
      </footer>

      {/* ─── CSS ─── */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap');
        @keyframes cellAppear { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 8px rgba(22,82,240,0.3), inset 0 0 8px rgba(22,82,240,0.1); }
          50% { box-shadow: 0 0 20px rgba(22,82,240,0.6), inset 0 0 15px rgba(22,82,240,0.2); }
        }
        @keyframes winnerGlow {
          0%, 100% { box-shadow: 0 0 10px rgba(255,200,0,0.4), inset 0 0 10px rgba(255,200,0,0.1); }
          50% { box-shadow: 0 0 30px rgba(255,200,0,0.8), inset 0 0 20px rgba(255,200,0,0.3); }
        }
        @keyframes slideIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes winnerPop { 0% { transform: scale(0.3); opacity: 0; } 50% { transform: scale(1.3); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes gridResetFlash { 0% { background: rgba(22,82,240,0.25); } 100% { background: transparent; } }
        @keyframes winnerBannerIn { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes scanGlow {
          0% { text-shadow: 0 0 4px #3B7BF6; }
          50% { text-shadow: 0 0 12px #3B7BF6, 0 0 24px #3B7BF644; }
          100% { text-shadow: 0 0 4px #3B7BF6; }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function LogoIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>
      <defs>
        <linearGradient id={`lg${size}`} x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B7BF6" />
          <stop offset="100%" stopColor="#1652F0" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="72" height="72" rx="16" fill={`url(#lg${size})`} />
      <line x1="30" y1="4" x2="30" y2="76" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
      <line x1="50" y1="4" x2="50" y2="76" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
      <line x1="4" y1="30" x2="76" y2="30" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
      <line x1="4" y1="50" x2="76" y2="50" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
      <text x="40" y="56" textAnchor="middle" fontFamily="'Orbitron', sans-serif" fontWeight="900" fontSize="48" fill="white" letterSpacing="-2">0</text>
    </svg>
  );
}

function Panel({ title, live, children }) {
  return (
    <div style={S.panel}>
      <div style={S.panelHead}>
        <span>{title}</span>
        {live && <span style={S.liveTag}>● LIVE</span>}
      </div>
      <div style={{ padding: "8px 14px" }}>{children}</div>
    </div>
  );
}

function Row({ label, value, hl }) {
  return (
    <div style={S.row}>
      <span style={S.rowLabel}>{label}</span>
      <span style={{ ...S.rowValue, ...(hl ? { color: "#3B7BF6" } : {}) }}>{String(value)}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const S = {
  root: {
    fontFamily: "'JetBrains Mono', monospace",
    background: "radial-gradient(ellipse at 30% 20%, #0D1A30 0%, #080E1C 50%, #060A14 100%)",
    color: "#c8d6e5", minHeight: "100vh", minHeight: "100dvh",
    display: "flex", flexDirection: "column",
    position: "relative",
  },
  scanOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: "none", zIndex: 2, transition: "background 0.04s linear",
  },
  crtLines: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: "none", zIndex: 1,
    background: "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 12px", borderBottom: "1px solid rgba(22,82,240,0.12)",
    background: "rgba(8,12,22,0.95)", zIndex: 10, position: "relative",
    flexWrap: "wrap", gap: 6,
  },
  hLeft: { display: "flex", alignItems: "center", gap: 6 },
  hRight: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  logo: { fontFamily: "'Orbitron', sans-serif", fontWeight: 900, fontSize: 16, color: "#3B7BF6", letterSpacing: 3 },
  logoSub: { fontFamily: "'Orbitron', sans-serif", fontWeight: 500, fontSize: 16, color: "#e0e8f0", letterSpacing: 2 },
  badge: { fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(22,82,240,0.12)", color: "#3B7BF6", letterSpacing: 1.5, fontWeight: 600 },
  hStat: { fontSize: 11, color: "#7a8b9e", letterSpacing: 0.5 },
  loginBtn: {
    fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700,
    padding: "8px 16px", borderRadius: 6,
    border: "1px solid #1652F0",
    background: "linear-gradient(135deg, rgba(22,82,240,0.2), rgba(22,82,240,0.05))",
    color: "#3B7BF6", cursor: "pointer", letterSpacing: 1.5,
  },
  gameArea: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "flex-start", padding: "12px 12px", gap: 10,
    overflowY: "auto", WebkitOverflowScrolling: "touch",
    position: "relative", zIndex: 5,
  },
  timerWrap: { width: "100%", maxWidth: 420, display: "flex", alignItems: "center", gap: 10 },
  timerBarBg: { flex: 1, height: 10, borderRadius: 5, background: "rgba(255,255,255,0.08)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" },
  timerBarFill: { height: "100%", borderRadius: 5 },
  timerNum: { fontFamily: "'Orbitron', sans-serif", fontSize: 18, fontWeight: 700, transition: "color 0.5s ease" },
  timerMs: { fontSize: 13, opacity: 0.7 },
  gridOuter: { position: "relative", width: "100%", maxWidth: 420, padding: 10 },
  cornerTL: { position: "absolute", top: 0, left: 0, width: 16, height: 16, borderLeft: "2px solid rgba(22,82,240,0.4)", borderTop: "2px solid rgba(22,82,240,0.4)" },
  cornerTR: { position: "absolute", top: 0, right: 0, width: 16, height: 16, borderRight: "2px solid rgba(22,82,240,0.4)", borderTop: "2px solid rgba(22,82,240,0.4)" },
  cornerBL: { position: "absolute", bottom: 0, left: 0, width: 16, height: 16, borderLeft: "2px solid rgba(22,82,240,0.4)", borderBottom: "2px solid rgba(22,82,240,0.4)" },
  cornerBR: { position: "absolute", bottom: 0, right: 0, width: 16, height: 16, borderRight: "2px solid rgba(22,82,240,0.4)", borderBottom: "2px solid rgba(22,82,240,0.4)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5, width: "100%" },
  cell: {
    fontFamily: "'JetBrains Mono', monospace", position: "relative",
    aspectRatio: "1", minHeight: 56,
    borderRadius: 8, cursor: "pointer",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 2,
    fontSize: 11, fontWeight: 600, transition: "all 0.15s ease",
    animation: "cellAppear 0.4s ease both",
    touchAction: "manipulation", border: "none",
  },
  cellDark: {
    background: "linear-gradient(145deg, #0E2260 0%, #0A1A4A 60%, #081340 100%)",
    border: "1px solid rgba(22,82,240,0.25)",
    color: "rgba(140,170,220,0.45)",
    boxShadow: "inset 0 1px 3px rgba(0,0,0,0.4), 0 0 4px rgba(22,82,240,0.06)",
  },
  cellLight: {
    background: "linear-gradient(145deg, rgba(210,225,255,0.14) 0%, rgba(190,210,250,0.09) 60%, rgba(170,195,240,0.06) 100%)",
    border: "1px solid rgba(200,220,255,0.2)",
    color: "rgba(210,225,250,0.7)",
    boxShadow: "inset 0 1px 5px rgba(255,255,255,0.04), 0 0 6px rgba(200,220,255,0.04)",
  },
  cellOpening: {
    background: "linear-gradient(145deg, rgba(230,240,255,0.18) 0%, rgba(215,230,255,0.13) 60%, rgba(200,218,250,0.09) 100%)",
    border: "1px solid rgba(220,235,255,0.24)",
    color: "rgba(225,238,255,0.8)",
    boxShadow: "inset 0 1px 6px rgba(255,255,255,0.06), 0 0 8px rgba(220,235,255,0.06)",
  },
  cellDarkHover: {
    background: "linear-gradient(145deg, #122A70 0%, #0D2058 60%, #0A1848 100%)",
    borderColor: "rgba(22,82,240,0.5)",
    color: "rgba(200,215,250,0.8)",
    boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3), 0 0 16px rgba(22,82,240,0.2)",
  },
  cellLightHover: {
    background: "linear-gradient(145deg, rgba(225,238,255,0.22) 0%, rgba(205,222,255,0.16) 60%, rgba(185,208,250,0.12) 100%)",
    borderColor: "rgba(225,240,255,0.38)",
    color: "rgba(240,245,255,0.95)",
    boxShadow: "inset 0 1px 5px rgba(255,255,255,0.08), 0 0 18px rgba(200,220,255,0.1)",
  },
  cellOpeningHover: {
    background: "linear-gradient(145deg, rgba(240,248,255,0.28) 0%, rgba(228,240,255,0.2) 60%, rgba(215,232,255,0.16) 100%)",
    borderColor: "rgba(240,248,255,0.42)",
    color: "white",
    boxShadow: "inset 0 1px 6px rgba(255,255,255,0.12), 0 0 22px rgba(220,235,255,0.14)",
  },
  cellClaimed: { borderColor: "rgba(22,82,240,0.5)", color: "#3B7BF6" },
  cellYours: { borderColor: "rgba(22,82,240,0.65)", color: "#4D8EFF", animation: "glow 2s ease-in-out infinite" },
  cellWinner: { background: "rgba(255,215,0,0.12)", borderColor: "rgba(255,215,0,0.55)", color: "#FFD700", boxShadow: "0 0 20px rgba(255,215,0,0.4), inset 0 0 12px rgba(255,215,0,0.15)", animation: "winnerGlow 1.5s ease-in-out infinite" },
  cellSelected: { background: "rgba(22,82,240,0.22)", borderColor: "#1652F0", color: "#fff", boxShadow: "0 0 24px rgba(22,82,240,0.4)" },
  cellLabel: { letterSpacing: 1 },
  cellIcon: { fontSize: 16 },
  statusBar: { display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 420, padding: "6px 10px", fontSize: 11, letterSpacing: 1.5, color: "#5a6a7e" },
  dots: { display: "flex", gap: 2, width: "100%", maxWidth: 420, padding: "0 10px" },
  progressDot: { flex: 1, height: 3, borderRadius: 2, transition: "background-color 0.5s ease" },
  panel: { width: "100%", maxWidth: 420, border: "1px solid rgba(22,82,240,0.1)", borderRadius: 8, background: "rgba(22,82,240,0.02)", overflow: "hidden" },
  panelHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#8a9bae", borderBottom: "1px solid rgba(22,82,240,0.06)" },
  liveTag: { color: "#3B7BF6", fontSize: 10, letterSpacing: 1, animation: "scanGlow 2s ease-in-out infinite" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 12 },
  rowLabel: { color: "#6a7b8e", letterSpacing: 0.5 },
  rowValue: { fontWeight: 600, color: "#d0dce8", fontFamily: "'Orbitron', sans-serif", fontSize: 13 },
  colHead: { fontSize: 9, color: "#4a5a6e", letterSpacing: 1.5, fontWeight: 700 },
  claimBtn: {
    fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700,
    padding: "14px 20px", borderRadius: 8, border: "none",
    background: "linear-gradient(135deg, #1652F0, #3B7BF6)",
    color: "#fff", cursor: "pointer", letterSpacing: 1,
    textAlign: "center", width: "100%", maxWidth: 420,
    boxShadow: "0 4px 20px rgba(22,82,240,0.3)",
  },
  claimingBar: { display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderRadius: 8, border: "1px solid rgba(22,82,240,0.3)", background: "rgba(22,82,240,0.08)", color: "#4D8EFF", fontSize: 12, fontWeight: 600, letterSpacing: 1, width: "100%", maxWidth: 420 },
  claimingDot: { width: 8, height: 8, borderRadius: "50%", background: "#4D8EFF", animation: "pulse 1s ease-in-out infinite" },
  instruction: { width: "100%", maxWidth: 420, textAlign: "center", padding: "4px 0", fontSize: 10, letterSpacing: 1.5, color: "#4a5a6e" },
  errorBox: { padding: "10px 14px", borderRadius: 6, border: "1px solid rgba(255,51,85,0.3)", background: "rgba(255,51,85,0.08)", color: "#ff3355", fontSize: 11, cursor: "pointer", width: "100%", maxWidth: 420 },
  winBanner: { width: "100%", maxWidth: 420, textAlign: "center", padding: "16px", borderRadius: 10, border: "1px solid rgba(255,215,0,0.3)", background: "rgba(255,215,0,0.06)", animation: "winnerBannerIn 0.5s ease-out" },
  winTitle: { fontFamily: "'Orbitron', sans-serif", fontSize: 22, fontWeight: 800, color: "#FFD700", letterSpacing: 2 },
  winSub: { fontSize: 12, color: "#8a9bae", marginTop: 4 },
  loseBanner: { width: "100%", maxWidth: 420, textAlign: "center", padding: "14px", borderRadius: 10, border: "1px solid rgba(255,51,85,0.2)", background: "rgba(255,51,85,0.04)" },
  loseTitle: { fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700, color: "#ff3355", letterSpacing: 2 },
  pageBtn: { background: "rgba(22,82,240,0.12)", border: "1px solid rgba(22,82,240,0.3)", color: "#3B7BF6", padding: "4px 12px", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" },
  footer: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 16px", borderTop: "1px solid rgba(22,82,240,0.08)",
    background: "rgba(8,12,22,0.95)", zIndex: 10, position: "relative",
  },
  greenDot: { display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#3B7BF6", boxShadow: "0 0 6px #3B7BF688" },
  gridOnline: { fontSize: 12, fontWeight: 700, color: "#3B7BF6", letterSpacing: 1.5, animation: "scanGlow 3s ease-in-out infinite" },
};

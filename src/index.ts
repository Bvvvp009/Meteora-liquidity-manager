import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { StrategyType } from "@meteora-ag/dlmm";
import { TradingManager } from "./tradingManager";
import { loadKeypair } from "./utils/keypair";
import 'dotenv/config';

// Load configuration from environment variables
const RPC = process.env.RPC || clusterApiUrl("mainnet-beta");
const connection = new Connection(RPC, "confirmed");

// Load user wallet
const user_wallet = loadKeypair();

// Initialize the trading manager
console.log("Initializing MeteoraBOT with wallet:", user_wallet.publicKey.toString());
const manager = new TradingManager(connection, user_wallet);

// Add trading pairs
manager.addPairConfig("SOL-USDC", {
  poolAddress: new PublicKey("BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh"),
  minReserveX: 2,                    // Min reserve SOL to keep in wallet
  minReserveY: 200,                  // Min reserve USDC to keep in wallet
  binStep: 10,                       // Bin step from pool config
  TOTAL_RANGE_INTERVAL: 6,           // Total liquidity distributed in bins
  maxPositionSizeInY: 10,            // Max position size in USDC (not in $)
  strategyType: StrategyType.BidAskImBalanced,  // Strategy type
  balanceOutPosition: true           // Rebalance when position becomes imbalanced
});

// Start the trading bot
console.log("Starting MeteoraBOT...");
manager.start().catch((err: any) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
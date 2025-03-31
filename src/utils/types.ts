import { PublicKey } from "@solana/web3.js";
import { StrategyType } from "@meteora-ag/dlmm";

/**
 * Configuration for a trading pair
 */
export interface PairConfig {
  /** Pool address on Meteora */
  poolAddress: PublicKey;
  
  /** Minimum X token reserve to keep in wallet */
  minReserveX: number;
  
  /** Minimum Y token reserve to keep in wallet */
  minReserveY: number;
  
  /** Bin step from pool configuration */
  binStep: number;
  
  /** Maximum position size in Y token amount */
  maxPositionSizeInY: number;
  
  /** Total range interval for liquidity distribution */
  TOTAL_RANGE_INTERVAL: number;
  
  /** Strategy type for liquidity distribution */
  strategyType: StrategyType;
  
  /** Whether to balance out positions when they become imbalanced */
  balanceOutPosition: boolean;
}

/**
 * Position state tracking
 */
export interface PositionState {
  /** Current state of the position */
  state: 'oneSided' | 'balanced' | 'waiting';
  
  /** Initial token type for one-sided positions */
  initialTokenType?: 'X' | 'Y';
}
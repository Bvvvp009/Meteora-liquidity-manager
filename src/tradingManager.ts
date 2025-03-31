import {
    Connection,
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    ComputeBudgetProgram,
    Transaction
  } from "@solana/web3.js";
  import DLMM from "@meteora-ag/dlmm";
  import { LbPosition, StrategyType } from "@meteora-ag/dlmm";
  import { DLMMUtils } from "./balances";
  import BN from "bn.js";
  import { simulateTransaction } from "@coral-xyz/anchor/dist/cjs/utils/rpc";
  import { PairConfig, PositionState } from "./utils/types";
  import 'dotenv/config';
  
  export class TradingManager {
    private connection: Connection;
    private user: Keypair;
    private pairConfigs: Map<string, PairConfig>;
    private newpositionAddress: Keypair = new Keypair();
    private balances: DLMMUtils;
    private positionStates: Map<string, PositionState> = new Map();
  
    constructor(connection: Connection, user: Keypair) {
      this.connection = connection;
      this.user = user;
      this.pairConfigs = new Map();
      this.balances = new DLMMUtils(connection);
    }
  
    /**
     * Add a trading pair configuration
     * @param name Name identifier for the pair
     * @param config Configuration parameters
     */
    addPairConfig(name: string, config: PairConfig) {
      this.pairConfigs.set(name, config);
    }
  
    /**
     * Start the trading bot
     */
    async start() {
      console.log(`Starting trading loop with ${this.pairConfigs.size} pair(s)`);
      console.log(`Check interval: ${process.env.CHECK_INTERVEL || 5} minutes`);
      
      while (true) {
        try {
          await Promise.all(
            Array.from(this.pairConfigs.entries()).map(async ([name, config]) => {
              console.log(`Monitoring pair: ${name}`);
              return this.monitorPair(name, config);
            })
          );
        } catch (error) {
          console.error("Trading cycle error:", error);
        }
        
        // Wait for the next check interval
        const checkInterval = Number(process.env.CHECK_INTERVEL) * 60 * 1000 || 5 * 60 * 1000;
        console.log(`Waiting ${checkInterval / 60000} minutes until next check...`);
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
    }
  
    /**
     * Add priority fee to a transaction
     * @param connection Solana connection
     * @param originalTx Original transaction
     * @param microLamports Priority fee in micro-lamports
     * @returns Transaction with priority fee
     */
    async addPriorityFeeToTransaction(
      connection: Connection, 
      originalTx: Transaction, 
      microLamports: number = Number(process.env.PRIORITY_FEE) || 20000
    ): Promise<Transaction> {
      // Create a new transaction
      const priorityFeeTx = new Transaction();
      
      priorityFeeTx.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
      );
  
      // Add all instructions from the original transaction
      originalTx.instructions.forEach(instruction => {
        priorityFeeTx.add(instruction);
      });
  
      // Set recent blockhash and fee payer
      const { blockhash } = await connection.getLatestBlockhash();
      priorityFeeTx.recentBlockhash = blockhash;
      priorityFeeTx.feePayer = this.user.publicKey;
  
      return priorityFeeTx;
    }
  
    /**
     * Monitor a trading pair
     * @param pairName Name of the pair
     * @param config Pair configuration
     */
    /**
     * Monitor a specific trading pair and manage its positions
     * @param pairName Name of the trading pair
     * @param config Configuration for the pair
     */
    private async monitorPair(pairName: string, config: PairConfig) {
      console.log(`Checking wallet: ${this.user.publicKey.toString()}`);
  
      try {
        // Initialize DLMM pool and get active bin
        const dlmmPool = await DLMM.create(this.connection, config.poolAddress);
        const activeBin = await dlmmPool.getActiveBin();
        const currentPrice = activeBin.pricePerToken;
        const decimalX = dlmmPool.tokenX.decimal;
        const decimalY = dlmmPool.tokenY.decimal;
        
        // Get user positions and balances
        const positions = await dlmmPool.getPositionsByUserAndLbPair(this.user.publicKey);
        const { balanceX, balanceY } = await this.balances.getUserBalances(this.user.publicKey, config.poolAddress);
        
        // Check bins and position status
        const binsWithLiquidity = this.getBinsWithLiquidity(positions);
        const isInRange = this.checkPriceInRange(positions, activeBin.binId);
        
        // Check fees if there are positions
        if (positions.userPositions.length > 0) {
          this.checkFees(positions.userPositions[0], Number(activeBin.price), config.poolAddress);
        }
        
        // Calculate maximum position sizes
        const { maximumX, maximumY } = await this.calculatePosition(
          Number(balanceX) / 10 ** decimalX,
          Number(balanceY) / 10 ** decimalY,
          Number(currentPrice),
          config
        );
        
        // Handle position state
        await this.handlePositionState(
          pairName,
          dlmmPool,
          {
            positions,
            binsWithLiquidity,
            isInRange,
            activeBin,
            balances: { balanceX: Number(maximumX), balanceY: Number(maximumY) },
            config
          }
        );
      } catch (error) {
        console.error(`Error monitoring ${pairName}:`, error);
      }
    }
  
    /**
     * Get position state for the user
     * @param dlmmPool DLMM pool instance
     * @returns Array of user positions
     */
    async getPositionsState(dlmmPool: DLMM) {
      const positionsState = await dlmmPool.getPositionsByUserAndLbPair(this.user.publicKey);
      return positionsState.userPositions;
    }
  
    /**
     * Calculate position sizes based on available balances
     * @param balanceX Available X token balance
     * @param balanceY Available Y token balance
     * @param price Current price
     * @param config Pair configuration
     * @param binsWithLiquidity Bins that currently have liquidity
     * @param isInRange Whether the position is in range
     * @returns Maximum X and Y amounts to use
     */
    async calculatePosition(
      balanceX: number,
      balanceY: number, 
      price: number, 
      config: PairConfig, 
     
    ) {
      const minimumX = config.minReserveX;
      const minimumY = config.minReserveY;
      const maxPositionSize = config.maxPositionSizeInY; // Maximum Y allowed for trade
      const K = Math.abs(Number(price)); // Ensure price is positive
      const availableXinY = ((balanceX - minimumX) * K) < 0 ? 0 : ((balanceX - minimumX) * K); // Max X that can be traded
      const availableY = (balanceY - minimumY) < 0 ? 0 : (balanceY - minimumY);
      
      try {
        // Ensure all calculated values are positive
        const tradeX = Math.abs(maxPositionSize / K);
        const balanceXAvailable_inY = Math.abs((balanceX - minimumX) * K);
        const remainingY = (maxPositionSize - balanceXAvailable_inY) < 0 ? 0 : (maxPositionSize - balanceXAvailable_inY);
        console.log(`Trade calculations - X: ${tradeX}, X in Y: ${balanceXAvailable_inY}, Remaining Y: ${remainingY}`);
        
        // Decision-making based on balances
        const requiredY = (maxPositionSize > availableXinY) ? (maxPositionSize - availableXinY) : 0;
        
        if (availableXinY > maxPositionSize) {
          // Case 1: balanceX is more than maxX, trade only X
          return { maximumX: maxPositionSize / K, maximumY: 0 };
        } else if (availableXinY <= 0) {
          // Case 2: No X available, trade Y only
          return { maximumX: 0, maximumY: availableY > requiredY ? requiredY : availableY };
        } else if (maxPositionSize > availableXinY && availableXinY > 0) {
          // Case 3: balanceX is within allowed range, trade X and Y
          return { maximumX: availableXinY / K, maximumY: requiredY > availableY ? availableY : requiredY };
        } else {
          return { maximumX: 0, maximumY: 0 };
        }
      } catch (error) {
        console.error("Error calculating position:", error);
        return { maximumX: 0, maximumY: 0 };
      }
    }
  
    /**
     * Get bins that have liquidity
     * @param positions User positions
     * @returns Array of bin IDs with liquidity
     */
    private getBinsWithLiquidity(positions: any) {
      return positions.userPositions
        .flatMap(({ positionData }: any) =>
          positionData.positionBinData
            .filter((bin: any) => 
              bin.binId === 0 || Number(bin.positionXAmount) > 0 || Number(bin.positionYAmount) > 0
            )
            .map((bin: any) => bin.binId)
        );
    }
  
    /**
     * Check if current price is within position range
     * @param positions User positions
     * @param currentBinId Current active bin ID
     * @returns Boolean indicating if price is in range
     */
    private checkPriceInRange(positions: any, currentBinId: number): boolean {
      return positions.userPositions.some(({ positionData }: any) =>
        positionData.lowerBinId < currentBinId && positionData.upperBinId > currentBinId
      );
    }
  
    /**
     * Check position profit and loss
     * @param inAmount Amount put in
     * @param outAmount Amount taken out
     */
    private async checkPnl(inAmount: number, outAmount: number) {
      const totalAmountLossOrProfit = outAmount - inAmount;
      console.info(`Total Profit/Loss: ${totalAmountLossOrProfit}`);
    }
  
    /**
     * Check unclaimed fees in a position
     * @param position Position to check
     * @param price Current price
     * @param poolAddress Pool address
     */
    private async checkFees(position: LbPosition, price: number, poolAddress: PublicKey) {
      const xFees = Number(position.positionData.feeX) * price;
      const yFees = Number(position.positionData.feeY);
      const yPrice = await this.balances.getTokenPriceInUsd(poolAddress);
      console.log(`Total Unclaimed Fees: ${((xFees + yFees) * Number(yPrice) / 10 ** 6).toFixed(3)}`);
    }
  
    /**
     * Create an empty position
     * @param dlmmPool DLMM pool instance
     * @param activeBin Current active bin
     */
    async create_empty_position(dlmmPool: DLMM, activeBin: number) {
      const minBinId = activeBin - 68 / 2; // Below 69 Bins for standard position
      const maxBinId = activeBin + 68 / 2;
      
      const addLiquidityTx = await dlmmPool.createEmptyPosition({
        positionPubKey: this.newpositionAddress.publicKey,
        user: this.user.publicKey,
        maxBinId,
        minBinId,
      });
    
      try {
        const priorityFeeTx = await this.addPriorityFeeToTransaction(
          this.connection, 
          addLiquidityTx
        );
        
        const addLiquidityTxHash = await sendAndConfirmTransaction(
          this.connection, 
          priorityFeeTx, 
          [this.user, this.newpositionAddress], 
          {
            preflightCommitment: "confirmed",
            skipPreflight: true,
            maxRetries: 15,
          }
        );
        
        console.log("Created empty position:", addLiquidityTxHash);
      } catch (error) {
        console.error("Error creating position:", error);
      }
    }
  
    /**
     * Claim all rewards from a position
     * @param dlmmPool DLMM pool instance
     * @param userPublicKey User public key
     * @param position Position to claim rewards from
     */
    async claimAllRewards(dlmmPool: DLMM, userPublicKey: PublicKey, position: LbPosition) {
      const claimTx = await dlmmPool.claimAllRewardsByPosition({
        owner: userPublicKey,
        position: position
      });
    
      try {
        for (const tx of claimTx) {
          const priorityFeeTx = await this.addPriorityFeeToTransaction(
            this.connection, 
            tx
          );
          
          const txHash = await sendAndConfirmTransaction(
            this.connection, 
            priorityFeeTx, 
            [this.user], 
            {
              skipPreflight: false,
              preflightCommitment: "confirmed",
              maxRetries: 15,
            }
          );
          
          console.log("Claimed rewards:", txHash);
        }
      } catch (error) {
        console.error("Error claiming rewards:", error);
      }
    }
  
    /**
     * Remove liquidity from bins
     * @param dlmmPool DLMM pool instance
     * @param closePosition Whether to close the position after removing liquidity
     */
    async removePositionLiquidityinBins(dlmmPool: DLMM, closePosition: boolean) {
      const userPositions = await this.getPositionsState(dlmmPool);
    
      const removeLiquidityTxs = (
        await Promise.all(
          userPositions.map(({ publicKey, positionData }) => {
            const binIdsToRemove = 
            closePosition ?     
            positionData.positionBinData.map((bin) => {
                return bin.binId;
            }) :  
            positionData.positionBinData
              .map((bin) => (Number(bin.positionXAmount) > 0 || Number(bin.positionYAmount) > 0 ? bin.binId : undefined))
              .filter(Boolean);
              
            return dlmmPool.removeLiquidity({
              position: publicKey,
              user: this.user.publicKey,
              binIds: binIdsToRemove as number[],
              bps: new BN(100 * 100),
              shouldClaimAndClose: closePosition,
            });
          })
        )
      ).filter(Boolean).flat();
    
      try {
        for (const tx of removeLiquidityTxs) {
          const priorityFeeTx = await this.addPriorityFeeToTransaction(
            this.connection, 
            tx
          );
          
          const txHash = await sendAndConfirmTransaction(
            this.connection, 
            priorityFeeTx, 
            [this.user], 
            {
              skipPreflight: false,
              preflightCommitment: "confirmed",
              maxRetries: 15,
            }
          );
          
          console.log("Removed liquidity:", txHash);
        }
      } catch (error) {
        console.error("Error removing liquidity:", error);
      }
    }
  
    /**
     * Close a position
     * @param dlmmPool DLMM pool instance
     * @param positionAddress Position to close
     * @param userPublicKey User public key
     */
    async closePosition(dlmmPool: DLMM, positionAddress: LbPosition, userPublicKey: PublicKey) {
      const closeTx = await dlmmPool.closePosition({
        owner: userPublicKey,
        position: positionAddress
      });
      
      try {
        const priorityFeeTx = await this.addPriorityFeeToTransaction(
          this.connection, 
          closeTx
        );
  
        const closePositionTx = await sendAndConfirmTransaction(
          this.connection, 
          priorityFeeTx, 
          [this.user], 
          {
            preflightCommitment: "confirmed",
            skipPreflight: true,
            maxRetries: 15,
          }
        );
        
        console.log("Closed position:", closePositionTx);
      } catch (error) {
        console.error("Error closing position:", error);
      }
    }
  
    /**
     * Handle position state changes
     * @param pairName Name of the trading pair
     * @param dlmmPool DLMM pool instance
     * @param params Position parameters
     */
    private async handlePositionState(
      pairName: string,
      dlmmPool: DLMM,
      params: {
        positions: any,
        binsWithLiquidity: number[],
        isInRange: boolean,
        activeBin: any,
        balances: { balanceX: number, balanceY: number },
        config: PairConfig,
      }
    ) {
      const { positions, binsWithLiquidity, isInRange, activeBin, balances, config } = params;
      
      // If no positions, create a new one
      if (positions.userPositions.length === 0) {
        console.log(`${pairName}: Creating new position`);
        await this.create_empty_position(dlmmPool, activeBin.binId);
        return;
      }
      
      const positionKey = positions.userPositions[0].publicKey.toString();
      let positionState = this.positionStates.get(positionKey) || { state: 'waiting' };
      
      // Check tokens in position
      const totalX = (Number(positions.userPositions[0].positionData.totalXAmount) / 10 ** dlmmPool.tokenX.decimal) * Number(activeBin.pricePerToken);
      const totalY = Number(positions.userPositions[0].positionData.totalYAmount) / 10 ** dlmmPool.tokenY.decimal;
      
      if (config.balanceOutPosition === true) {
        // Handle one-sided position that's become imbalanced
        if (positionState.state === 'oneSided' && binsWithLiquidity.length > 0) {
          // Check if token balance condition is met
          const shouldRemove = (positionState.initialTokenType === 'X' && totalY > totalX) || 
                              (positionState.initialTokenType === 'Y' && totalX > totalY);
          
          if (shouldRemove) {
            console.log(`${pairName}: Token imbalance detected, removing one-sided liquidity`);
            await this.removePositionLiquidityinBins(dlmmPool, false);
            
            // Add balanced liquidity with both tokens
            console.log(`${pairName}: Adding balanced liquidity with both tokens`);
  
            await this.addImbalancedPosition(
              dlmmPool,
              positions.userPositions[0].publicKey,
              totalX / activeBin.pricePerToken,
              totalY,
              activeBin.binId,
              config.TOTAL_RANGE_INTERVAL / 2,
              config.maxPositionSizeInY,
              config.strategyType
            );
            
            // Update state to balanced
            positionState = { state: 'balanced' };
            this.positionStates.set(positionKey, positionState);
            return;
          }
        }
      }
  
      // Handle no active liquidity
      if ((!binsWithLiquidity.includes(activeBin.binId) && 
           !binsWithLiquidity.includes(activeBin.binId + 1) && 
           !binsWithLiquidity.includes(activeBin.binId - 1)) && 
          binsWithLiquidity.length > 0 && 
          isInRange) {
        console.log("Removing liquidity - No active liquidity");
        await this.removePositionLiquidityinBins(dlmmPool, false);
        positionState = { state: 'waiting' };
        this.positionStates.set(positionKey, positionState);
      }
      
      // Handle out of range position
      if (!isInRange && binsWithLiquidity.length > 0) {
        console.log('Closing position...');
        await this.removePositionLiquidityinBins(dlmmPool, true);
        positionState = { state: 'waiting' };
        this.positionStates.set(positionKey, positionState);
      }
      
      // Close fully out-of-range position and claim rewards
      if (!isInRange && binsWithLiquidity.length <= 0) {
        console.log(`${pairName}: Position out of range, closing`);
        if (positions.userPositions[0].positionData.feeX > 0 || positions.userPositions[0].positionData.feeY > 0) {
          await this.claimAllRewards(dlmmPool, this.user.publicKey, positions.userPositions[0]);
          await this.closePosition(dlmmPool, positions.userPositions[0], this.user.publicKey);
        } else {
          await this.closePosition(dlmmPool, positions.userPositions[0], this.user.publicKey);
        }
        this.positionStates.delete(positionKey);
        return;
      }
      
      // Update liquidity if needed
      if (binsWithLiquidity.length === 0) {
        await this.updateLiquidity(
          dlmmPool,
          positions.userPositions[0].publicKey,
          {
            ...balances,
            currentBinId: activeBin.binId,
            binsWithLiquidity,
            config,
            positionKey
          },
          activeBin.pricePerToken
        );
      }
    }
  
    /**
     * Update liquidity based on current state
     * @param dlmmPool DLMM pool instance
     * @param positionAddress Position address
     * @param params Update parameters
     * @param K Current price
     */
    private async updateLiquidity(
      dlmmPool: DLMM,
      positionAddress: PublicKey,
      params: any,
      K: number
    ) {
      const { balanceX, balanceY, currentBinId, binsWithLiquidity, config, positionKey } = params;
      
      // Skip if we already have liquidity
      if (binsWithLiquidity.length > 0 && binsWithLiquidity.includes(currentBinId)) {
        return;
      }
      
      let positionState = this.positionStates.get(positionKey) || { state: 'waiting' };
      
      // Add X-sided liquidity
      if (balanceX > 0 && balanceY <= config.minReserveY) {
        console.log("Adding X token liquidity");
        const txHash = await this.addLiquidityWithRetry(dlmmPool, {
          positionPubKey: positionAddress,
          user: this.user.publicKey,
          totalXAmount: new BN(balanceX * 10 ** dlmmPool.tokenX.decimal),
          totalYAmount: new BN(0),
          strategy: {
            minBinId: currentBinId,
            maxBinId: currentBinId + config.TOTAL_RANGE_INTERVAL / 2,
            strategyType: config.strategyType
          }
        });
        
        if (txHash) {
          // Mark as one-sided X position
          this.positionStates.set(positionKey, { 
            state: 'oneSided', 
            initialTokenType: 'X' 
          });
        }
      } 
      // Add Y-sided liquidity
      else if (balanceY > 0 && balanceX <= config.minReserveX) {
        console.log(`Adding Y token liquidity with amount: ${balanceY}`);
        const amountY = new BN(balanceY * 10 ** dlmmPool.tokenY.decimal);
        const txHash = await this.addLiquidityWithRetry(dlmmPool, {
          positionPubKey: positionAddress,
          user: this.user.publicKey,
          totalXAmount: new BN(0),
          totalYAmount: amountY,
          strategy: {
            minBinId: currentBinId - config.TOTAL_RANGE_INTERVAL / 2,
            maxBinId: currentBinId,
            strategyType: config.strategyType
          }
        });
        
        if (txHash) {
          // Mark as one-sided Y position
          this.positionStates.set(positionKey, { 
            state: 'oneSided', 
            initialTokenType: 'Y' 
          });
        }
      }
      // Add balanced liquidity
      else if (balanceX > config.minReserveX && balanceY > config.minReserveY) {
        let _balanceX = balanceX;
        let _balanceY = balanceY;
        console.log("Adding balanced position with both tokens");
        
        const singleBinLiquidity = config.maxPositionSizeInY / (config.TOTAL_RANGE_INTERVAL);
  
        if (singleBinLiquidity > balanceX * K) {
          _balanceX = 0;
        }
        
        if (singleBinLiquidity > balanceY) {
          _balanceY = 0;
        }
  
        await this.addImbalancedPosition(
          dlmmPool,
          positionAddress,
          _balanceX,
          _balanceY,
          currentBinId,
          config.TOTAL_RANGE_INTERVAL,
          config.maxPositionSizeInY,
          config.strategyType
        );
        
        // Mark as balanced position
        this.positionStates.set(positionKey, { state: 'balanced' });
      }
    }
  
    /**
     * Add imbalanced position
     * @param dlmmPool DLMM pool instance
     * @param positionAddress Position address
     * @param balanceX X token balance
     * @param balanceY Y token balance
     * @param activeBin Active bin ID
     * @param totalRangeInterval Range interval
     * @param positionSize Position size
     * @param strategyType Strategy type
     */
    async addImbalancedPosition(
      dlmmPool: DLMM,
      positionAddress: PublicKey,
      balanceX: number,
      balanceY: number,
      activeBin: number,
      totalRangeInterval: number,
      positionSize: number,
      strategyType: StrategyType
    ) {
      let totalXAmount = new BN(balanceX * 10 ** dlmmPool.tokenX.decimal);
      let totalYAmount = new BN(balanceY * 10 ** dlmmPool.tokenY.decimal);
      
      console.log(`Adding imbalanced position - X amount: ${totalXAmount.toString()}, Y amount: ${totalYAmount.toString()}`);
      
      const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
        positionPubKey: positionAddress,
        user: this.user.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: {
          maxBinId: activeBin + totalRangeInterval / 2,
          minBinId: activeBin - totalRangeInterval / 2,
          strategyType: strategyType
        },
      });
      
      try {
        const priorityFeeTx = await this.addPriorityFeeToTransaction(
          this.connection, 
          addLiquidityTx
        );
  
        const addLiquidityTxHash = await sendAndConfirmTransaction(
          this.connection, 
          priorityFeeTx, 
          [this.user], 
          {
            preflightCommitment: "confirmed",
            skipPreflight: true,
            maxRetries: 15,
          }
        );
        
        console.log("Added imbalanced position:", addLiquidityTxHash);
      } catch (error) {
        console.error("Error adding imbalanced position:", error);
      }
    }
  
    /**
     * Add liquidity with retry
     * @param dlmmPool DLMM pool instance
     * @param params Liquidity parameters
     * @returns Transaction hash or undefined
     */
    async addLiquidityWithRetry(dlmmPool: DLMM, params: any) {
      const tx = await dlmmPool.addLiquidityByStrategy(params);
  
      try {
        const priorityFeeTx = await this.addPriorityFeeToTransaction(
          this.connection, 
          tx
        );
  
        // Simulate transaction first
        const simulate = await simulateTransaction(this.connection, priorityFeeTx);
        console.log("Transaction simulation result:", simulate.value.err ? simulate.value.err : "Success");
  
        if (simulate.value.err) {
          console.error("Transaction simulation failed:", simulate.value.err);
          return undefined;
        }
  
        const txHash = await sendAndConfirmTransaction(
          this.connection, 
          priorityFeeTx, 
          [this.user], 
          {
            preflightCommitment: "confirmed",
            skipPreflight: true,
            maxRetries: 15,
          }
        );
        
        console.log("Added liquidity:", txHash);
        return txHash;
      } catch (error) {
        console.error("Error adding liquidity:", error);
        return undefined;
      }
    }
}
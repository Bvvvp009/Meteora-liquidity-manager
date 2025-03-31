import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AccountLayout, getMint } from "@solana/spl-token";
import axios from 'axios';
import DLMM  from "@meteora-ag/dlmm";

export class DLMMUtils {
  private connection: Connection;
  
  /**
   * Create a new DLMMUtils instance
   * @param connection - The Solana connection to use
   * @param pairAddress - The address of the DLMM pair
   */
  constructor(connection: Connection) {
    this.connection = connection;
  }
  
  /**
   * Get information about a DLMM pair
   * @param pairAddress - Optional override for the constructor pairAddress
   * @returns The pair information from the API
   */
  async getPairInfo(pairAddress?: PublicKey) {
    const targetPair = pairAddress ;
    const data = await axios.get(`https://dlmm-api.meteora.ag/pair/${targetPair}`);
    return data.data;
  }
  
  /**
   * Get the current SOL price in USD
   * @returns The SOL price in USD
   */
  async getSolPrice() {
    const solUsd2FroPrice = new PublicKey("BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh");
    const data = await this.getPairInfo(solUsd2FroPrice);
    return Number(parseFloat(data?.current_price).toPrecision(5));
  }
  
  /**
   * Get type information about a pair
   * @param pairAddress - Optional override for the constructor pairAddress
   * @returns Object with pair name, token addresses, and pair address
   */
  async getPairTypeInfo(pairAddress?: PublicKey) {
    const targetPair = pairAddress 
    const data = await this.getPairInfo(targetPair);
    return {
      name: data.name,
      xToken: data.mint_x,
      yToken: data.mint_y,
      pairAddress: data.address 
    };
  }
  
  /**
   * Get the current price of a token in a pair
   * @param pairAddress - Optional override for the constructor pairAddress
   * @returns The current price
   */
  async getAmountTokenPrice(pairAddress?: PublicKey) {
    const targetPair = pairAddress 
    const data = await this.getPairInfo(targetPair);
    return Number(parseFloat(data?.current_price).toPrecision(5));
  }
  
  /**
   * Get a user's balances for both tokens in a pair
   * @param user - The user's public key
   * @param pairAddress - Optional override for the constructor pairAddress
   * @returns Object with balanceX and balanceY
   */
  async getUserBalances(user: PublicKey, pairAddress?: PublicKey) {
    const targetPair = pairAddress
    const pairInfo = await this.getPairInfo(targetPair);
    
    const balanceX = await this.getTokenBalance(new PublicKey(pairInfo.mint_x), user);
    const balanceY = await this.getTokenBalance(new PublicKey(pairInfo.mint_y), user);
    
    return { balanceX, balanceY };
  }
  
  /**
   * Get a user's balance of a specific token
   * @param contractAddress - The token's mint address
   * @param walletAddress - The user's wallet address
   * @returns The token balance
   */
  async getTokenBalance(contractAddress: PublicKey, walletAddress: PublicKey) {
    const walletPublicKey = new PublicKey(walletAddress);
    const SOL_ADDRESS = new PublicKey("So11111111111111111111111111111111111111112");
    
    // Special case for SOL
    if (contractAddress.equals(SOL_ADDRESS)) {
      try {
        const balanceLamports = await this.connection.getBalance(walletPublicKey, "confirmed");
        return Number(balanceLamports); // Return raw lamports
      } catch (err) {
        console.error("Error fetching SOL balance:", (err as Error).message);
        return 0;
      }
    }
    
    // For SPL tokens
    try {
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(walletPublicKey, {
        mint: contractAddress,
      });
      
      if (tokenAccounts.value.length > 0) {
        const tokenAccountInfo = tokenAccounts.value[0];
        
        // Ensure account data exists and is valid
        if (!tokenAccountInfo.account.data || !(tokenAccountInfo.account.data instanceof Uint8Array)) {
          console.error("Invalid or missing account data");
          return 0;
        }
        
        // Decode account data
        const accountData = AccountLayout.decode(new Uint8Array(tokenAccountInfo.account.data));
        
        // Fetch mint info to get decimals
        const mintInfo = await getMint(this.connection, contractAddress);
        
        // Return raw balance
        return Number(BigInt(accountData.amount));
      }
      return 0;
    } catch (err) {
      console.error("Error fetching token balances:", (err as Error).message);
      return 0;
    }
  }
  
  /**
   * Get detailed information about a position
   * @param positionAddress - The address of the position to query
   * @returns Object with position details
   */
  async getPositionInfo(positionAddress: string = "D6Xo2Wcnj859T2msJVtnhBTLrhKv9WLoABVHpwZcP7gE") {
    const url = `https://dlmm-api.meteora.ag/position/${positionAddress}/deposits`;
    const { data } = await axios.get(url);
    
    return {
      active_bin_id: data.active_bin_id,
      onchain_timestamp: data.onchain_timestamp,
      pair_address: data.pair_address,
      position_address: data.position_address,
      price: data.price,
      token_x_amount: data.token_x_amount,
      token_x_usd_amount: data.token_x_usd_amount,
      token_y_amount: data.token_y_amount,
      token_y_usd_amount: data.token_y_usd_amount,
      tx_id: data.tx_id
    };
  }
  
  /**
   * Calculate profit and loss and fees in USD
   * @param dlmmPool - The DLMM pool instance
   * @param poolType - The type of pool ("partial" or other)
   * @param userAddress - Optional user address, defaults to a specific address
   * @returns Object with totalSize and totalFee
   */
  async getPnlFeeInUSD(dlmmPool: DLMM, poolType: string, userAddress: string = "GSYuHtGDYULfp962nbRaDMaN4icKjbJyGC3mRNUyi45W") {
    const activebin = await dlmmPool.getActiveBin();
    const xdecimal = dlmmPool.tokenX.decimal;
    const ydecimal = dlmmPool.tokenY.decimal;
    const sol_price = await this.getSolPrice();
    const details = await dlmmPool.getPositionsByUserAndLbPair(new PublicKey(userAddress));
    const position = details.userPositions;
    
    if (!position || position.length === 0) {
      return { totalSize: 0, totalfee: 0 };
    }
    
    const tokenx = Number(position[0]?.positionData.totalXAmount) / 10**xdecimal * Number(activebin.pricePerToken);
    const tokeny = Number(position[0]?.positionData.totalYAmount) / 10**ydecimal;
    const feex = Number(position[0].positionData.feeX) / 10**xdecimal * Number(activebin.pricePerToken);
    const feey = Number(position[0]?.positionData.feeY) / 10**ydecimal;
    
    const totalSize = poolType === "partial" ? tokenx + tokeny : tokenx + (tokeny * sol_price); // in $
    const totalfee = poolType === "partial" ? feex + feey : feex + (feey * sol_price); // in $
    
    return { totalSize, totalfee };
  }

   async  getTokenPriceInUsd(
    positionAddress: PublicKey
  ): Promise<number | null> {

    const pairInfo = await this.getPairInfo(positionAddress);
    const tokenYContract = pairInfo.mint_y;

    // If the token is SOL, use the existing function
    if (tokenYContract.toString() === "So11111111111111111111111111111111111111112") {
      return await this.getSolPrice();
    }
    if (tokenYContract.toString() === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
      return 1;
    }
    if (tokenYContract.toString() === "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB") {
      return 1;
    }
    
    try {
      // Try to fetch from Jupiter API (as it has comprehensive token price data)
      const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenYContract.toString()}`);
      
      if (response.data && response.data.data && response.data.data[tokenYContract.toString()]) {
        return response.data.data[tokenYContract.toString()].price;
      }
      
      // If Jupiter doesn't have the data, try Meteora API if you know a pair with this token
      // This would require knowing a DLMM pair that contains this token
      
      // Fallback to a general token price API if needed
      const coingeckoResponse = await axios.get(
        `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${tokenYContract.toString()}&vs_currencies=usd`
      );
      
      if (coingeckoResponse.data && coingeckoResponse.data[tokenYContract.toString()]) {
        return coingeckoResponse.data[tokenYContract.toString()].usd;
      }
      
      console.warn(`No price data found for token: ${tokenYContract.toString()}`);
      return null;
    } catch (error) {
      console.error("Error fetching token price:", (error as Error).message);
      return null;
    }
  }
  
}
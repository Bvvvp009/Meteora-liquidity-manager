# MeteoraBOT

Automated liquidity management bot for [Meteora](https://meteora.ag/) on Solana. This bot autonomously manages liquidity positions based on configurable strategies.

## Features

- **Automated Liquidity Provision**: Automatically provides liquidity to Meteora DLMM pools
- **Intelligent Position Management**: Detects when positions are out-of-range and rebalances them
- **Multiple Strategy Support**: Supports different liquidity distribution strategies
- **Position Balancing**: Can balance out one-sided positions if configured
- **Fee Collection**: Collects trading fees automatically

## Coming Soon

- **Hedging with Drift**: Integration with Drift protocol for hedging positions
- **AI-driven Strategy**: Advanced AI parameters for active management of liquidity

## Prerequisites

- Node.js v16+ 
- TypeScript
- A Solana wallet with SOL and tokens for the pools you want to manage
- RPC endpoint (Helius, QuickNode, etc.)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/meteorabot.git
cd meteorabot
```

2. Install dependencies:

```bash
npm install
```

3. Create your environment file:

```bash
cp .env.example .env
```

4. Configure your `.env` file with your private key and RPC endpoint:

```
RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY_HERE"
PRIVATE_KEY="[11,22,33,...64 numbers total]"
CHECK_INTERVEL=5
```

> **Important Security Notice**: Never commit your `.env` file to git. It's already in `.gitignore`, but be cautious.

## Configuration

Edit `src/index.ts` to configure the trading pairs you want to manage:

```typescript
manager.addPairConfig("SOL-USDC", {
  poolAddress: new PublicKey("BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh"),
  minReserveX: 2,                  // Min reserve SOL
  minReserveY: 200,                // Min reserve USDC
  binStep: 10,                     // Bin step from pool config
  TOTAL_RANGE_INTERVAL: 6,         // Total bins for distribution
  maxPositionSizeInY: 10,          // Max position size in USDC
  strategyType: StrategyType.BidAskImBalanced,
  balanceOutPosition: true         // Rebalance imbalanced positions
});
```

You can add multiple trading pairs to manage simultaneously.

## Building and Running

1. Build the project:

```bash
npm run build
```

2. Run the bot:

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

## Deployment

For production deployment, consider using a process manager like PM2:

```bash
npm install -g pm2
pm2 start dist/index.js --name meteorabot
```

To make the bot start automatically on system reboot:

```bash
pm2 startup
pm2 save
```

## Strategy Types

The bot supports the following strategy types from the Meteora DLMM SDK:

- `StrategyType.SpotImbalanced`: Liquidity concentrated around the current price
- `StrategyType.CurveImbalanced`: Liquidity distributed along a curve
- `StrategyType.BidAskImBalanced`: Imbalanced distribution favoring expected price movement


## Risk Warning

- **Trading and liquidity provision involve financial risk**
- **This bot is provided as-is with no guarantees**
- **Test with small amounts before committing significant capital**
- **Always monitor your bot's performance**
- **Low binstep position prone to IL risks**

## License

ISC

## Acknowledgements

- [Meteora](https://meteora.ag/) for their DLMM protocol and SDK
- Solana ecosystem for building the infrastructure

---

## How to Get Your Wallet's Private Key as an Array

> **Warning**: Never share your private key with anyone or expose it in public repositories.

1. **Method 1: From Solana Keypair File**
   If you have a Solana keypair file (often created with `solana-keygen`), you can extract the private key array:

   ```javascript
   const fs = require('fs');
   const path = require('path');

   // Replace with your keypair file path
   const keypairPath = path.resolve(process.env.HOME, '.config', 'solana', 'id.json'); 
   const keypairString = fs.readFileSync(keypairPath, 'utf-8');
   const keypairArray = JSON.parse(keypairString);

   console.log(JSON.stringify(keypairArray));
   ```

2. **Method 2: From Private Key Hex/Base58**
   If you have your private key in another format, you may need to convert it to an array of numbers.

3. **Method 3: From Private Key Hex/Base58 from a wallet like SolFlare**
   
---

Created with ❤️ for the Meteora community.
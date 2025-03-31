import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import 'dotenv/config';

/**
 * Load a Solana keypair from environment variables or a provided array
 * @returns Solana Keypair instance
 */
export function loadKeypair(fallbackArray?: number[]): Keypair {
  // Try loading from environment variable
  if (process.env.PRIVATE_KEY) {
    try {
      // Parse the array from string "[1,2,3,...]" format
      const privateKeyArray = JSON.parse(process.env.PRIVATE_KEY);
      
      // Validate that it's actually an array of numbers
      if (Array.isArray(privateKeyArray) && privateKeyArray.length === 64) {
        return loadKeypairFromArray(privateKeyArray);
      }
      
      console.warn("Invalid PRIVATE_KEY format in .env file. Expected array of 64 numbers.");
    } catch (error) {
      console.error(`Failed to parse PRIVATE_KEY from .env: ${(error as Error).message}`);
    }
  }
  
  // Use fallback array if provided
  if (fallbackArray && Array.isArray(fallbackArray) && fallbackArray.length === 64) {
    return loadKeypairFromArray(fallbackArray);
  }
  
  // If all else fails, throw an error
  throw new Error("No valid private key found. Please set PRIVATE_KEY in .env file or provide a fallback array.");
}

/**
 * Load a keypair from a Solana keypair file
 * @param filename Path to the keypair file
 * @returns Solana Keypair instance
 */
export function loadKeypairFromFile(filename: string): Keypair {
  if (!filename || filename.trim() === '') {
    throw new Error("Empty filename provided");
  }
  
  const secretKeyBase64 = fs.readFileSync(filename, { encoding: "utf-8" });
  const secretKey = Buffer.from(secretKeyBase64, "base64");
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Load a keypair from an array of numbers
 * @param keyArray Array of 64 numbers representing the keypair
 * @returns Solana Keypair instance
 */
export function loadKeypairFromArray(keyArray: number[]): Keypair {
  if (!Array.isArray(keyArray) || keyArray.length !== 64) {
    throw new Error("Invalid key array: must be an array of 64 numbers");
  }
  
  const secretKey = new Uint8Array(keyArray);
  return Keypair.fromSecretKey(secretKey);
}
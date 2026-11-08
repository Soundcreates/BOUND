import type { JsonRpcProvider, Wallet } from "ethers";

export interface ArkivSignRequest {
  owner: string;
  chainId: number;
  target: string;
  value: string;
  data: string;
}

export function createArkivSigner(options: {
  wallet: Wallet;
  provider: JsonRpcProvider;
  owner: string;
  target: string;
  chainId: number;
}): {
  prepare(request: ArkivSignRequest): Promise<string>;
  inspect(raw: string): { from: string | null; to: string | null; chainId: number; value: string; data: string };
};

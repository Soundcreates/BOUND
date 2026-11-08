const word = (value) => value.toString(16).padStart(64, "0");
const addressWord = (value) => value.slice(2).toLowerCase().padStart(64, "0");

// Uniswap V2 swapExactTokensForTokens; decoder intentionally treats this unknown ABI as opaque.
export const benignDexRequest = {
  method: "eth_sendTransaction",
    params: [{
    to: "0x00000000000000000000000000000000000000f0",
    data: `0x38ed1739${word(1000)}${word(900)}${word(160)}${addressWord("0x1111111111111111111111111111111111111111")}${word(1_900_000_000)}${word(2)}${addressWord("0x2222222222222222222222222222222222222222")}${addressWord("0x3333333333333333333333333333333333333333")}`
  }]
};

// Sharewood Forest — site configuration.
// After deploying SharewoodGifts, paste its address into `gifts` and list allowed tokens.
export const NETWORKS = {
  testnet: {
    chainId: 46630,
    name: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    faucet: "https://faucet.testnet.chain.robinhood.com",
    gifts: "", // SharewoodGifts contract address
    tokens: [
      // { address: "0x...", symbol: "TSLA", name: "Tesla" },
    ],
  },
  mainnet: {
    chainId: 4663,
    name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    faucet: "",
    gifts: "",
    tokens: [],
  },
};

export const ACTIVE = "testnet"; // switch to "mainnet" at launch
export const NET = NETWORKS[ACTIVE];

// ETH the sender tucks inside the gift so the recipient can claim without owning ETH.
export const GAS_TOPUP_ETH = "0.00003";
export const DURATIONS = [
  { days: 7, label: "1 week" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

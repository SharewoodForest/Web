import { NET } from "./config.js";
const { ethers } = window;

export const GIFTS_ABI = [
  "function createGift(address token,uint128 amount,address claimKey,uint32 duration) returns (uint256)",
  "function claim(uint256 id,address recipient,bytes sig)",
  "function refund(uint256 id)",
  "function claimDigest(uint256 id,address recipient) view returns (bytes32)",
  "function quote(uint128 amount) view returns (uint256 fee,uint256 total)",
  "function feeBps() view returns (uint16)",
  "function paused() view returns (bool)",
  "function getGift(uint256 id) view returns (tuple(address sender,address token,uint96 expiresAt,address claimKey,uint128 amount,bool settled))",
  "event GiftCreated(uint256 indexed id,address indexed sender,address indexed token,uint256 amount,uint256 fee,uint256 expiresAt)",
];
export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

export const readProvider = new ethers.JsonRpcProvider(NET.rpc, NET.chainId, { staticNetwork: true });
export const isLive = () => ethers.isAddress(NET.gifts);
export const giftsRead = () => new ethers.Contract(NET.gifts, GIFTS_ABI, readProvider);
export const erc20Read = (a) => new ethers.Contract(a, ERC20_ABI, readProvider);

const tokenCache = {};
export async function tokenInfo(address) {
  if (tokenCache[address]) return tokenCache[address];
  const t = erc20Read(address);
  const [symbol, decimals] = await Promise.all([t.symbol(), t.decimals()]);
  return (tokenCache[address] = { address, symbol, decimals: Number(decimals) });
}

export function hasWallet() { return typeof window.ethereum !== "undefined"; }

export async function connectWallet() {
  if (!hasWallet()) throw new Error("No wallet found. Open this page in your wallet app's browser (Robinhood Wallet, MetaMask, Rabby).");
  const provider = new ethers.BrowserProvider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  await ensureChain();
  const browser = new ethers.BrowserProvider(window.ethereum, "any");
  const signer = await browser.getSigner();
  return { signer, address: await signer.getAddress() };
}

export async function ensureChain() {
  const hex = "0x" + NET.chainId.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if (e.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: NET.name, rpcUrls: [NET.rpc],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [NET.explorer] }],
    });
  }
}

export const txUrl = (h) => `${NET.explorer}/tx/${h}`;
export const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

export function friendlyError(e) {
  const m = e?.shortMessage || e?.info?.error?.message || e?.message || String(e);
  if (/user rejected|denied|ACTION_REJECTED/i.test(m)) return "You cancelled the request in your wallet.";
  if (/insufficient funds/i.test(m)) return "Not enough ETH in your wallet to pay the network fee.";
  if (/TokenNotAllowed/.test(m)) return "That token isn't available for gifting yet.";
  if (/AlreadySettled/.test(m)) return "This gift has already been claimed or returned.";
  if (/Expired/.test(m)) return "This gift has expired. The sender can take it back.";
  if (/BadSignature/.test(m)) return "This claim link is damaged. Ask the sender to send it again.";
  if (/NotExpired/.test(m)) return "You can take this gift back once it expires.";
  return m.length > 160 ? m.slice(0, 160) + "…" : m;
}

// Link format: /claim/#<id>.<keyHex>.<meta>, everything after # stays in the browser.
export function encodeMeta(obj) {
  const s = new TextEncoder().encode(JSON.stringify(obj));
  return btoa(String.fromCharCode(...s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeMeta(str) {
  try {
    const b = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
  } catch { return {}; }
}

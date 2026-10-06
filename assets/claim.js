import { NET, ACTIVE } from "./config.js";
import {
  GIFTS_ABI, isLive, giftsRead, tokenInfo, readProvider, connectWallet,
  friendlyError, decodeMeta, txUrl,
} from "./chain.js";

const { ethers } = window;
const $ = (id) => document.getElementById(id);
$("netPill").textContent = ACTIVE === "mainnet" ? "Robinhood Chain" : "Testnet";

const trim = (s) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
let gift, token, claimWallet, giftId, connected;

function fail(title, text) {
  $("claimTitle").textContent = title;
  $("claimSub").textContent = text;
  $("tagAmount").textContent = "—";
  $("tagUnit").textContent = "";
}

async function init() {
  // Keep the link for this tab (survives a reload), then hide the key from the address bar.
  let frag = location.hash.slice(1);
  try { if (frag) sessionStorage.setItem("sharewood:claim", frag); else frag = sessionStorage.getItem("sharewood:claim") || ""; } catch {}
  if (location.hash) history.replaceState(null, "", location.pathname);
  const [id, keyHex, metaStr] = frag.split(".");
  if (!isLive()) return fail("Gifts open soon", "This gift link can't be opened yet.");
  if (!id || !keyHex || !/^\d+$/.test(id)) return fail("This link is incomplete", "Ask the sender to copy the full link and send it again.");

  try { claimWallet = new ethers.Wallet("0x" + keyHex, readProvider); }
  catch { return fail("This link is damaged", "Ask the sender to copy the full link and send it again."); }

  const meta = metaStr ? decodeMeta(metaStr) : {};
  if (meta.t) $("tagTo").textContent = `For ${meta.t}`;
  if (meta.m) $("tagMsg").textContent = meta.m;
  if (meta.f) $("tagFrom").textContent = `From ${meta.f}`;

  try {
    giftId = BigInt(id);
    gift = await giftsRead().getGift(giftId);
  } catch { return fail("We couldn't find this gift", "Check that you opened the whole link."); }

  if (gift.claimKey.toLowerCase() !== claimWallet.address.toLowerCase()) return fail("This link doesn't match the gift", "Ask the sender to send the link again.");

  token = await tokenInfo(gift.token);
  const amt = trim(ethers.formatUnits(gift.amount, token.decimals));
  $("tagAmount").textContent = amt;
  $("tagUnit").textContent = `${token.symbol} ${amt === "1" ? "share" : "shares"}`;

  if (gift.settled) return fail("This gift has been claimed", "It was already claimed or returned to the sender.");
  const expires = Number(gift.expiresAt) * 1000;
  if (Date.now() >= expires) return fail("This gift has expired", "The sender can take it back. Let them know so they can send it again.");

  $("claimSub").textContent = `Claim by ${new Date(expires).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`;
  $("claimForm").classList.remove("hidden");
}

$("useWalletBtn").addEventListener("click", async () => {
  try {
    connected = await connectWallet();
    $("recipient").value = connected.address;
  } catch (e) { setStatus(friendlyError(e), true); }
});

function setStatus(text, err = false) {
  $("claimStatus").className = err ? "status err" : "status";
  $("claimStatus").textContent = text;
}

$("claimBtn").addEventListener("click", async () => {
  const to = $("recipient").value.trim();
  if (!ethers.isAddress(to)) return setStatus("Paste a wallet address that starts with 0x, or connect your wallet.", true);
  $("claimBtn").disabled = true;
  try {
    setStatus("Preparing your gift…");
    const recipient = ethers.getAddress(to);
    const digest = await giftsRead().claimDigest(giftId, recipient);
    const sig = await claimWallet.signMessage(ethers.getBytes(digest));

    // Prefer the network fee the sender tucked into the link; fall back to the recipient's wallet.
    const viaKey = new ethers.Contract(NET.gifts, GIFTS_ABI, claimWallet);
    let tx;
    try {
      const gas = (await viaKey.claim.estimateGas(giftId, recipient, sig)) * 13n / 10n;
      const fees = await readProvider.getFeeData();
      const cost = gas * (fees.maxFeePerGas ?? fees.gasPrice);
      const bal = await readProvider.getBalance(claimWallet.address);
      if (bal < cost) throw new Error("no-topup");
      setStatus("Claiming…");
      tx = await viaKey.claim(giftId, recipient, sig, { gasLimit: gas });
    } catch (e) {
      if (e.message !== "no-topup" && !/insufficient funds/i.test(e.message || "")) throw e;
      if (!connected) connected = await connectWallet();
      setStatus("Confirm the claim in your wallet…");
      tx = await new ethers.Contract(NET.gifts, GIFTS_ABI, connected.signer).claim(giftId, recipient, sig);
    }
    await tx.wait();
    showDone(tx.hash, recipient);
  } catch (e) {
    setStatus(friendlyError(e), true);
  } finally {
    $("claimBtn").disabled = false;
  }
});

function showDone(hash, recipient) {
  $("claimForm").classList.add("hidden");
  $("claimDone").classList.remove("hidden");
  $("claimTitle").textContent = "It's yours";
  $("claimSub").textContent = "";
  $("doneText").textContent = `${$("tagAmount").textContent} ${token.symbol} is now in the wallet ending ${recipient.slice(-4)}.`;
  $("txLink").href = txUrl(hash);
  if (window.ethereum) {
    $("watchBtn").classList.remove("hidden");
    $("watchBtn").onclick = () => window.ethereum.request({
      method: "wallet_watchAsset",
      params: { type: "ERC20", options: { address: token.address, symbol: token.symbol.slice(0, 11), decimals: token.decimals } },
    }).catch(() => {});
  }
}

init().catch((e) => fail("Something went wrong", friendlyError(e)));

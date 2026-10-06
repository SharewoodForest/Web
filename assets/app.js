import { NET, ACTIVE, GAS_TOPUP_ETH, DURATIONS } from "./config.js";
import {
  GIFTS_ABI, ERC20_ABI, isLive, giftsRead, tokenInfo, connectWallet,
  short, friendlyError, encodeMeta, txUrl,
} from "./chain.js";

const { ethers } = window;
const $ = (id) => document.getElementById(id);
const STORE = `sharewood:sent:${NET.chainId}`;

let account = null;
let signer = null;
let feeBps = 0n;
let current = null; // selected token info

$("netPill").textContent = ACTIVE === "mainnet" ? "Robinhood Chain" : "Testnet";
DURATIONS.forEach((d, i) => $("duration").add(new Option(d.label, d.days, i === 1, i === 1)));

// ---------- live gift tag ----------
function renderTag() {
  const amt = $("amount").value.trim();
  $("tagTo").textContent = $("toName").value.trim() ? `For ${$("toName").value.trim()}` : "For someone special";
  $("tagAmount").textContent = amt || "1";
  $("tagUnit").textContent = current ? `${current.symbol} ${amt === "1" || !amt ? "share" : "shares"}` : "share of a company they love";
  $("tagMsg").textContent = $("message").value.trim() || "Here's to your future.";
  $("tagFrom").textContent = $("fromName").value.trim() ? `From ${$("fromName").value.trim()}` : "From a friend";
}
["amount", "toName", "fromName", "message"].forEach((id) => $(id).addEventListener("input", () => { renderTag(); renderSummary(); }));

// ---------- setup ----------
if (!isLive() || NET.tokens.length === 0) {
  $("soonNotice").classList.remove("hidden");
  $("connectBtn").disabled = true;
} else {
  giftsRead().feeBps().then((f) => { feeBps = f; renderSummary(); }).catch(() => {});
}

$("connectBtn").addEventListener("click", async () => {
  try {
    $("connectBtn").disabled = true;
    ({ signer, address: account } = await connectWallet());
    $("connectStep").classList.add("hidden");
    $("sendForm").classList.remove("hidden");
    $("walletLine").textContent = `Sending from ${short(account)}`;
    await loadTokens();
  } catch (e) {
    alert(friendlyError(e));
  } finally {
    $("connectBtn").disabled = false;
  }
});

async function loadTokens() {
  const sel = $("token");
  sel.innerHTML = "";
  for (const t of NET.tokens) sel.add(new Option(`${t.name} (${t.symbol})`, t.address));
  sel.addEventListener("change", onToken);
  await onToken();
}

async function onToken() {
  current = await tokenInfo($("token").value);
  const bal = await new ethers.Contract(current.address, ERC20_ABI, signer).balanceOf(account);
  current.balance = bal;
  $("balanceLine").textContent = `You have ${trim(ethers.formatUnits(bal, current.decimals))} ${current.symbol}`;
  renderTag();
  renderSummary();
}

function parsedAmount() {
  if (!current) return null;
  try {
    const v = ethers.parseUnits($("amount").value.trim() || "0", current.decimals);
    return v > 0n ? v : null;
  } catch { return null; }
}

function renderSummary() {
  const box = $("summary");
  const amt = parsedAmount();
  if (!amt) { box.innerHTML = `<div><span>Enter an amount to see the total</span></div>`; return; }
  const fee = (amt * feeBps) / 10000n;
  const f = (v) => `${trim(ethers.formatUnits(v, current.decimals))} ${current.symbol}`;
  box.innerHTML = `
    <div><span>They receive</span><span>${f(amt)}</span></div>
    <div><span>Sharewood fee (${Number(feeBps) / 100}%)</span><span>${f(fee)}</span></div>
    <div class="total"><span>You pay</span><span>${f(amt + fee)}</span></div>`;
}

const trim = (s) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

// ---------- sending ----------
function setSteps(names, active) {
  const el = $("steps");
  el.classList.remove("hidden");
  el.innerHTML = names.map((n, i) => `<li class="${i < active ? "done" : i === active ? "active" : ""}">${n}</li>`).join("");
}

$("sendForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const status = $("sendStatus");
  status.className = "status";
  status.textContent = "";
  const amt = parsedAmount();
  if (!amt) { status.className = "status err"; status.textContent = "Enter an amount greater than zero."; return; }
  const fee = (amt * feeBps) / 10000n;
  if (current.balance < amt + fee) { status.className = "status err"; status.textContent = `You need ${trim(ethers.formatUnits(amt + fee, current.decimals))} ${current.symbol} including the fee.`; return; }

  const cover = $("coverGas").checked;
  const days = Number($("duration").value);
  const gifts = new ethers.Contract(NET.gifts, GIFTS_ABI, signer);
  const token = new ethers.Contract(current.address, ERC20_ABI, signer);
  const claimKey = ethers.Wallet.createRandom();
  const meta = encodeMeta({ t: $("toName").value.trim(), f: $("fromName").value.trim(), m: $("message").value.trim() });

  const names = ["Approve the token", "Create the gift"];
  if (cover) names.push("Add their network fee");
  $("sendBtn").disabled = true;

  // Save the key before sending, so a closed tab never loses a gift.
  const pending = { key: claimKey.privateKey, meta, symbol: current.symbol, amount: $("amount").value.trim(), to: $("toName").value.trim(), created: Date.now() };
  const list = loadSent();
  list.unshift(pending);
  saveSent(list);

  try {
    setSteps(names, 0);
    const allowance = await token.allowance(account, NET.gifts);
    if (allowance < amt + fee) await (await token.approve(NET.gifts, amt + fee)).wait();

    setSteps(names, 1);
    const tx = await gifts.createGift(current.address, amt, claimKey.address, days * 86400);
    const rcpt = await tx.wait();
    const log = rcpt.logs.map((l) => { try { return gifts.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "GiftCreated");
    const id = log.args.id.toString();
    pending.id = id;
    pending.expiresAt = Number(log.args.expiresAt) * 1000;
    pending.link = `${location.origin}/claim/#${id}.${claimKey.privateKey.slice(2)}.${meta}`;
    saveSent(list);

    if (cover) {
      setSteps(names, 2);
      try {
        await (await signer.sendTransaction({ to: claimKey.address, value: ethers.parseEther(GAS_TOPUP_ETH) })).wait();
      } catch (e) {
        status.textContent = "Gift created. The fee top-up was skipped, so they'll need a little ETH to claim.";
      }
    }
    setSteps(names, names.length);
    showDone(pending.link);
    renderSent();
  } catch (e) {
    status.className = "status err";
    status.textContent = friendlyError(e);
    if (!pending.id) saveSent(loadSent().filter((g) => g.key !== pending.key));
  } finally {
    $("sendBtn").disabled = false;
  }
});

function showDone(link) {
  $("sendForm").classList.add("hidden");
  $("doneStep").classList.remove("hidden");
  $("giftLink").value = link;
  if (!navigator.share) $("shareBtn").classList.add("hidden");
}

$("copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("giftLink").value);
  $("copyBtn").textContent = "Copied";
  setTimeout(() => ($("copyBtn").textContent = "Copy link"), 1800);
});
$("shareBtn").addEventListener("click", () => navigator.share({ title: "A gift for you", text: "I sent you a gift on Sharewood Forest", url: $("giftLink").value }).catch(() => {}));
$("againBtn").addEventListener("click", () => {
  $("doneStep").classList.add("hidden");
  $("sendForm").classList.remove("hidden");
  $("steps").classList.add("hidden");
  $("sendStatus").textContent = "";
  $("amount").value = "";
  onToken();
});

// ---------- sent gifts (this device) ----------
function loadSent() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } }
function saveSent(list) { try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 100))); } catch {} }

async function renderSent() {
  const list = loadSent().filter((g) => g.id);
  if (!list.length || !isLive()) return;
  $("sentSection").classList.remove("hidden");
  const box = $("giftList");
  box.innerHTML = "";
  for (const g of list) {
    const row = document.createElement("div");
    row.className = "gift-item";
    let state = "";
    let canRefund = false;
    try {
      const info = await giftsRead().getGift(g.id);
      const expired = Date.now() / 1000 >= Number(info.expiresAt);
      state = info.settled ? "Claimed or returned" : expired ? "Expired, ready to take back" : `Waiting, expires ${new Date(Number(info.expiresAt) * 1000).toLocaleDateString()}`;
      canRefund = !info.settled && expired;
    } catch { state = "Status unavailable"; }
    row.innerHTML = `<div><strong>${esc(g.amount)} ${esc(g.symbol)}${g.to ? " for " + esc(g.to) : ""}</strong><small>Gift #${g.id}. ${state}</small></div>`;
    const actions = document.createElement("div");
    actions.className = "actions";
    const copy = document.createElement("button");
    copy.className = "btn btn-quiet";
    copy.textContent = "Copy link";
    copy.onclick = () => navigator.clipboard.writeText(g.link).then(() => (copy.textContent = "Copied"));
    actions.append(copy);
    if (canRefund) {
      const rb = document.createElement("button");
      rb.className = "btn btn-quiet";
      rb.textContent = "Take back";
      rb.onclick = async () => {
        try {
          if (!signer) ({ signer, address: account } = await connectWallet());
          rb.disabled = true;
          const tx = await new ethers.Contract(NET.gifts, GIFTS_ABI, signer).refund(g.id);
          await tx.wait();
          rb.textContent = "Returned";
        } catch (e) { alert(friendlyError(e)); rb.disabled = false; }
      };
      actions.append(rb);
    }
    row.append(actions);
    box.append(row);
  }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

renderTag();
renderSummary();
renderSent();

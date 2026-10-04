/* =============================================================
 *  app.js —— 页面主逻辑
 *  读法：init() → 绑定事件 → 加载数据 → 渲染
 * ============================================================= */

const C = window.BDAY_CONFIG;
const $ = (id) => document.getElementById(id);

/* ---------------- 小工具 ---------------- */
const CARD_COLORS = ["#B9210C", "#8A1608", "#C9822F", "#4A6FA5", "#8A6D3B", "#5B4A36"];

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function timeAgo(ts) {
  const d = new Date(ts), diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

/* ---------------- 1. 填充个人信息 ---------------- */
function applyProfile() {
  $("heroName").textContent = C.name;
  $("brandName").textContent = `${C.name} 的生日小站`;
  $("footerName").textContent = C.name;
  $("heroSub").textContent = C.subtitle || "";

  const [mm, dd] = String(C.birthday).split("-").map(Number);
  $("heroKicker").textContent = `${mm} 月 ${dd} 日 · 我的生日`;
  document.title = `${C.name} 的生日小站 🎂`;

  if (C.avatar) {
    const img = $("avatarImg");
    img.src = C.avatar; img.hidden = false;
    $("avatarFallback").hidden = true;
  }
}

/* ---------------- 2. 倒计时 ---------------- */
function nextBirthday(now) {
  const y = now.getFullYear();
  const [mm, dd] = String(C.birthday).split("-").map(Number);
  const thisYear = new Date(y, mm - 1, dd, 0, 0, 0);
  if (now < thisYear) return thisYear;
  const endOfDay = new Date(y, mm - 1, dd + 1, 0, 0, 0);
  if (now < endOfDay) return endOfDay;   // 生日当天：倒计时到今天结束
  return new Date(y + 1, mm - 1, dd, 0, 0, 0);
}

function isBirthdayToday(now) {
  const [mm, dd] = String(C.birthday).split("-").map(Number);
  return now.getMonth() === mm - 1 && now.getDate() === dd;
}

function tickCountdown() {
  const now = new Date();
  const target = nextBirthday(now);
  let ms = target - now;

  const today = isBirthdayToday(now);
  $("countdown").classList.toggle("is-today", today);
  $("countdownNote").textContent = today
    ? "🎂 今天就是我的生日！生日还剩"
    : `距离 ${target.getFullYear()} 年生日还有`;

  const s = Math.max(0, Math.floor(ms / 1000));
  const day = Math.floor(s / 86400);
  $("cdDay").textContent  = day;
  $("cdHour").textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  $("cdMin").textContent  = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  $("cdSec").textContent  = String(s % 60).padStart(2, "0");

  if (C.birthYear && !today) {
    $("heroKicker").textContent =
      `第 ${target.getFullYear() - C.birthYear} 个生日 · ${target.getMonth() + 1} 月 ${target.getDate()} 日`;
  }
}

/* ---------------- 3. 蛋糕蜡烛 ---------------- */
const SLOT_N = 19;                 // 蛋糕上画几根蜡烛 = 年龄（真实点亮数仍以数字为准）
const slots = [];

function buildCandles() {
  const g = $("candleGroup");
  g.innerHTML = "";
  slots.length = 0;
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  // 蜡烛根数多的时候自动收窄，保证都排得进蛋糕顶层
  const SPAN = 128;                                   // 顶层可插区域宽度
  const CW = SLOT_N > 14 ? 5 : 6;                     // 单根蜡烛宽度
  const step = SPAN / SLOT_N;
  const startX = 96 + step / 2;                       // 居中排布

  for (let i = 0; i < SLOT_N; i++) {
    const cx = startX + i * step;
    const wrap = mk("g", { class: "candle", transform: `translate(${cx},62)` });
    wrap.appendChild(mk("circle", { class: "halo", cx: 0, cy: -44, r: CW > 5 ? 12 : 9, fill: "url(#flameGlow)" }));
    wrap.appendChild(mk("rect", { class: "body", x: -CW / 2, y: -32, width: CW, height: 32, rx: CW / 2 }));
    wrap.appendChild(mk("rect", { class: "stripe", x: -CW / 2, y: -23, width: CW, height: 3.5, rx: 1.5 }));
    wrap.appendChild(mk("rect", { class: "stripe", x: -CW / 2, y: -14, width: CW, height: 3.5, rx: 1.5 }));
    wrap.appendChild(mk("line", { class: "wick", x1: 0, y1: -32, x2: 0, y2: -36 }));

    const flamePos = mk("g", { transform: "translate(0,-36)" }); // 外层只负责定位
    const flame = mk("g", { class: "flame" });                   // 内层才做缩放动画
    flame.appendChild(mk("ellipse", { cx: 0, cy: -6.5, rx: CW > 5 ? 4.2 : 3.5, ry: CW > 5 ? 7.5 : 6.5, fill: "#FF9800" }));
    flame.appendChild(mk("ellipse", { cx: 0, cy: -4.2, rx: CW > 5 ? 2 : 1.7, ry: CW > 5 ? 4.5 : 3.8, fill: "#FFE082" }));
    // 吹灭后升起的一缕烟（默认透明，.out 时才播动画）
    flamePos.appendChild(mk("path", {
      class: "smoke",
      d: "M0,-2 c -3,-6 3,-10 0,-16 c -3,-6 3,-9 0,-14",
      fill: "none", stroke: "#C9BFB4", "stroke-width": 2, "stroke-linecap": "round",
    }));
    flamePos.appendChild(flame);
    wrap.appendChild(flamePos);

    g.appendChild(wrap);
    slots.push(wrap);
  }
}

function renderCandles(count) {
  const lit = Math.min(count, SLOT_N);
  slots.forEach((el, i) => el.classList.toggle("lit", i < lit));
  const b = $("candleCount");
  if (b.textContent !== String(count)) {
    b.textContent = count;
    b.animate([{ transform: "scale(1)" }, { transform: "scale(1.22)" }, { transform: "scale(1)" }], { duration: 420 });
  }
}

let blowLocked = false;   // 吹过蜡烛后就不要再被轮询重新点亮

function renderCandleState(candles) {
  if (!blowLocked) renderCandles(candles.count);
  const btn = $("lightBtn"), txt = $("lightBtnText");
  btn.classList.toggle("lit", candles.mine);
  btn.disabled = candles.mine;
  txt.textContent = candles.mine ? "你已经点亮过啦 ✓" : "点亮一根蜡烛";
  $("candleTip").textContent = candles.mine
    ? "谢谢你点亮的这根蜡烛 🕯️ 明年见～"
    : "你还没点亮哦，点一下试试～";
}

/* ---------------- 4. 祝福墙 ---------------- */
let renderedIds = new Set();

function renderWall(messages) {
  const wall = $("wall"), empty = $("wallEmpty");
  $("wallCount").textContent = messages.length;
  empty.hidden = messages.length > 0;

  // 只追加新留言，避免整墙闪烁重排
  // 倒序遍历 + prepend：最新的排在最前面
  messages.slice().reverse().forEach((m, idx) => {
    const id = String(m.id);
    if (renderedIds.has(id)) return;
    renderedIds.add(id);

    const card = document.createElement("div");
    card.className = "wish-card" + (m.visitor_id && m.visitor_id === Store.visitorId() ? " mine" : "");
    card.style.setProperty("--accent", CARD_COLORS[idx % CARD_COLORS.length]);
    card.dataset.id = id;

    const who = document.createElement("div");
    who.className = "who";
    who.textContent = m.name || "匿名好友";
    const when = document.createElement("em");
    when.textContent = timeAgo(m.created_at);
    who.appendChild(when);

    const txt = document.createElement("p");
    txt.className = "txt";
    txt.textContent = m.text;

    card.append(who, txt);
    if (card.classList.contains("mine")) {
      const tag = document.createElement("span");
      tag.className = "tag"; tag.textContent = "我写的";
      who.insertBefore(tag, when);
    }
    wall.prepend(card); // 新的在最前
  });

  // 清理已删除的（理论上不会，保险起见）
  const alive = new Set(messages.map((m) => String(m.id)));
  wall.querySelectorAll(".wish-card").forEach((el) => {
    if (!alive.has(el.dataset.id)) { el.remove(); renderedIds.delete(el.dataset.id); }
  });
}

/* ---------------- 5. 弹窗 ---------------- */
let pendingUnlock = false;   // 送完祝福 → 关掉回礼弹窗后再解锁游戏

function openModal(id) { $(id).hidden = false; }
function closeModal(id) {
  const m = $(id);
  if (!m) return;
  m.hidden = true;
  // 关掉「回礼祝福」弹窗后再解锁并滚到游戏区，避免弹窗和滚动打架
  if (id === "giftModal" && pendingUnlock) {
    pendingUnlock = false;
    unlockGame();
  }
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-close]");
  if (btn) { closeModal(btn.closest(".modal").id); return; }
  if (e.target.classList.contains("modal")) closeModal(e.target.id);
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal:not([hidden])").forEach((m) => closeModal(m.id));
  }
});

/* ---------------- 6. 交互：提交祝福 ---------------- */
async function submitWish(e) {
  e.preventDefault();
  const name = $("wishName").value.trim().slice(0, 20);
  const text = $("wishText").value.trim();
  const btn = $("submitBtn");

  if (!text) { toast("写点什么再送出去吧～"); $("wishText").focus(); return; }
  if (text.length > 140) { toast("最多 140 个字哦"); return; }

  btn.disabled = true;
  btn.textContent = "送出中…";
  try {
    const row = await Store.addMessage({ name: name || "匿名好友", text });
    if (row && row.visitor_id == null) row.visitor_id = Store.visitorId();
    if (row) renderWall([row]);
    await refresh();

    Confetti.burst(120);
    showGift();
    if (C.game.unlockAfterWish && !gameUnlocked) pendingUnlock = true;
    $("wishText").value = "";
    $("charCount").textContent = "0";
  } catch (err) {
    console.error(err);
    toast("发送失败了，稍后再试一次？");
  } finally {
    btn.disabled = false;
    btn.textContent = "送出祝福 🎁";
  }
}

function showGift() {
  const pool = C.giftMessages.length ? C.giftMessages : ["谢谢你来！"];
  $("giftText").textContent = pool[(Math.random() * pool.length) | 0];
  openModal("giftModal");
}

/* ---------------- 7. 交互：点蜡烛 ---------------- */
async function lightCandle() {
  const btn = $("lightBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const before = Number($("candleCount").textContent) || 0;
    const r = await Store.lightCandle();
    renderCandleState(r);
    const rect = $("cakeStage").getBoundingClientRect();
    Confetti.burst(90, rect.left + rect.width / 2, rect.top + rect.height * 0.3);
    toast(r.count > before ? `第 ${r.count} 根蜡烛点亮啦 🎉` : "蜡烛已点亮 🕯️");
  } catch {
    toast("点亮失败了，再点一下？");
    btn.disabled = false;
  }
}

/* ---------------- 8. 彩蛋：连点头像 ---------------- */
let taps = [], eggShown = false;
function onAvatarTap() {
  const btn = $("avatar");
  btn.classList.remove("tapped");
  void btn.offsetWidth;
  btn.classList.add("tapped");

  const now = Date.now();
  taps = taps.filter((t) => now - t < C.easterEgg.windowMs);
  taps.push(now);

  const need = C.easterEgg.clicks;
  if (taps.length >= need - 1 && taps.length < need) toast(`再点 ${need - taps.length} 下… 👀`);

  if (taps.length >= need) {
    taps = [];
    if (eggShown) { Confetti.burst(80); return; }
    eggShown = true;
    $("eggTitle").textContent = C.easterEgg.title;
    $("eggText").textContent = C.easterEgg.text;
    openModal("eggModal");
    Confetti.rain(4);
  }
}

/* ---------------- 9. 小游戏：接礼物 ---------------- */
let gameUnlocked = false, lastResult = null;

function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

/** 是否写过祝福：优先看留言里有没有自己的 visitor_id（换设备也认），再退到本地标记 */
function hasWished(messages) {
  if (!C.game.unlockAfterWish) return true;
  if (lsGet("bday_unlocked") === "1") return true;
  return (messages || []).some((m) => m.visitor_id && m.visitor_id === Store.visitorId());
}

function setUnlocked(on, scroll) {
  gameUnlocked = on;
  $("gameLock").hidden = on;
  $("gameBody").hidden = !on;
  if (on) {
    CatchGame.mount();
    if (scroll) scrollToEl($("gameSection"));
  }
}

function unlockGame() {
  if (gameUnlocked) return;
  lsSet("bday_unlocked", "1");
  setUnlocked(true, true);
  setTimeout(() => toast("游戏解锁啦！30 秒接礼物 🎁"), 800);
}

/** 平滑滚动 + 落点校正（最多补 3 次，防止 smooth 过程中高度变化导致错位） */
function scrollToEl(el, tries = 3) {
  if (!el) return;
  if (typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  let n = 0;
  const fix = () => {
    const r = el.getBoundingClientRect();
    const off = r.top + r.height / 2 - innerHeight / 2;
    if (Math.abs(off) > 14 && n++ < tries) {
      if (typeof scrollBy === "function") scrollBy({ top: off, behavior: "smooth" });
      setTimeout(fix, 450);
    }
  };
  setTimeout(fix, 450);
}

function startGame() {
  if (CatchGame.running) return;
  const btn = $("gameStartBtn");
  btn.disabled = true;
  btn.textContent = "游戏中…";
  btn.blur();
  CatchGame.start(onGameEnd);
}

function onGameEnd(r) {
  lastResult = r;
  const btn = $("gameStartBtn");
  btn.disabled = false;
  btn.textContent = "再接一次 🔁";

  // 没有分数、没有评级 —— 只有"收到了多少份好运"和一句温暖的结语
  const n = r.words ? r.words.length : r.caught;
  const ending = (C.game.endings || []).find((x) => n >= x.min)
    || { emoji: "💛", text: "愿你今年一切都好 💛" };

  // 收到的祝福去重后最多展示 5 条
  const shown = [...new Set(r.words || [])].slice(0, 5);
  const list = shown.length ? shown.map((w) => "· " + w).join("\n") + "\n\n" : "";

  $("gameEmoji").textContent = ending.emoji;
  $("gameTitle").textContent = n > 0 ? `收到了 ${n} 份好运` : "礼物都漏光啦";
  $("gameText").textContent = list + ending.text;
  openModal("gameModal");
  if (n >= 8) Confetti.burst(130);
}

function scoreToWish() {
  if (!lastResult) return;
  closeModal("gameModal");
  const n = lastResult.words ? lastResult.words.length : lastResult.caught;
  // 从多条模板里随机抽一条，让祝福墙不再千篇一律
  const pool = (C.game.wishTemplates && C.game.wishTemplates.length)
    ? C.game.wishTemplates
    : [C.game.wishTemplate || "我接住了 {n} 份好运，全都送给你 🎁"];
  const tpl = pool[(Math.random() * pool.length) | 0];
  const line = tpl.replace(/\{n\}/g, n);
  const ta = $("wishText");
  const merged = ta.value.trim() ? ta.value.replace(/\s+$/, "") + "\n" + line : line;
  ta.value = merged.slice(0, 140);
  ta.dispatchEvent(new Event("input", { bubbles: true }));

  scrollToEl($("wishForm").closest("section"));
  setTimeout(() => { try { ta.focus({ preventScroll: true }); } catch (e) {} }, 650);
  toast("好运填进祝福框啦，改改就能送 ✍️");
}

/* ---------------- 10. 吹蜡烛（生日当天的仪式） ---------------- */
function setupBlow() {
  const box = $("blowBox");
  const show = C.blow.alwaysAvailable || isBirthdayToday(new Date());
  box.hidden = !show;
  if (!show) return;

  $("blowTitle").textContent = C.blow.title;
  $("blowText").textContent = C.blow.text;
  $("blowHint").textContent = C.blow.hint;

  const btn = $("blowBtn");

  btn.addEventListener("click", async () => {
    if (BlowCandles.blowing) return;
    blowLocked = true;                    // 吹灭后别再被数据轮询点亮
    btn.classList.add("blowing");
    btn.textContent = "💨 吹 ——";
    await BlowCandles.start();
  });

  // 长按：按住持续吹灭（麦克风模式下同时按住也有效）
  btn.addEventListener("pointerdown", () => { if (BlowCandles.blowing) BlowCandles.holdDown(); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => {
    btn.addEventListener(ev, () => BlowCandles.holdUp());
  });

  document.addEventListener("blow:mode", (e) => {
    $("blowHint").textContent = e.detail.mic
      ? "对着手机吹一口气～ 也可以长按按钮"
      : "麦克风用不了，长按按钮来吹吧";
  });
  document.addEventListener("blow:fallback", () => {
    $("blowHint").textContent = "长按按钮来吹吧 💨";
  });
  document.addEventListener("blow:puff", () => {
    const n = BlowCandles.remain();
    if (n > 0) btn.textContent = `💨 还剩 ${n} 根`;
  });

  BlowCandles.onFinish(() => {
    btn.classList.remove("blowing");
    btn.textContent = "🎂 再吹一次";
    Confetti.burst(140);
    openModal("blowModal");
  });
}

/* ---------------- 11. 数据刷新 ---------------- */
let lastCandleCount = 0;

async function refresh() {
  const [messages, candles] = await Promise.all([Store.getMessages(), Store.getCandles()]);
  renderWall(messages);
  renderCandleState(candles);
  if (!gameUnlocked && hasWished(messages)) setUnlocked(true);
  lastCandleCount = candles.count;
  return { messages, candles };
}

/* ---------------- 启动 ---------------- */
async function init() {
  applyProfile();
  buildCandles();

  tickCountdown();
  setInterval(tickCountdown, 1000);

  // 数据模式只在控制台提示，不显示给访客（配置方法见 README / js/config.js）
  const mode = await Store.init();
  if (mode !== "supabase") {
    console.warn("[生日小站] 当前是本地模式，数据只存在这个浏览器里。接云端的方法见 README.md 或 js/config.js");
  }

  const { messages, candles } = await refresh();
  lastCandleCount = candles.count;

  if (isBirthdayToday(new Date())) Confetti.rain(2.5);

  // 事件绑定
  $("wishForm").addEventListener("submit", submitWish);
  $("wishText").addEventListener("input", (e) => ($("charCount").textContent = e.target.value.length));
  $("avatar").addEventListener("click", onAvatarTap);
  $("lightBtn").addEventListener("click", lightCandle);

  // 小游戏
  CatchGame.init();
  if (window.Scratch) Scratch.init();
  if (!C.game.unlockAfterWish) setUnlocked(true);
  $("gameStartBtn").addEventListener("click", startGame);
  $("goWriteBtn").addEventListener("click", () => {
    scrollToEl($("wishForm").closest("section"));
    setTimeout(() => { try { $("wishText").focus({ preventScroll: true }); } catch (e) {} }, 650);
  });
  $("gameToWish").addEventListener("click", scoreToWish);
  $("gameAgain").addEventListener("click", () => { closeModal("gameModal"); startGame(); });

  setupBlow();

  const songBtn = $("songBtn");
  if (C.features.music) {
    songBtn.addEventListener("click", () => {
      const on = Music.toggle();
      songBtn.classList.toggle("on", on);
      songBtn.title = on ? "关掉音乐" : "播放生日音乐";
    });
    document.addEventListener("music:end", () => songBtn.classList.remove("on"));
    document.addEventListener("music:fallback", () => toast("音频没加载成功，换成内置合成版啦 🎹"));
  } else {
    songBtn.hidden = true;
  }

  // 轮询别人新写的祝福
  Store.onChange(({ messages, candles }) => {
    renderWall(messages);
    renderCandleState(candles);
    lastCandleCount = candles.count;
  });

  document.addEventListener("store:fallback", () => {
    console.warn("[生日小站] 云端连接失败，已降级为本地模式");
  });
}

document.addEventListener("DOMContentLoaded", init);

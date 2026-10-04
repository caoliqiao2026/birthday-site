/* =============================================================
 *  scratch.js —— 刮刮乐小游戏
 *  设计约束（和接礼物一致）：
 *    - 纯点触/拖动，Pointer Events 统一鼠标与触摸，不依赖键盘
 *    - canvas 上的刮痕用 destination-out 擦除银层，露出底下的奖品
 *    - 刮开超过阈值（默认 50%）自动揭晓；也提供「直接揭晓」兜底
 *    - 刮出来的结果可「发到祝福墙」，让墙上祝福更多样
 *  稳健性要点（真机才暴露的坑都在这里）：
 *    - 首屏 rAF 拿尺寸不一定准（卡片在视口外/布局未完成）→ 用
 *      IntersectionObserver 进视口再初始化，ResizeObserver 尺寸变化重绘
 *    - 手势绑到 window 级、不依赖 setPointerCapture：移动端手指移出
 *      卡片范围也能继续刮，避免微信 X5 内核 capture 失效导致断触
 * ============================================================= */

const Scratch = (() => {
  const cfg = () => window.BDAY_CONFIG.scratch || { enabled: false, categories: [] };

  let canvas, ctx, revealEl, tagEl, textEl, shareBtn, againBtn, revealBtn, section;
  let W = 0, H = 0, dpr = 1;
  let scratching = false, lastX = 0, lastY = 0, moveCount = 0, revealed = false;
  let prize = null, revealTimer = null, sized = false, inited = false;

  /* ---------- 选奖品：先按权重挑类别，再随机挑一条 ---------- */
  function pickPrize() {
    const cats = (cfg().categories || []).filter((c) => (c.items || []).length);
    if (!cats.length) return { key: "bless", label: "祝福", emoji: "💛", text: "生日快乐！" };
    const total = cats.reduce((s, c) => s + (c.weight || 1), 0);
    let r = Math.random() * total, cat = cats[0];
    for (const c of cats) { if ((r -= (c.weight || 1)) <= 0) { cat = c; break; } }
    const items = cat.items;
    return { key: cat.key, label: cat.label, emoji: cat.emoji, text: items[(Math.random() * items.length) | 0] };
  }

  /* ---------- 尺寸 / 重绘银层 ---------- */
  function resize() {
    if (!canvas || !ctx) return;
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 10 || h < 10) return;          // 还没布局好，等 IO/RO 再来
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = w; H = h;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintFoil();
    sized = true;
  }

  function paintFoil() {
    if (!ctx) return;
    // 砖红涂层（Cafe Harmony 主色），配奶油色斜纹
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#C63A1B");
    g.addColorStop(0.5, "#B9210C");
    g.addColorStop(1, "#9E1B08");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 斜纹质感
    ctx.strokeStyle = "rgba(255,248,238,.16)";
    ctx.lineWidth = 2;
    for (let x = -H; x < W; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke();
    }

    // 提示文字（奶油色）
    ctx.fillStyle = "rgba(253,248,236,.92)";
    ctx.font = '600 16px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("👆 用手指刮开我", W / 2, H / 2 - 9);
    ctx.font = '13px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = "rgba(253,248,236,.6)";
    ctx.fillText("刮出今天的专属好运 / 任务 / 彩蛋", W / 2, H / 2 + 14);
  }

  /* ---------- 刮痕 ---------- */
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function scratchDot(x, y) {
    if (!ctx) return;
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  function scratchLine(x0, y0, x1, y1) {
    if (!ctx) return;
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 50; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  /* 采样透明像素比例，超过阈值就揭晓（节流，别每次 move 都算） */
  function checkReveal() {
    if (revealed || !ctx) return;
    let clear = 0, total = 0;
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4 * 40) { total++; if (data[i] === 0) clear++; }
    } catch (e) { return; }
    if (total && clear / total > (cfg().threshold || 0.5)) reveal();
  }

  function reveal() {
    if (revealed) return;
    // 兜底：万一奖品还没填充（初始化被跳过），先补上再揭晓，保证「直接揭晓」永远有内容
    if (!prize || !tagEl.textContent) {
      prize = pickPrize();
      tagEl.textContent = `${prize.emoji} ${prize.label}`;
      tagEl.className = "scratch-tag cat-" + prize.key;
      textEl.textContent = prize.text;
    }
    revealed = true;
    canvas.style.transition = "opacity .4s ease";
    canvas.style.opacity = "0";
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => { canvas.style.visibility = "hidden"; }, 420);
    revealEl.hidden = false;
    revealEl.className = "scratch-prize revealed";   // 揭晓态：显示「发到祝福墙 / 再刮一张」
    if (window.Confetti && Confetti.burst) Confetti.burst(70);
  }

  /* 进入交互时确保尺寸正确（content-visibility:auto 下首屏可能拿到 0 尺寸） */
  function ensureSized() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (!sized || r.width < 10 || r.height < 10 ||
        Math.abs(r.width - W) > 2 || Math.abs(r.height - H) > 2) {
      resize();
    }
  }

  /* ---------- 输入（手势绑到 window 级，移动端手指移出卡片也能继续刮） ---------- */
  function onDown(e) {
    if (revealed) return;
    // 桌面鼠标按住拖动会触发「把 canvas 当图片原生拖拽」，打断 pointer 序列 → 看似卡住。
    // 关掉原生拖拽 + 阻止默认，鼠标才能正常刮。
    if (e.cancelable) e.preventDefault();
    if (e.pointerId !== undefined) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
    ensureSized();
    scratching = true;
    const [x, y] = pos(e); lastX = x; lastY = y;
    scratchDot(x, y);
  }
  function onMove(e) {
    if (!scratching || revealed) return;
    const [x, y] = pos(e);
    scratchLine(lastX, lastY, x, y);
    lastX = x; lastY = y;
    if ((++moveCount % 4) === 0) checkReveal();
  }
  function onUp() {
    if (scratching) { scratching = false; checkReveal(); }
  }
  function bindInput() {
    if (!canvas) return;
    canvas.addEventListener("pointerdown", onDown);
    // window 级：即使手指滑出卡片也不丢手势（微信 X5 的 setPointerCapture 不完全可靠）
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /* ---------- 一张新卡 ---------- */
  function setupCard() {
    prize = pickPrize();
    tagEl.textContent = `${prize.emoji} ${prize.label}`;
    tagEl.className = "scratch-tag cat-" + prize.key;
    textEl.textContent = prize.text;
    revealEl.hidden = false;                    // 奖品必须可见，垫在银层下，刮开才看得到
    revealEl.className = "scratch-prize";       // 「发祝福/再刮」按钮等揭晓后再出现
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    canvas.style.visibility = "visible";
    canvas.style.opacity = "1";
    canvas.style.transition = "none";
    revealed = false; moveCount = 0;
    resize();   // 顺便重绘银层
  }

  /* 把刮到的内容填进祝福框（让墙上祝福更多样） */
  function shareToWall() {
    if (!prize) return;
    const ta = document.getElementById("wishText");
    if (!ta) return;
    const text = prize.text.replace(/\s+$/, "");
    const cur = ta.value.replace(/\s+$/, "");
    ta.value = (cur ? cur + "\n" : "") + text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const sec = ta.closest("section");
    if (sec && typeof sec.scrollIntoView === "function") sec.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => { try { ta.focus({ preventScroll: true }); } catch (_) {} }, 650);
    if (typeof toast === "function") toast("已经填进祝福框啦，改改就能送 ✍️");
  }

  return {
    init() {
      if (inited) return;          // 防重复初始化（自启动 + app.js 调用只生效一次）
      inited = true;
      canvas = document.getElementById("scratchCanvas");
      if (!canvas) return;
      try {
        ctx = canvas.getContext("2d", { willReadFrequently: true });
      } catch (e) { ctx = null; }
      if (!ctx) return;

      section   = document.getElementById("scratchSection");
      revealEl  = document.getElementById("scratchPrize");
      tagEl     = document.getElementById("scratchTag");
      textEl    = document.getElementById("scratchText");
      shareBtn  = document.getElementById("scratchShare");
      againBtn  = document.getElementById("scratchAgain");
      revealBtn = document.getElementById("scratchRevealBtn");

      if (againBtn)  againBtn.addEventListener("click", setupCard);
      if (shareBtn)  shareBtn.addEventListener("click", shareToWall);
      if (revealBtn) revealBtn.addEventListener("click", reveal);

      bindInput();

      // 桌面浏览器：canvas 默认可被当成图片拖拽，关掉它（否则鼠标拖会"卡住"）
      try { canvas.draggable = false; } catch (_) {}
      canvas.addEventListener("dragstart", (e) => { if (e.preventDefault) e.preventDefault(); });

      // 首屏先试一次（卡片若已布局好就直接发一张可刮的卡）
      requestAnimationFrame(() => { if (!sized) setupCard(); });

      // 尺寸变化（布局完成、横竖屏切换）时重绘银层；正在刮就不打扰
      if (window.ResizeObserver) {
        new window.ResizeObserver(() => {
          if (!revealed && !scratching) { if (!sized) setupCard(); else resize(); }
        }).observe(canvas);
      }

      // 进入视口再确保初始化一次，规避"首屏拿到 0 尺寸"导致刮不动
      // 注意：content-visibility:auto 下首屏尺寸可能仍为 0，必须等到 sized 才断开观察
      if (window.IntersectionObserver && section) {
        const io = new window.IntersectionObserver((entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              requestAnimationFrame(() => {
                if (!sized) setupCard();
                if (sized) io.disconnect();
              });
            }
          });
        }, { threshold: 0.08 });
        io.observe(section);
      }

      window.addEventListener("resize", () => {
        if (!revealed && !scratching) { if (!sized) setupCard(); else resize(); }
      });
    },
  };
})();

/* 关键修复：const 声明不会挂到 window 上，而 app.js 检查的是 window.Scratch。
 * 必须显式挂载，否则 Scratch.init() 永远不会被调用（卡片全空、按钮无反应）。 */
window.Scratch = Scratch;

/* 自主启动：即使 app.js 初始化链条上某一步抛错，刮刮乐也能独立工作 */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { try { Scratch.init(); } catch (e) { console.warn("scratch init:", e); } });
} else {
  try { Scratch.init(); } catch (e) { console.warn("scratch init:", e); }
}

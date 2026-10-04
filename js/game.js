/* =============================================================
 *  game.js —— 接礼物小游戏
 *  设计约束：
 *    - 纯点触/拖动，完全不依赖键盘（微信内置浏览器、iframe 预览里键盘不可靠）
 *    - 手机上单手拇指可玩，篮子跟随手指
 *    - 不在视口内 / 游戏结束就停掉 rAF，不空转烧 CPU
 *    - DPR 适配，高分屏不糊
 * ============================================================= */

const CatchGame = (() => {
  const cfg = () => window.BDAY_CONFIG.game || {};

  let canvas, ctx;
  let W = 0, H = 0, dpr = 1;
  let raf = null, running = false, visible = false;
  let items = [], pops = [], floaters = [];
  let basket = { x: 0, y: 0, w: 88, h: 30 };
  let caught = 0, missed = 0;
  let collected = [];        // 收到的祝福（一句一句攒起来）
  let pool = [];             // 本局打乱后的祝福池
  let spawnAcc = 0, timeLeft = 0, lastTs = 0, idleAcc = 0;
  let onEnd = null, dragging = false;
  let audioCtx = null;

  /** 祝福池：game.blessings 为空时复用 giftMessages */
  function blessingPool() {
    const g = (cfg().blessings || []).filter(Boolean);
    if (g.length) return g;
    return (window.BDAY_CONFIG.giftMessages || []).length
      ? window.BDAY_CONFIG.giftMessages
      : ["谢谢你来，愿你今年一切都好 💛"];
  }

  function shuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    if (!canvas || !ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(240, Math.round(r.width));
    H = Math.max(180, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    basket.w = Math.max(62, Math.min(104, W * 0.22));
    basket.h = Math.round(basket.w * 0.34);
    basket.y = H - basket.h - 14;
    basket.x = Math.max(0, Math.min(W - basket.w, basket.x || (W - basket.w) / 2));
  }

  /* ---------- 音效（接住时叮一声） ---------- */
  function ding(freq) {
    if (!cfg().sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(0.07, audioCtx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, audioCtx.currentTime + 0.16);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.18);
    } catch (e) {}
  }

  /* ---------- 掉落物 ---------- */
  function pickType() {
    const types = cfg().types;
    const total = types.reduce((s, t) => s + t.w, 0);
    let r = Math.random() * total;
    for (const t of types) { if ((r -= t.w) <= 0) return t; }
    return types[0];
  }

  function spawn(progress) {
    const t = pickType();
    const size = t.big ? 34 : 28;
    items.push({
      x: Math.random() * (W - size) + size / 2,
      y: -size,
      size,
      emoji: t.e,
      pts: t.s,
      vy: cfg().speedFrom + (cfg().speedTo - cfg().speedFrom) * progress,
      rot: (Math.random() - 0.5) * 0.5,
      rotV: (Math.random() - 0.5) * 2.2,
      sway: Math.random() * Math.PI * 2,
      swayV: 1.2 + Math.random() * 1.4,
    });
  }

  /* ---------- 主循环 ---------- */
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
    lastTs = ts;

    if (running) {
      timeLeft -= dt;
      const total = cfg().seconds;
      const progress = 1 - Math.max(0, timeLeft) / total;

      spawnAcc += dt;
      const gap = (cfg().gapFrom + (cfg().gapTo - cfg().gapFrom) * progress) / 1000;
      if (spawnAcc >= gap) { spawnAcc = 0; spawn(progress); }

      for (const it of items) {
        it.y += it.vy * dt;
        it.rot += it.rotV * dt;
        it.sway += it.swayV * dt;
        it.x += Math.sin(it.sway) * 22 * dt;
        it.x = Math.max(it.size / 2, Math.min(W - it.size / 2, it.x));
      }

      // 碰撞检测
      for (const it of items) {
        if (it.dead) continue;
        const r = it.size / 2;
        if (it.y + r >= basket.y && it.y - r <= basket.y + basket.h) {
          const cx = it.x;
          if (cx >= basket.x - r * 0.4 && cx <= basket.x + basket.w + r * 0.4) {
            it.dead = true;
            caught++;
            // 接住一个 = 收到一句祝福（池子循环取，打乱过所以不重样）
            const words = pool[collected.length % pool.length];
            collected.push(words);
            burst(cx, basket.y, it.emoji);
            floatText(words);
            ding(520 + Math.min(caught, 12) * 35);
            updateHud();
          }
        }
        if (!it.dead && it.y - r > H) { it.dead = true; missed++; }
      }
      items = items.filter((i) => !i.dead);
      for (const p of pops) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; }
      pops = pops.filter((p) => p.t < p.life);
      for (const f of floaters) { f.t += dt; }
      floaters = floaters.filter((f) => f.t < f.life);

      draw();
      if (timeLeft <= 0) finish();
    } else {
      // 空闲帧降频到 ~20fps，别白烧 CPU
      idleAcc += dt;
      if (idleAcc < 0.05) return;
      idleAcc = 0;
      draw();
    }
  }

  /** 接住时从篮子上方飘出的一句祝福 */
  function floatText(msg) {
    floaters.push({ msg, t: 0, life: 1.6, y: basket.y - 16 });
    if (floaters.length > 2) floaters.shift();
  }

  function burst(x, y, emoji) {
    for (let i = 0; i < 7; i++) {
      pops.push({
        x, y, t: 0, life: 0.55,
        vx: (Math.random() - 0.5) * 220,
        vy: -120 - Math.random() * 140,
        r: 2 + Math.random() * 3,
        c: ["#B9210C", "#F9D991", "#C9DDF5", "#E4572E", "#8A1608"][(Math.random() * 5) | 0],
      });
    }
    pops.push({ x, y, t: 0, life: 0.7, vx: 0, vy: -90, text: emoji, r: 14 });
  }

  /* ---------- 绘制 ---------- */
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // 地面
    ctx.fillStyle = "#E3DAC3";
    ctx.fillRect(0, H - 8, W, 8);

    // 掉落物
    for (const it of items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.rot);
      ctx.font = `${it.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.emoji, 0, 0);
      ctx.restore();
    }

    // 粒子
    for (const p of pops) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      if (p.text) {
        ctx.font = `${p.r}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    drawBasket();

    drawFloaters();

    if (!running) {
      ctx.fillStyle = "#9C8A74";
      ctx.font = '13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("点下面的按钮，礼物就要掉下来啦 🎁", W / 2, H / 2 - 10);
    }
  }

  /** 飘出来的祝福语：居中、向上飘、淡出；太长会自动缩字号以免出界 */
  function drawFloaters() {
    floaters.forEach((f, i) => {
      const k = f.t / f.life;
      const alpha = Math.max(0, Math.min(1, (1 - k) * 2.2));
      if (alpha <= 0) return;
      ctx.save();

      let size = 14;
      ctx.font = `600 ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
      while (ctx.measureText(f.msg).width > W - 28 && size > 10) {
        size -= 1;
        ctx.font = `600 ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
      }
      const w = ctx.measureText(f.msg).width;
      const y = f.y - k * 46 - i * 4;

      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.globalAlpha = alpha * 0.9;              // 奶油色小气泡
      ctx.fillStyle = "#FBF8EE";
      ctx.fillRect(W / 2 - w / 2 - 9, y - size - 6, w + 18, size + 12);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#B9210C";
      ctx.fillText(f.msg, W / 2, y);

      ctx.restore();
    });
  }

  function drawBasket() {
    const { x, y, w, h } = basket;
    ctx.save();
    // 篮身（上宽下窄的梯形）
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - 9, y + h);
    ctx.lineTo(x + 9, y + h);
    ctx.closePath();
    ctx.fillStyle = "#B9210C";
    ctx.fill();
    // 编织纹理
    ctx.strokeStyle = "rgba(255,255,255,.45)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      ctx.beginPath();
      ctx.moveTo(x + 9 * t + (w - 18) * t * 0 + w * t, y + 2);
      ctx.lineTo(x + 9 * t + w * t - 9 * t, y + h - 2);
      ctx.stroke();
    }
    // 篮沿
    ctx.fillStyle = "#C9B48A";
    ctx.fillRect(x - 5, y - 5, w + 10, 8);
    ctx.restore();
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    document.getElementById("gBless").textContent = collected.length;
  }

  function tickTime() {
    document.getElementById("gTime").textContent = Math.max(0, Math.ceil(timeLeft));
  }

  /* ---------- 输入 ---------- */
  function setBasketFromEvent(clientX) {
    const r = canvas.getBoundingClientRect();
    basket.x = Math.max(0, Math.min(W - basket.w, clientX - r.left - basket.w / 2));
  }

  function bindInput() {
    const move = (e) => {
      // 触摸时必须按住才跟随；鼠标直接跟随
      if (e.pointerType === "touch" && !dragging) return;
      setBasketFromEvent(e.clientX);
      if (!running) draw();
    };
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      canvas.classList.add("playing");
      if (canvas.setPointerCapture && e.pointerId != null) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
      setBasketFromEvent(e.clientX);
    });
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", () => { dragging = false; canvas.classList.remove("playing"); });
    canvas.addEventListener("pointercancel", () => { dragging = false; canvas.classList.remove("playing"); });
    canvas.addEventListener("pointerleave", () => { dragging = false; canvas.classList.remove("playing"); });
  }

  /* ---------- 生命周期 ---------- */
  function startLoop() {
    if (raf != null) return;
    lastTs = 0;
    raf = requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
  }

  function finish() {
    running = false;
    canvas.classList.remove("playing");
    draw();
    if (onEnd) onEnd({ caught, missed, words: collected.slice() });
  }

  return {
    /** 绑定 canvas（页面加载时调一次） */
    init() {
      canvas = document.getElementById("gameCanvas");
      if (!canvas) return;
      try { ctx = canvas.getContext("2d"); } catch (e) { ctx = null; }
      if (!ctx) return;          // 极端情况下拿不到 2d 上下文，就安静地不玩
      bindInput();

      // 只在游戏区进入视口时才跑循环
      if ("IntersectionObserver" in window) {
        new IntersectionObserver((es) => {
          visible = es[0].isIntersecting;
          if (visible) { resize(); startLoop(); } else { stopLoop(); }
        }, { threshold: 0.05 }).observe(canvas);
      } else {
        visible = true; resize(); startLoop();
      }

      addEventListener("resize", () => { resize(); if (!running) draw(); });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { stopLoop(); } else if (visible) { startLoop(); }
      });
    },

    /** 游戏区被显示出来时调用（此时才有真实宽高） */
    mount() { resize(); draw(); },

    /** 开一局 */
    start(cb) {
      if (!canvas) return;
      resize();
      items = []; pops = []; floaters = [];
      caught = 0; missed = 0;
      collected = [];
      pool = shuffle(blessingPool());
      spawnAcc = 0; idleAcc = 0;
      timeLeft = cfg().seconds;
      onEnd = cb;
      running = true;
      canvas.classList.add("playing");
      updateHud();
      tickTime();
      clearInterval(this._t);
      this._t = setInterval(tickTime, 200);
      startLoop();
    },

    stop() {
      running = false;
      clearInterval(this._t);
      canvas && canvas.classList.remove("playing");
    },

    get running() { return running; },
  };
})();

/* =============================================================
 *  blow.js —— 吹蜡烛
 *  两种操作：
 *    1) 对着麦克风吹气（检测音量能量）—— 手机上最有惊喜感
 *    2) 长按按钮                      —— 100% 可用的兜底
 *  微信内置浏览器经常拿不到麦克风权限，所以麦克风一失败就静默降级到长按，
 *  不给访客看任何报错。
 *  隐私：拿到的麦克风流只用于判断音量，不录音、不上传，用完立刻关掉。
 * ============================================================= */

const BlowCandles = (() => {
  const cfg = () => window.BDAY_CONFIG.blow || {};

  let slots = [];            // SVG 里的蜡烛元素
  let litQueue = [];         // 还没吹灭的（按从左到右）
  let blowing = false;
  let onDone = null;

  // 麦克风相关
  let stream = null, actx = null, analyser = null, buf = null;
  let rafId = null, loudSince = 0, lastBlow = 0, micDeadline = 0;

  // 长按相关
  let holdTimer = null;

  /* ---------- 准备 ---------- */
  function refreshSlots() {
    slots = [...document.querySelectorAll("#candleGroup .candle")];
  }

  /** 进入吹蜡烛模式：一根都没亮就先把 12 根全点亮，营造"该吹了"的氛围 */
  function prepare() {
    refreshSlots();
    slots.forEach((el) => { el.classList.remove("out"); });
    const lit = slots.filter((el) => el.classList.contains("lit"));
    if (!lit.length) slots.forEach((el) => el.classList.add("lit"));
    litQueue = slots.filter((el) => el.classList.contains("lit"));
    return litQueue.length;
  }

  /** 还有几根没吹灭 */
  const remain = () => litQueue.filter((el) => el.classList.contains("lit")).length;

  /* ---------- 吹灭一根 ---------- */
  function puff() {
    const now = performance.now();
    if (now - lastBlow < 220) return;          // 冷却，防止一口气全灭
    const target = litQueue.find((el) => el.classList.contains("lit"));
    if (!target) return;
    lastBlow = now;
    target.classList.remove("lit");
    target.classList.add("out");
    blowSound();
    document.dispatchEvent(new CustomEvent("blow:puff", { detail: { remain: remain() } }));
    if (remain() === 0) finish();
  }

  function finish() {
    stopMic();
    stopHold();
    blowing = false;
    if (onDone) onDone();
  }

  /* ---------- 音效：一声"呼——" ---------- */
  function blowSound() {
    if (!cfg().sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const len = Math.floor(actx.sampleRate * 0.35);
      const buffer = actx.createBuffer(1, len, actx.sampleRate);
      const d = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = actx.createBufferSource();
      s.buffer = buffer;
      const f = actx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 900;
      const g = actx.createGain();
      g.gain.value = 0.13;
      s.connect(f).connect(g).connect(actx.destination);
      s.start();
    } catch (e) {}
  }

  /* ---------- 麦克风模式 ---------- */
  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      console.warn("[吹蜡烛] 拿不到麦克风，改用长按：", e && e.name);
      return false;
    }
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") await actx.resume();
    } catch (e) { stopMic(); return false; }

    const src = actx.createMediaStreamSource(stream);
    analyser = actx.createAnalyser();
    analyser.fftSize = 1024;
    // 注意：只做分析，不连到 destination，所以不会产生回声
    src.connect(analyser);
    buf = new Float32Array(analyser.fftSize);

    micDeadline = performance.now() + (cfg().micTimeoutMs || 6000);
    const tick = () => {
      if (!blowing) return;
      rafId = requestAnimationFrame(tick);

      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);

      const th = cfg().sensitivity ?? 0.055;
      const now = performance.now();
      if (rms > th) {
        if (!loudSince) loudSince = now;
        else if (now - loudSince > 110 && now - lastBlow > 220) { puff(); loudSince = 0; micDeadline = now + (cfg().micTimeoutMs || 6000); }
      } else {
        loudSince = 0;
      }

      // 太久没动静就自动切到长按，别让人干等着
      if (now > micDeadline) {
        console.warn("[吹蜡烛] 麦克风没反应，自动切长按");
        stopMic();
        document.dispatchEvent(new CustomEvent("blow:fallback"));
      }
    };
    tick();
    return true;
  }

  function stopMic() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    loudSince = 0;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    analyser = null;
  }

  /* ---------- 长按模式 ---------- */
  function startHold() {
    stopHold();
    holdTimer = setInterval(puff, cfg().holdIntervalMs || 260);
    puff();
  }
  function stopHold() {
    if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
  }

  /* ---------- 对外 ---------- */
  return {
    get blowing() { return blowing; },
    remain,

    /** 吹完一轮之后的回调 */
    onFinish(cb) { onDone = cb; },

    /** 点「帮我吹蜡烛」：先试麦克风，不行就长按 */
    async start() {
      if (blowing) return;
      const n = prepare();
      if (!n) return;
      blowing = true;
      lastBlow = 0;
      const ok = await startMic();
      // 麦克风起不来也照样能玩：提示文字会引导长按
      document.dispatchEvent(new CustomEvent("blow:mode", { detail: { mic: ok } }));
    },

    /** 长按按住/松开（麦克风模式下按住同样有效，两条路并存） */
    holdDown() { if (blowing) startHold(); },
    holdUp() { stopHold(); },

    /** 放弃/重置 */
    cancel() { stopMic(); stopHold(); blowing = false; },

    /** 把蜡烛重新点亮（再玩一次） */
    relight() {
      stopMic(); stopHold(); blowing = false;
      refreshSlots();
      slots.forEach((el) => { el.classList.remove("out"); el.classList.add("lit"); });
      litQueue = slots.slice();
    },
  };
})();

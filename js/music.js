/* =============================================================
 *  music.js —— 背景音乐
 *    优先播 assets/ 里的 mp3（循环、淡入）
 *    mp3 加载失败 或 config.music.src 留空 → 自动用 Web Audio 合成的
 *    《生日快乐》欢快编曲（带鼓点、贝斯、oom-pah 和弦、收尾铃铛）
 *
 *  对外：Music.toggle() / Music.play() / Music.stop() / Music.playing
 *  事件：music:end（播完或被停止）、music:fallback（降级到合成版）
 * ============================================================= */

const Music = (() => {
  const cfg = () => window.BDAY_CONFIG.music || {};
  const fire = (n) => document.dispatchEvent(new CustomEvent(n));

  let audio = null, playing = false, mode = null;
  let fadeTimer = null, ctx = null, master = null, voices = [], endTimer = null, noiseBuf = null;

  /* ---------------- 文件模式 ---------------- */
  function ensureAudio() {
    if (audio) return audio;
    const src = cfg().src;
    if (!src) return null;
    audio = new Audio();
    audio.preload = "none";                 // 点 ♪ 才下载，不拖慢首屏
    audio.loop = cfg().loop !== false;
    audio.volume = 0;
    audio.src = src;
    audio.addEventListener("error", onFileError);
    audio.addEventListener("ended", () => {
      if (!audio.loop) { playing = false; fire("music:end"); }
    });
    return audio;
  }

  function fadeTo(a, target, sec) {
    clearInterval(fadeTimer);
    const tick = 60, from = a.volume;
    const steps = Math.max(1, Math.round(((sec || 0.6) * 1000) / tick));
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      a.volume = Math.max(0, Math.min(1, from + ((target - from) * i) / steps));
      if (i >= steps) {
        clearInterval(fadeTimer);
        fadeTimer = null;
        if (target === 0) a.pause();
      }
    }, tick);
  }

  function onFileError() {
    audio = null;
    if (playing && cfg().synthFallback !== false) {
      playSynth();
      fire("music:fallback");
      return true;
    }
    playing = false;
    fire("music:end");
    return false;
  }

  /* ---------------- 合成模式 ----------------
     《生日快乐》旋律已是公有领域（2016 年美国法院判决），随便用。
     25 拍，138 BPM，约 11 秒。 */
  const BPM = 138;

  // [频率, 起拍, 持续拍数]
  const MELODY = [
    [261.63, 0, 0.5], [261.63, 0.5, 0.5], [293.66, 1, 1], [261.63, 2, 1], [349.23, 3, 1], [329.63, 4, 2],
    [261.63, 6, 0.5], [261.63, 6.5, 0.5], [293.66, 7, 1], [261.63, 8, 1], [392.00, 9, 1], [349.23, 10, 2],
    [261.63, 12, 0.5], [261.63, 12.5, 0.5], [523.25, 13, 1], [440.00, 14, 1], [349.23, 15, 1], [329.63, 16, 1], [293.66, 17, 2],
    [466.16, 19, 0.5], [466.16, 19.5, 0.5], [440.00, 20, 1], [349.23, 21, 1], [392.00, 22, 1], [349.23, 23, 2],
  ];

  // [起拍, 持续拍数, 和弦音] —— C 大调，F 为下属和弦
  const CHORDS = [
    [0, 4, [261.63, 329.63, 392.00]],
    [4, 2, [261.63, 329.63, 392.00]],
    [6, 4, [261.63, 329.63, 392.00]],
    [10, 2, [349.23, 440.00, 523.25]],
    [12, 2, [261.63, 329.63, 392.00]],
    [14, 2, [349.23, 440.00, 523.25]],
    [16, 3, [261.63, 329.63, 392.00]],
    [19, 2, [349.23, 440.00, 523.25]],
    [21, 2, [261.63, 329.63, 392.00]],
    [23, 2, [349.23, 440.00, 523.25]],
  ];

  function actx() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(type, freq, t, dur, gain, detune) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.06);
    voices.push(o);
  }

  function noise(t, dur, gain, hp) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuf;
    f.type = "highpass";
    f.frequency.value = hp || 7000;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur + 0.03);
    voices.push(s);
  }

  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.22);
    voices.push(o);
  }

  function stopSynth(immediate) {
    clearTimeout(endTimer);
    const m = master;
    if (m && ctx) {
      try {
        if (immediate) {
          m.gain.setValueAtTime(0, ctx.currentTime);
        } else {
          m.gain.cancelScheduledValues(ctx.currentTime);
          m.gain.setValueAtTime(m.gain.value, ctx.currentTime);
          m.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
        }
      } catch (e) {}
      setTimeout(() => { try { m.disconnect(); } catch (e) {} }, 700);
    }
    voices.forEach((v) => { try { v.stop(); } catch (e) {} });
    voices = [];
    master = null;
  }

  function playSynth() {
    try { actx(); } catch (e) { playing = false; fire("music:end"); return; }
    stopSynth(true);

    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    const spb = 60 / BPM;
    const t0 = ctx.currentTime + 0.08;
    const T = (b) => t0 + b * spb;

    // 主旋律：三角波打底 + 叠一层高八度，听起来更亮更欢
    for (const [f, b, d] of MELODY) {
      const dur = d * spb * 0.95;
      tone("triangle", f, T(b), dur, 0.16);
      tone("triangle", f * 2, T(b), dur * 0.75, 0.04);
    }

    // oom-pah 伴奏：偶数拍贝斯、奇数拍和弦，欢快蹦跶感就来自这里
    for (const [b, d, notes] of CHORDS) {
      const root = notes[0] / 4;
      for (const off of [0, 2]) {
        if (off < d) {
          tone("triangle", root, T(b + off), spb * 0.45, 0.14);
          tone("sine", root, T(b + off), spb * 0.5, 0.1);
        }
      }
      for (const off of [1, 3]) {
        if (off < d) notes.forEach((n) => tone("square", n, T(b + off), spb * 0.28, 0.02));
      }
    }

    // 鼓组：底鼓在正拍，沙锤在反拍
    for (let b = 0; b < 25; b += 0.5) {
      if (Number.isInteger(b)) {
        if (b % 2 === 0) kick(T(b));
        else noise(T(b), 0.09, 0.03, 2600);
      } else {
        noise(T(b), 0.032, 0.018, 8200);
      }
    }

    // 收尾铃铛上行
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone("sine", f, T(25 + i * 0.18), 0.9, 0.11));

    playing = true;
    mode = "synth";
    const total = (25 + 4 * 0.18 + 1.4) * spb;
    clearTimeout(endTimer);
    endTimer = setTimeout(() => { playing = false; fire("music:end"); }, total * 1000 + 250);
  }

  /* ---------------- 对外接口 ---------------- */
  async function play() {
    if (playing) return true;
    if (!window.BDAY_CONFIG.features.music) return false;

    const a = cfg().src ? ensureAudio() : null;
    if (a) {
      mode = "file";
      playing = true;
      try {
        await a.play();
        fadeTo(a, cfg().volume ?? 0.45, cfg().fadeInSec ?? 1.2);
        return true;
      } catch (e) {
        return onFileError();       // 自动播放被拦 / 404 → 退回合成版
      }
    }
    playSynth();
    return true;
  }

  function stop() {
    if (mode === "file" && audio) fadeTo(audio, 0, 0.45);
    else stopSynth(false);
    playing = false;
    fire("music:end");
  }

  return {
    get playing() { return playing; },
    get mode() { return mode; },
    play,
    stop,
    toggle() {
      if (playing) { stop(); return false; }
      play();
      return true;
    },
  };
})();

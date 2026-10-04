/* =============================================================
 *  effects.js —— 纯视觉/听觉特效，和业务逻辑完全解耦
 *    Confetti.burst()  撒花
 *  （音乐在 js/music.js，小游戏在 js/game.js）
 * ============================================================= */

/* ---------------- 撒花 ---------------- */
const Confetti = (() => {
  const COLORS = ["#B9210C", "#F9D991", "#C9DDF5", "#E4572E", "#8A1608", "#FBF8EE"];
  let canvas, ctx, parts = [], raf = null, stopAt = 0;

  function ensure() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.className = "confetti-canvas";
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    addEventListener("resize", resize);
  }
  function resize() {
    if (!canvas) return;
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function spawn(n, originX, originY) {
    const ox = originX ?? innerWidth / 2;
    const oy = originY ?? innerHeight * 0.35;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 9;
      parts.push({
        x: ox + (Math.random() - 0.5) * 60,
        y: oy + (Math.random() - 0.5) * 30,
        vx: Math.cos(a) * v * 0.6,
        vy: Math.sin(a) * v - 4,
        g: 0.16 + Math.random() * 0.1,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 1,
      });
    }
  }

  function frame() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 60);
    for (const p of parts) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > innerHeight * 0.75) p.life -= 0.012;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    // 没有粒子了就停掉 rAF，别一直空转烧 CPU
    if (!parts.length && performance.now() > stopAt) {
      cancelAnimationFrame(raf); raf = null;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    burst(n = 90, x, y) {
      if (!window.BDAY_CONFIG.features.confetti) return;
      ensure();
      spawn(n, x, y);
      stopAt = performance.now() + 600;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    /** 顶部持续飘落，用于彩蛋/生日当天 */
    rain(seconds = 3) {
      if (!window.BDAY_CONFIG.features.confetti) return;
      ensure();
      const end = performance.now() + seconds * 1000;
      const tick = () => {
        if (performance.now() > end) return;
        for (let i = 0; i < 4; i++) {
          parts.push({
            x: Math.random() * innerWidth, y: -20,
            vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 2.5,
            g: 0.02, w: 6 + Math.random() * 6, h: 4 + Math.random() * 6,
            rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25,
            color: COLORS[(Math.random() * COLORS.length) | 0], life: 1,
          });
        }
        stopAt = performance.now() + 400;
        if (!raf) raf = requestAnimationFrame(frame);
        setTimeout(tick, 90);
      };
      tick();
    },
  };
})();


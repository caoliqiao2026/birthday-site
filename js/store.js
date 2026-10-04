/* =============================================================
 *  store.js —— 数据存储抽象层
 *  对外只暴露 5 个方法，上层不关心数据存在哪：
 *    Store.getMessages()          取留言列表
 *    Store.addMessage({name,text}) 写留言
 *    Store.getCandles()           取蜡烛数（含我是否点过）
 *    Store.lightCandle()          点蜡烛（一人只能点一根）
 *    Store.onChange(cb)           订阅变更（轮询实现）
 * ============================================================= */

const Store = (() => {
  const C = window.BDAY_CONFIG;
  const LS = {
    vid: "bday_vid",
    messages: "bday_messages",
    candles: "bday_candles",
    mine: "bday_candle_mine",
  };

  /* ---------- 本地兜底存储 ---------- */
  // 双击 index.html 用 file:// 打开时 localStorage 不可用（opaque origin），
  // 这时退化为内存存储，页面照样能玩，只是刷新后数据没了。
  const mem = {};
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { mem[k] = v; } };

  const local = {
    read(k, d) {
      try { return JSON.parse(lsGet(k)) ?? d; } catch { return d; }
    },
    write(k, v) { lsSet(k, JSON.stringify(v)); },
    async getMessages() {
      return local.read(LS.messages, []).sort((a, b) => b.created_at - a.created_at);
    },
    async addMessage(m) {
      const list = local.read(LS.messages, []);
      const row = { ...m, id: Date.now(), created_at: Date.now(), visitor_id: visitorId() };
      list.push(row);
      local.write(LS.messages, list);
      return row;
    },
    async getCandles() {
      const ids = local.read(LS.candles, []);
      return { count: ids.length, mine: local.read(LS.mine, false) };
    },
    async lightCandle() {
      const ids = local.read(LS.candles, []);
      ids.push(visitorId());
      local.write(LS.candles, ids);
      local.write(LS.mine, true);
      return { count: ids.length, mine: true };
    },
  };

  /* ---------- 云端存储（Supabase REST） ---------- */
  const sb = {
    ready() {
      const s = C.storage.supabase;
      return !!(s.url && s.anonKey);
    },
    headers(extra = {}) {
      const s = C.storage.supabase;
      return {
        apikey: s.anonKey,
        Authorization: "Bearer " + s.anonKey,
        "Content-Type": "application/json",
        ...extra,
      };
    },
    async getMessages() {
      const s = C.storage.supabase;
      const r = await fetch(
        `${s.url}/rest/v1/messages?select=*&order=created_at.desc&limit=300`,
        { headers: sb.headers() }
      );
      if (!r.ok) throw new Error("messages GET " + r.status);
      return r.json();
    },
    async addMessage(m) {
      const s = C.storage.supabase;
      const r = await fetch(`${s.url}/rest/v1/messages`, {
        method: "POST",
        headers: sb.headers({ Prefer: "return=representation" }),
        body: JSON.stringify([{ name: m.name, text: m.text, visitor_id: visitorId() }]),
      });
      if (!r.ok) throw new Error("messages POST " + r.status);
      return (await r.json())[0];
    },
    async getCandles() {
      const s = C.storage.supabase;
      // count=exact + Range 只取 1 行，从 Content-Range 头里读总数，省流量
      const r = await fetch(`${s.url}/rest/v1/candles?select=visitor_id&limit=1`, {
        headers: sb.headers({ Prefer: "count=exact", Range: "0-0" }),
      });
      if (!r.ok) throw new Error("candles GET " + r.status);
      const total = Number((r.headers.get("content-range") || "0/0").split("/")[1] || 0);

      const mine = await fetch(
        `${s.url}/rest/v1/candles?select=visitor_id&visitor_id=eq.${encodeURIComponent(visitorId())}&limit=1`,
        { headers: sb.headers() }
      ).then((x) => (x.ok ? x.json() : [])).catch(() => []);

      return { count: total, mine: mine.length > 0 };
    },
    async lightCandle() {
      const s = C.storage.supabase;
      const r = await fetch(`${s.url}/rest/v1/candles`, {
        method: "POST",
        // visitor_id 上有唯一约束，重复提交直接忽略，保证一人一根
        headers: sb.headers({ Prefer: "return=minimal,resolution=ignore-duplicates" }),
        body: JSON.stringify([{ visitor_id: visitorId() }]),
      });
      if (!r.ok && r.status !== 409) throw new Error("candles POST " + r.status);
      return sb.getCandles();
    },
  };

  /* ---------- 访客 ID（只存在本地，用于一人一根蜡烛） ---------- */
  let _vid = null;
  function visitorId() {
    if (_vid) return _vid;
    _vid = lsGet(LS.vid);
    if (!_vid) {
      _vid = (crypto.randomUUID?.() || "v-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10));
      lsSet(LS.vid, _vid);
    }
    return _vid;
  }

  /* ---------- 模式选择 ---------- */
  let mode = "local";
  function pickMode() {
    const m = C.storage.mode;
    if (m === "local") return "local";
    if (m === "supabase") return sb.ready() ? "supabase" : "local";
    return sb.ready() ? "supabase" : "local"; // auto
  }

  async function call(method, arg) {
    const useCloud = mode === "supabase";
    try {
      if (useCloud) return await sb[method](arg);
    } catch (e) {
      console.warn("[Store] 云端失败，降级本地：", e.message);
      mode = "local";
      document.dispatchEvent(new CustomEvent("store:fallback"));
    }
    return local[method](arg);
  }

  /* ---------- 对外 API ---------- */
  const subs = [];
  let timer = null;

  return {
    get mode() { return mode; },
    visitorId,

    async init() {
      mode = pickMode();
      if (mode === "supabase") {
        // 先探一次，挂了就立刻降级，别让页面卡住
        try { await sb.getCandles(); } catch (e) { mode = "local"; }
      }
      return mode;
    },

    getMessages: () => call("getMessages"),
    addMessage: (m) => call("addMessage", m),
    getCandles: () => call("getCandles"),
    lightCandle: () => call("lightCandle"),

    /** 定时拉取最新数据，有变化才回调（省掉无意义的重渲染） */
    onChange(cb) {
      subs.push(cb);
      if (timer) return;
      timer = setInterval(async () => {
        try {
          const [messages, candles] = await Promise.all([Store.getMessages(), Store.getCandles()]);
          subs.forEach((f) => f({ messages, candles }));
        } catch {}
      }, C.storage.pollMs || 8000);
    },

    /** 立刻广播一次（自己刚操作完时用，省得等轮询） */
    async emit() {
      const [messages, candles] = await Promise.all([Store.getMessages(), Store.getCandles()]);
      subs.forEach((f) => f({ messages, candles }));
      return { messages, candles };
    },
  };
})();

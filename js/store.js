/* =============================================================
 *  store.js —— 数据存储抽象层
 *  对外只暴露这些方法，上层不关心数据存在哪：
 *    Store.getMessages()          取留言列表
 *    Store.addMessage({name,text}) 写留言
 *    Store.deleteMessage(id)      删留言（要管理员登录）
 *    Store.getCandles()           取蜡烛数（含我是否点过）
 *    Store.lightCandle()          点蜡烛（一人只能点一根）
 *    Store.signIn(email,pwd)      管理员登录（Supabase Auth）
 *    Store.signOut() / isAdmin()  退出 / 是否已登录
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
    async deleteMessage(id) {
      const list = local.read(LS.messages, []);
      const next = list.filter((m) => String(m.id) !== String(id));
      if (next.length === list.length) throw new Error("找不到这条留言");
      local.write(LS.messages, next);
      return true;
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
    /** 删留言：必须带上管理员登录后拿到的 access_token，否则 RLS 会让它删不动 */
    async deleteMessage(id, token) {
      const s = C.storage.supabase;
      const r = await fetch(`${s.url}/rest/v1/messages?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
          apikey: s.anonKey,
          Authorization: "Bearer " + token,
          Prefer: "return=representation",
        },
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error("删除失败 " + r.status + (t ? "：" + t.slice(0, 120) : ""));
      }
      const rows = await r.json().catch(() => null);
      if (rows && rows.length === 0) throw new Error("没删动：这个账号没有删除权限");
      return true;
    },
  };

  /* ---------- 管理员登录（Supabase Auth） ----------
   * 密码只在登录那一次发出去，不写进任何配置文件；
   * 删留言时用的是 Supabase 签发的临时票据（默认 1 小时过期，会自动续期）。 */
  const AUTH = { tok: "bday_admin_tok", ref: "bday_admin_ref", exp: "bday_admin_exp" };
  let admin = null;

  function jwtExp(tok) {
    try {
      const p = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return Number(p.exp) * 1000;
    } catch { return 0; }
  }
  function adminLoad() {
    if (admin) return admin;
    const t = lsGet(AUTH.tok);
    if (!t) return null;
    admin = { access: t, refresh: lsGet(AUTH.ref) || "", exp: Number(lsGet(AUTH.exp) || 0) };
    return admin;
  }
  function adminSave(a) {
    admin = a;
    if (a) {
      lsSet(AUTH.tok, a.access); lsSet(AUTH.ref, a.refresh || ""); lsSet(AUTH.exp, String(a.exp || 0));
    } else {
      lsSet(AUTH.tok, ""); lsSet(AUTH.ref, ""); lsSet(AUTH.exp, "0");
    }
  }
  async function adminRefresh() {
    const a = adminLoad();
    if (!a || !a.refresh) return false;
    const s = C.storage.supabase;
    try {
      const r = await fetch(`${s.url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST", headers: sb.headers(), body: JSON.stringify({ refresh_token: a.refresh }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) throw new Error("票据已过期");
      adminSave({ access: j.access_token, refresh: j.refresh_token || a.refresh, exp: jwtExp(j.access_token) });
      return true;
    } catch {
      adminSave(null);
      return false;
    }
  }

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

    /* ---------- 管理员 ---------- */
    /** 是否已登录管理员（只表示本地有有效票据，真正的权限由 Supabase 判定） */
    isAdmin: () => !!adminLoad(),
    /** 是否跑在云端（本地模式下也能删，但只删自己浏览器里的数据） */
    isCloud: () => mode === "supabase",

    async signIn(email, password) {
      if (mode !== "supabase") throw new Error("现在是本地模式，登录不了云端管理员");
      const s = C.storage.supabase;
      const r = await fetch(`${s.url}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: sb.headers(), body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) {
        const msg = j.error_description || j.msg || j.message || "登录失败";
        if (/email not confirmed/i.test(msg)) throw new Error("这个邮箱还没验证：请在 Supabase 后台把该用户的 Email Confirmed 勾上");
        if (/invalid login/i.test(msg)) throw new Error("邮箱或密码不对");
        throw new Error(msg);
      }
      adminSave({ access: j.access_token, refresh: j.refresh_token, exp: jwtExp(j.access_token) });
      return true;
    },

    async signOut() {
      const a = adminLoad();
      if (a && mode === "supabase") {
        const s = C.storage.supabase;
        try {
          await fetch(`${s.url}/auth/v1/logout`, { method: "POST", headers: sb.headers({ Authorization: "Bearer " + a.access }) });
        } catch {}
      }
      adminSave(null);
    },

    async deleteMessage(id) {
      if (mode === "supabase") {
        let a = adminLoad();
        if (!a) throw new Error("请先登录管理员");
        // 快过期就先续一下，避免删一半票据失效
        if (a.exp && Date.now() > a.exp - 30000) { await adminRefresh(); a = adminLoad(); }
        if (!a) throw new Error("登录状态过期了，请重新登录");
        return sb.deleteMessage(id, a.access);
      }
      return local.deleteMessage(id);
    },

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

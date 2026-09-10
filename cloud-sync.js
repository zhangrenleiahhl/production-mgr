// ============================================================
//  云端同步引擎（Supabase）。未配置则自动降级为纯本地。
//  数据模型：一张表 app_data(key text, value jsonb, updated_at)
//  每个 localStorage 键 → 云端一行，最后写入者覆盖（适合单人/小团队）。
// ============================================================
window.CloudSync = (function () {
  const CFG = window.CLOUD_CONFIG || {};
  let client = null, ready = false, statusEl = null, timers = {};
  let pullErr = false;      // ⚠ 共享状态（会被并发拉取覆盖），仅为兼容旧调用方保留；新代码请用 pullResult

  function configured() {
    return CFG.url && CFG.key && CFG.url.indexOf("YOUR-PROJECT") < 0 && CFG.key.indexOf("YOUR-ANON") < 0;
  }

  function init() {
    if (!configured()) return false;
    try {
      if (window.supabase) {
        // 兼容复制了 /rest/v1/ 末尾的用户
        const url = (CFG.url || "").trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
        client = window.supabase.createClient(url, CFG.key);
        ready = true;
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function setStatus(txt, cls) {
    if (statusEl) { statusEl.textContent = txt; statusEl.className = "cloud-pill " + (cls || ""); }
  }
  function bindStatus(el) { statusEl = el; }

  // ★ 单次拉取的"自带结果"（不依赖任何共享状态）
  //   以前用模块级变量 pullErr 记录成败，但页面上同时有多个拉取在跑（60 秒自动校对、
  //   发货员端 30 秒轮询、开机拉取…），A 的失败状态会被 B 的成功覆盖掉。
  //   后果很严重：调用方本来想判断"这次到底拉到没有"，结果被判成"云端真的没有这条"，
  //   于是把本机那份不完整的清单推上去，把云端别人的记录整份盖掉 —— 而且只在
  //   "恰好有并发拉取成功"时发生，所以表现是「有时候」。
  //   现在每次拉取都返回 {ok, value}，谁的结果就是谁的，不受别人影响。
  async function pullResult(key) {
    if (!ready) return { ok: false, value: null, reason: "offline" };
    try {
      const { data, error } = await client.from("app_data").select("value").eq("key", key).maybeSingle();
      if (error) return { ok: false, value: null, reason: error.message || "error" };
      return { ok: true, value: data ? data.value : null };    // ok=true 且 value=null ⇒ 云端确实还没有这条
    } catch (e) { return { ok: false, value: null, reason: String((e && e.message) || e) }; }
  }

  async function pull(key) {
    const r = await pullResult(key);
    pullErr = !r.ok;                       // 仅保留给旧调用方，新代码请用 pullResult
    return r.ok ? r.value : null;
  }

  // ★ 上传护栏（最后一道防线）
  //   只要给某个键注册了合并函数，push 之前一定会：先拉云端 → 与本次要推的值合并 → 再上传。
  //   意义：以前"不覆盖云端"全靠每个调用方自觉（发布走安全通道、删除走安全通道…），
  //   一旦漏掉一条路径（或者某个人的浏览器还跑着旧版页面，旧版是直接 push 本机清单的），
  //   云端上别人的记录就被整份盖掉了。护栏把这件事从"调用方负责"变成"引擎负责"：
  //   哪怕有人直接 push("shipping_plans_v1", 本机那几条)，也只会合并，不可能覆盖。
  //   拉不到云端时宁可不推（返回 false，由调用方记待补传）。
  const guards = {};
  function guard(key, mergeFn) { if (typeof mergeFn === "function") guards[key] = mergeFn; }

  async function push(key, value) {
    if (!ready) return false;
    const g = guards[key];
    // 没有注册合并函数、但要推的是"空数组"时，也核对一次云端：
    // 本机空 + 云端非空 ⇒ 这台电脑只是还没拉到数据（新电脑 / 拉取失败），
    // 绝不能拿空数据把云端清掉 —— 物料库、发布记录都会这么丢。
    const checkEmpty = !g && Array.isArray(value) && value.length === 0;
    if (g || checkEmpty) {
      const r = await pullResult(key);
      if (!r.ok) { setStatus("连不上云端，已存本机，稍后自动补传", "warn"); return false; }
      if (r.value !== null) {
        const cloudStr = (typeof r.value === "string") ? r.value : JSON.stringify(r.value);
        if (g) {
          let merged = null;
          try { merged = g(JSON.stringify(value), cloudStr); }   // 签名与 pullAll 的 merge 统一：(本地, 云端) => 合并结果
          catch (e) { merged = null; }
          if (typeof merged !== "string") { setStatus("合并校验未通过，已取消本次上传", "warn"); return false; }
          try { value = JSON.parse(merged); } catch (e) {}
        } else {
          let ca = null;
          try { ca = JSON.parse(cloudStr); } catch (e) { ca = null; }
          if (Array.isArray(ca) && ca.length) { setStatus("云端还有数据，已阻止用空数据覆盖", "warn"); return false; }
        }
      }
    }
    setStatus("同步中…", "sync");
    try {
      const { error } = await client.from("app_data")
        .upsert({ key: key, value: value, updated_at: new Date().toISOString() });
      if (error) { setStatus("同步失败", "err"); return false; }
      setStatus("已同步 ☁", "ok");
      return true;
    } catch (e) { setStatus("同步失败", "err"); return false; }
  }

  // 改动后防抖上传（读取当前 localStorage 值）
  function autoPush(key) {
    if (!ready) return;
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      let v; try { v = JSON.parse(localStorage.getItem(key)); } catch (e) { v = localStorage.getItem(key); }
      if (v !== null && v !== undefined) push(key, v);
    }, 900);
  }

  // 数组型数据的条数（非数组返回 -1）
  function arrLen(s) {
    try { const v = JSON.parse(s); return Array.isArray(v) ? v.length : -1; } catch (e) { return -1; }
  }

  // 拉取多个键，存在则写回 localStorage，结束后回调重渲染
  // ★ 防覆盖保护：云端数据明显少于本地时拒绝覆盖（例如云端被误清 / 另一台机器推了旧数据），
  //   并先把本地当前值备份成 key+"__bak"，任何一次覆盖都可回退。
  // force=true 表示用户手动点了「同步」，按用户意图强制以云端为准
  // merge={ key: (localStr, cloudStr) => mergedStr } 时该键走"合并"而不是"覆盖"（最安全，只增不减）
  async function pullAll(keys, after, force, merge) {
    if (!ready) { if (after) after(); return { failed: keys.slice(), ok: 0 }; }
    let keptLocal = false;
    const failed = [];
    for (const k of keys) {
      const r0 = await pullResult(k);                          // ★ 用"自带结果"的拉取，避免并发拉取把失败状态洗掉
      if (!r0.ok) { failed.push(k); continue; }                // 这次真的没拉到 → 算失败（绝不据此覆盖本机）
      const v = r0.value;
      if (v === null) continue;                                // 云端确实还没有这条 → 不算失败
      const incoming = (typeof v === "string") ? v : JSON.stringify(v);
      const local = localStorage.getItem(k);
      if (local != null) {
        if (local === incoming) continue;                       // 完全一致，省一次写
        // 合并模式：调用方自己决定怎么合（例如按 id 取并集），永不丢数据
        if (merge && typeof merge[k] === "function") {
          let merged = null;
          try { merged = merge[k](local, incoming); } catch (e) { merged = null; }
          if (typeof merged === "string" && merged !== local) {
            try { localStorage.setItem(k + "__bak", local); } catch (e) {}
            try { localStorage.setItem(k, merged); } catch (e) {}
          }
          continue;
        }
        const ll = arrLen(local), cl = arrLen(incoming);
        if (!force && ll > 0 && cl >= 0 && cl * 100 < ll * 60) { // 云端不足本地的 60% → 判定为异常，保留本地
          try { localStorage.setItem(k + "__cloud", incoming); } catch (e) {}
          keptLocal = true;
          continue;
        }
        try { localStorage.setItem(k + "__bak", local); } catch (e) {}   // 覆盖前留底
      }
      try { localStorage.setItem(k, incoming); } catch (e) {}
    }
    if (keptLocal) setStatus("云端数据偏少，已保留本地", "warn");
    if (after) after();
    return { failed: failed, ok: keys.length - failed.length };
  }

  return {
    init, ready: () => ready, configured,
    pull, pullResult, push, autoPush, pullAll, bindStatus, setStatus, guard,
    lastPullFailed: () => pullErr       // ⚠ 共享状态，并发拉取会互相覆盖，仅兼容旧代码；新代码用 pullResult
  };
})();

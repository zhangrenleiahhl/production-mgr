// ============================================================
//  云端同步引擎（Supabase）。未配置则自动降级为纯本地。
//  数据模型：一张表 app_data(key text, value jsonb, updated_at)
//  每个 localStorage 键 → 云端一行，最后写入者覆盖（适合单人/小团队）。
// ============================================================
window.CloudSync = (function () {
  const CFG = window.CLOUD_CONFIG || {};
  let client = null, ready = false, statusEl = null, timers = {};

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

  async function pull(key) {
    if (!ready) { pullErr = true; return null; }
    try {
      const { data, error } = await client.from("app_data").select("value").eq("key", key).maybeSingle();
      if (error) { pullErr = true; return null; }
      pullErr = false;
      return data ? data.value : null;
    } catch (e) { pullErr = true; return null; }
  }

  async function push(key, value) {
    if (!ready) return false;
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
      const v = await pull(k);
      if (v === null) { if (pullErr) failed.push(k); continue; }   // 只有"真的失败"才算失败；云端本就没这条不算
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
    pull, push, autoPush, pullAll, bindStatus, setStatus,
    lastPullFailed: () => pullErr
  };
})();

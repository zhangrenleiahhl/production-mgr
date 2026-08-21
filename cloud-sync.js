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
    if (!ready) return null;
    try {
      const { data, error } = await client.from("app_data").select("value").eq("key", key).maybeSingle();
      if (error) return null;
      return data ? data.value : null;
    } catch (e) { return null; }
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

  // 拉取多个键，存在则写回 localStorage，结束后回调重渲染
  async function pullAll(keys, after) {
    if (!ready) { if (after) after(); return; }
    for (const k of keys) {
      const v = await pull(k);
      if (v !== null) localStorage.setItem(k, (typeof v === "string") ? v : JSON.stringify(v));
    }
    if (after) after();
  }

  // 自动轮询拉取：间隔拉取云端，若与本地不同则写回并触发重渲染（实现手机端免手动刷新）
  let autoPullTimer = null, autoPullState = null;
  async function pullAndApply(key) {
    const v = await pull(key);
    if (v === null) return false;
    const cloudStr = (typeof v === "string") ? v : JSON.stringify(v);
    const localStr = localStorage.getItem(key) || "null";
    if (cloudStr !== localStr) { localStorage.setItem(key, cloudStr); return true; }
    return false;
  }
  function startAutoPull(keys, render, intervalMs) {
    if (!ready) return;
    autoPullState = { keys: keys, render: render, interval: intervalMs || 6000 };
    if (autoPullTimer) clearInterval(autoPullTimer);
    autoPullTimer = setInterval(async () => {
      // 用户正在输入框里打字则跳过本轮，避免覆盖未保存的编辑
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      if (document.hidden) return;
      let changed = false;
      for (const k of autoPullState.keys) {
        try { if (await pullAndApply(k)) changed = true; } catch (e) { /* ignore */ }
      }
      if (changed) {
        setStatus("已同步 ☁", "ok");
        if (autoPullState.render) autoPullState.render();
      }
    }, autoPullState.interval);
  }

  return {
    init, ready: () => ready, configured,
    pull, push, autoPush, pullAll, startAutoPull, bindStatus, setStatus
  };
})();

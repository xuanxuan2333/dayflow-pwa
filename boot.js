/* DayFlow 手机版引导层
   1. 从 IndexedDB 读上次导入的随身包（dayflow-pack.json）
   2. 如果站点根目录有 pack.json（手动传上去的），联网时自动取新版
   3. 都没有 → 显示「选择数据文件」
   4. 数据就绪后注入 window.DAYFLOW_* 并加载 schedule.js
*/
(() => {
  'use strict';

  const DB_NAME = 'dayflow';
  const STORE = 'kv';
  const PACK_KEY = 'pack';
  const META_KEY = 'meta';
  const SCHEMA = 'dayflow-pack-v1';

  document.documentElement.classList.add('pwa-mode');

  // ---------------------------------------------------------------- IndexedDB
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------------------------------------------------------------- 工具
  function fmtTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function packMeta(pack) {
    return {
      generatedAt: pack.generatedAt || null,
      importedAt: new Date().toISOString(),
      counts: pack.counts || { activities: (pack.data.activities || []).length },
    };
  }
  function assertPack(pack) {
    if (!pack || pack.schema !== SCHEMA) throw new Error('不是 DayFlow 数据包（schema 不匹配）');
    if (!pack.data || !Array.isArray(pack.data.activities)) throw new Error('数据包里没有 activities');
    return pack;
  }
  async function savePack(pack) {
    const clean = assertPack(pack);
    const meta = packMeta(clean);
    await idbSet(PACK_KEY, clean);
    await idbSet(META_KEY, meta);
    return meta;
  }
  function isNewer(candidate, current) {
    if (!current) return true;
    const a = Date.parse(candidate || '') || 0;
    const b = Date.parse(current || '') || 0;
    return a > b;
  }

  // ---------------------------------------------------------------- 自动更新
  async function fetchRemotePack(cached, force = false, attempt = 0) {
    let res;
    try {
      // 手动同步时加时间戳，绕开 GitHub Pages 的 CDN 缓存
      const url = force ? `pack.json?t=${Date.now()}` : 'pack.json';
      res = await fetch(url, { cache: 'no-store' });
    } catch {
      // 国内到 GitHub Pages 偶尔会断一下，重试两次
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        return fetchRemotePack(cached, force, attempt + 1);
      }
      return { status: 'offline' };
    }
    if (!res.ok) return { status: 'missing' }; // 没有上传，正常情况
    let pack;
    try { pack = await res.json(); } catch { return { status: 'broken' }; }
    try { assertPack(pack); } catch { return { status: 'broken' }; }
    if (!isNewer(pack.generatedAt, cached && cached.generatedAt)) return { status: 'same', pack };
    await savePack(pack);
    return { status: 'updated', pack };
  }

  // ---------------------------------------------------------------- 启动
  let started = false;
  function loadScript(src, attempt = 0) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = attempt ? `${src}?r=${attempt}-${Date.now()}` : src;
      s.async = true;
      const timer = setTimeout(() => {
        // 个别网络下 load 事件可能不触发，但脚本其实已经执行了；这里只做超时兜底
        if (attempt < 1) loadScript(src, attempt + 1).then(resolve, reject);
        else resolve();
      }, 15000);
      s.onload = () => { clearTimeout(timer); resolve(); };
      s.onerror = () => {
        clearTimeout(timer);
        if (attempt < 2) loadScript(src, attempt + 1).then(resolve, reject);
        else reject(new Error(`加载失败：${src}`));
      };
      (document.head || document.body).appendChild(s);
    });
  }

  async function start(pack, meta) {
    if (started) {
      // 已经跑起来时换数据：直接重载最稳
      location.reload();
      return;
    }
    started = true;
    hideGate();
    window.DAYFLOW_PWA = true;
    window.DAYFLOW_SNAPSHOT = pack.data;
    window.DAYFLOW_STUDY = pack.study || [];
    window.DAYFLOW_COURSES = pack.courses || [];
    window.DAYFLOW_META = meta || packMeta(pack);
    // 增强层不依赖 schedule.js 的 load 事件，先挂兜底计时器（1.2s / 3.2s / 6s 各试一次）
    setTimeout(runEnhance, 1200);
    setTimeout(runEnhance, 3200);
    setTimeout(runEnhance, 6000);
    try {
      await loadScript('schedule.js');
    } catch (err) {
      started = false;
      await showGate();
      gateError(`界面脚本加载失败（${err.message || err}），下拉刷新重试`);
      return;
    }
    hideSplash();
    runEnhance();
  }

  // ---------------------------------------------------------------- 启动闪屏
  function hideSplash() {
    const el = document.getElementById('dayflow-splash');
    if (!el || el.dataset.hiding === '1') return;
    el.dataset.hiding = '1';
    el.classList.add('hide');
    setTimeout(() => el.remove(), 240);
  }

  // ---------------------------------------------------------------- 导入界面
  let gateEl = null;
  function gateError(message) {
    if (!gateEl) return;
    const box = gateEl.querySelector('#pwaGateErr');
    if (!box) return;
    box.hidden = false;
    box.textContent = message;
  }

  async function showGate(reason) {
    if (gateEl) {
      gateEl.hidden = false;
      return;
    }
    hideSplash();
    const meta = await idbGet(META_KEY).catch(() => null);
    gateEl = document.createElement('div');
    gateEl.className = 'pwa-gate';
    gateEl.id = 'pwaGate';
    gateEl.innerHTML = `
      <form class="pwa-gate-card" id="pwaGateForm">
        <div class="pwa-gate-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
            <rect x="4" y="5.5" width="16" height="14" rx="3"/>
            <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>
            <path d="M8.5 14.5h2M13.5 14.5h2" stroke-width="2.4"/>
          </svg>
        </div>
        <h1>出门计划</h1>
        <p class="pwa-gate-sub">${reason === 'resync' ? '同步最新数据' : '还没有手机数据包'}</p>
        <label class="pwa-gate-btn">
          选择数据文件
          <input id="pwaFile" type="file" accept=".json,application/json" hidden>
        </label>
        <p class="pwa-gate-hint">在 Mac 上运行 <code>npm run pack</code>，生成 <code>dayflow-pack.json</code>，AirDrop 到手机后用这里选它。</p>
        <div class="pwa-gate-meta" id="pwaGateMeta">${
          meta && meta.generatedAt
            ? `当前数据：${fmtTime(meta.generatedAt)} · ${meta.counts?.activities ?? '—'} 个活动`
            : '还没有导入过数据'
        }</div>
        <div class="pwa-gate-err" id="pwaGateErr" hidden></div>
      </form>`;
    document.body.appendChild(gateEl);

    const input = gateEl.querySelector('#pwaFile');
    const form = gateEl.querySelector('#pwaGateForm');
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const pack = JSON.parse(text);
        const meta2 = await savePack(pack);
        await start(pack, meta2);
      } catch (err) {
        gateError(`导入失败：${err.message || err}`);
      }
    });
    // 表单默认提交会刷新页面，挡掉
    form.addEventListener('submit', (e) => e.preventDefault());
  }

  function hideGate() {
    if (gateEl) gateEl.hidden = true;
  }

  // ---------------------------------------------------------------- 对外接口
  window.__dayflow = {
    openGate: () => showGate('resync'),
    // 手动同步：先拉线上最新包，没有更新再退回选文件
    syncRemote: async () => {
      const cached = await idbGet(PACK_KEY).catch(() => null);
      return fetchRemotePack(cached, true);
    },
    hideGate,
    meta: () => idbGet(META_KEY),
    reload: () => location.reload(),
  };

  // ---------------------------------------------------------------- 离线（尽早注册，不依赖 pwa.js）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => { reg.update().catch(() => {}); })
      .catch(() => { /* 离线能力可选 */ });
    // 新 SW 接管：只有界面已经跑起来时才刷新（冷启动时直接刷新会闪一下）
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!window.__dayflowEnhanced) return;
      try {
        if (sessionStorage.getItem('dayflow.sw.reloaded') === '1') return;
        sessionStorage.setItem('dayflow.sw.reloaded', '1');
      } catch { /* 隐私模式忽略 */ }
      location.reload();
    });
  }

  // ---------------------------------------------------------------- 增强层（原 pwa.js）
  // 合并进 boot 静态脚本，避免第二次动态加载在某些网络下被中断
  function enhance() {
    const meta = window.DAYFLOW_META || {};

      function fmtTime(value) {
        if (!value) return '—';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      }

      // ---------------------------------------------------------------- 顶栏
      function addSyncButton() {
        const actions = document.querySelector('.app-actions');
        if (!actions) return;
        const btn = document.createElement('button');
        btn.className = 'crawl-entry pwa-sync';
        btn.id = 'pwaSync';
        btn.title = '从 Mac 导入最新的 dayflow-pack.json';
        btn.innerHTML = '<svg><use href="#i-check"/></svg><span>同步数据</span>';
        const anchor = actions.querySelector('.db-entry') || actions.querySelector('.home-chip');
        actions.insertBefore(btn, anchor || null);
        btn.addEventListener('click', async () => {
          const label = btn.querySelector('span');
          if (btn.dataset.busy === '1') return;
          btn.dataset.busy = '1';
          btn.disabled = true;
          if (label) label.textContent = '同步中…';
          try {
            const r = window.__dayflow && await window.__dayflow.syncRemote();
            if (r && r.status === 'updated') {
              location.reload();
              return;
            }
            if (r && r.status === 'same') {
              toast(`已是最新（${fmtTime(meta.generatedAt)}）`);
              return;
            }
            // 线上没有包 / 取不到 → 退回手动选文件
            if (window.__dayflow) window.__dayflow.openGate();
          } finally {
            btn.dataset.busy = '0';
            btn.disabled = false;
            if (label) label.textContent = '同步数据';
          }
        });
      }

      function updateSavePill() {
        const pill = document.querySelector('.save-pill');
        if (!pill) return;
        const generated = meta.generatedAt ? fmtTime(meta.generatedAt) : '—';
        const count = meta.counts && meta.counts.activities ? `${meta.counts.activities} 个活动` : '';
        pill.innerHTML = `<svg><use href="#i-check"/></svg>数据 ${generated}`;
        pill.title = `随身包生成于 ${generated}${count ? ' · ' + count : ''}；日程保存在本机浏览器`;
        // 数据超过两天没更新就变黄提醒
        const ageMs = meta.generatedAt ? Date.now() - Date.parse(meta.generatedAt) : Infinity;
        if (ageMs > 2 * 24 * 3600 * 1000) pill.classList.add('stale');
      }

      function toast(text) {
        const el = document.createElement('div');
        el.className = 'pwa-toast';
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2200);
      }

      function tweakChrome() {
        const proto = document.querySelector('.proto-pill');
        if (proto) proto.textContent = '手机版';
        document.title = '出门计划 · 手机版';
      }

      addSyncButton();
      window.__dayflowToast = toast;
      updateSavePill();
      tweakChrome();
      // 课程体验课：手机端指向静态课程页，而不是 Mac 的 dayflow:// 服务
      const courseEntry = document.querySelector('.course-entry');
      if (courseEntry) {
        courseEntry.href = 'courses/index.html';
        courseEntry.title = '按地点/分类看美团成人课程';
      }
      const build = window.__DAYFLOW_BUILD || '';
      if (build) {
        document.documentElement.setAttribute('data-build', build);
        const pill = document.querySelector('.save-pill');
        if (pill) pill.title += ` · 版本 ${build}`;
        console.info('[dayflow] build', build);
      }
  }

  function runEnhance() {
    if (window.__dayflowEnhanced) return;
    try {
      enhance();
      window.__dayflowEnhanced = true;
      document.documentElement.setAttribute('data-dayflow-enhanced', '1');
    } catch (err) {
      console.error('[dayflow] 增强层失败：', err);
    }
  }

  // ---------------------------------------------------------------- init
  setTimeout(hideSplash, 4000);

  (async () => {
    const params = new URLSearchParams(location.search);
    const seed = params.get('seed');
    try {
      if (seed) {
        const res = await fetch(seed, { cache: 'no-store' });
        const pack = await res.json();
        const meta = await savePack(pack);
        return start(pack, meta);
      }
      const pack = await idbGet(PACK_KEY).catch(() => null);
      if (pack) {
        // 先用本地缓存秒开，再后台检查更新：避免每次冷启动都等整包下载
        start(pack, await idbGet(META_KEY));
        fetchRemotePack(pack, false).then((r) => {
          if (r.status !== 'updated') return;
          let tries = 0;
          const notify = () => {
            if (window.__dayflowToast) {
              window.__dayflowToast('数据已更新，下次打开生效');
            } else if (tries++ < 10) {
              setTimeout(notify, 500);
            }
          };
          notify();
        });
        return;
      }
      // 第一次装（本机还没有缓存）才阻塞等网络
      const remote = await fetchRemotePack(null);
      if (remote.status === 'updated') {
        hideGate();
        return start(remote.pack, await idbGet(META_KEY));
      }
      return showGate();
    } catch (err) {
      await showGate();
      gateError(err.message || String(err));
    }
  })();
})();

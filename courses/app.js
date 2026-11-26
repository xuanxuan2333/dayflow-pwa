(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const state = {
    location: null,
    regionId: null,
    radius: 10,
    category: '全部',
    audience: 'all',
    q: '',
    priceMin: '',
    priceMax: '',
    includeNoPhone: false,
    sort: 'price',
    meta: null,
    collecting: false,
  };

  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const fmtPrice = (p) => {
    if (p === null || p === undefined || p === '') return '价格待确认';
    const n = Number(p);
    if (!Number.isFinite(n)) return '价格待确认';
    if (n === 0) return '免费';
    return `¥${Number.isInteger(n) ? n : n.toFixed(1)}`;
  };

  const fmtHours = (c) => {
    if (c.business_open && c.business_close) {
      if (c.business_close === '24:00') return '00:00–24:00';
      if (c.business_close < c.business_open) return `${c.business_open}–次日 ${c.business_close}`;
      return `${c.business_open}–${c.business_close}`;
    }
    return c.business_hours || '';
  };

  function amapMarkerUrl(c) {
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return '';
    const name = c.venue_name || c.course_name || '课程位置';
    return `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(name)}&coordinate=gaode&callnative=0&src=dayflow`;
  }

  const fmtDate = (s) => {
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  };

  // -------------------------------------------------------------------
  // 地图（Leaflet + 高德栅格瓦片）
  // -------------------------------------------------------------------
  const AMAP_TILE = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
  const CAT_COLORS = {
    吉他: '#d97706', 钢琴: '#4f5bd5', 游泳: '#0891b2', 绘画: '#db2777',
    声乐: '#7c3aed', 架子鼓: '#c2410c', 其他乐器: '#0f766e', 书法: '#6b5b45',
    音乐综合: '#a21caf', 冥想: '#4b4bb7', 瑜伽: '#15803d', 演讲表达: '#b45309',
    射箭: '#2c5b78', 潜水: '#0b6b72', 攀岩: '#7a4a28', 卡丁车: '#b91c1c',
    滑雪: '#24618f', 健身: '#166534', 舞蹈: '#be185d', 台球: '#4d7c0f', 其他: '#6b7280',
  };
  const mapState = { map: null, markers: null, circle: null, home: null };

  function catColor(cat) {
    return CAT_COLORS[cat] || CAT_COLORS['其他'];
  }

  function zoomForRadius(km) {
    if (km <= 3) return 13;
    if (km <= 5) return 12;
    if (km <= 10) return 12;
    if (km <= 20) return 11;
    if (km <= 30) return 10;
    return 9;
  }

  function initMap() {
    const el = $('#map');
    if (!el) return;
    if (!window.L) {
      $('#mapNote').textContent = 'Leaflet 未加载（需要联网 CDN）· 课程列表仍可用';
      return;
    }
    const map = L.map(el, { zoomControl: true, preferCanvas: true, attributionControl: true })
      .setView([39.9042, 116.4074], 10);
    const layer = L.tileLayer(AMAP_TILE, {
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 18,
      minZoom: 8,
      attribution: '&copy; 高德地图',
    });
    layer.on('tileerror', () => {
      $('#mapNote').textContent = '底图加载失败（网络或瓦片）· 课程点仍可点';
    });
    layer.addTo(map);
    mapState.map = map;
    mapState.markers = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 250);
  }

  function popupHtml(c) {
    const dist = c.distanceKm != null
      ? (c.distanceKm < 1 ? `${Math.round(c.distanceKm * 1000)}m` : `${c.distanceKm.toFixed(1)}km`)
      : '';
    const phone = c.phone
      ? `<span>📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}${c.phone_ext ? ` 转 ${esc(c.phone_ext)}` : ''}</a></span>`
      : '<span>电话待补</span>';
    const hours = fmtHours(c);
    const mapUrl = amapMarkerUrl(c);
    return `<div class="course-popup">
      <b>${esc(c.course_name)}</b>
      <span>${esc(fmtPrice(c.price))}${c.venue_name ? ` · ${esc(c.venue_name)}` : ''}</span>
      ${c.address ? `<span>${esc(c.address)}${dist ? ` · ${dist}` : ''}</span>` : (dist ? `<span>${dist}</span>` : '')}
      ${hours ? `<span>营业 ${esc(hours)}</span>` : ''}
      ${phone}
      ${mapUrl ? `<span><a href="${esc(mapUrl)}" target="_blank" rel="noreferrer">在高德地图查看 ↗</a></span>` : ''}
      ${c.booking_url ? `<span><a href="${esc(c.booking_url)}" target="_blank" rel="noreferrer">去美团看看 →</a></span>` : ''}
    </div>`;
  }

  function updateMap(courses) {
    const map = mapState.map;
    if (!map) return;
    mapState.markers.clearLayers();
    if (mapState.circle) {
      map.removeLayer(mapState.circle);
      mapState.circle = null;
    }
    if (mapState.home) {
      map.removeLayer(mapState.home);
      mapState.home = null;
    }

    if (state.location) {
      const center = [state.location.lat, state.location.lng];
      map.setView(center, zoomForRadius(state.radius), { animate: false });
      mapState.circle = L.circle(center, {
        radius: state.radius * 1000,
        color: '#7c5cfc',
        weight: 1,
        dashArray: '5 5',
        fillColor: '#7c5cfc',
        fillOpacity: 0.05,
      }).addTo(map);
      mapState.home = L.circleMarker(center, {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#7c5cfc',
        fillOpacity: 1,
      }).addTo(map).bindTooltip(state.location.name || '你选的位置', { direction: 'top' });
    }

    const points = [];
    for (const c of courses) {
      if (c.lat == null || c.lng == null) continue;
      const lat = Number(c.lat);
      const lng = Number(c.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      points.push([lat, lng]);
      L.circleMarker([lat, lng], {
        radius: 6,
        color: '#fff',
        weight: 1.5,
        fillColor: catColor(c.category),
        fillOpacity: 0.95,
      })
        .addTo(mapState.markers)
        .bindPopup(popupHtml(c), { maxWidth: 280 })
        .bindTooltip(c.course_name, { direction: 'top', opacity: 0.9 });
    }

    if (!state.location && points.length) {
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 13, animate: false });
    }
    if (!state.location && !points.length) {
      map.setView([39.9042, 116.4074], 10, { animate: false });
    }

    $('#mapLegend').textContent = `${courses.length} 个点`;
    $('#mapNote').textContent = state.location
      ? `${state.location.name} · ${state.radius}km 内 · ${courses.length} 个点（跟随筛选）`
      : `全城 ${courses.length} 个点（跟随筛选）`;
    setTimeout(() => map.invalidateSize(), 50);
  }

  function renderRegions(meta) {
    const box = $('#regionChips');
    if (!box) return;
    const regions = Array.isArray(meta.regions) ? meta.regions : [];
    const chips = [{ id: '', name: '全部' }, ...regions];
    box.innerHTML = chips
      .map((r) => {
        const active = r.id
          ? state.regionId === r.id
          : !state.regionId && !state.location;
        return `<button class="chip ${active ? 'active' : ''}" data-region="${esc(r.id)}">${esc(r.name)}</button>`;
      })
      .join('');
  }

  function matchRegion(lat, lng) {
    const regions = state.meta?.regions || [];
    return regions.find(
      (r) => Math.abs(Number(r.lat) - Number(lat)) < 0.02 && Math.abs(Number(r.lng) - Number(lng)) < 0.02,
    );
  }

  function setRegion(id) {
    if (!id) {
      state.regionId = null;
      clearLocation();
      return;
    }
    const r = (state.meta?.regions || []).find((x) => x.id === id);
    if (!r) return;
    state.regionId = id;
    state.location = { query: r.name, name: r.name, address: '', lat: r.lat, lng: r.lng };
    state.radius = Number(r.radius) || 10;
    $('#radiusSelect').value = String(state.radius);
    state.sort = 'distance';
    $('#sortSelect').value = 'distance';
    $('#locInput').value = r.name;
    activeLocationHtml();
    renderRegions(state.meta);
    loadCourses();
  }

  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast${isError ? ' error' : ''}`;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`接口返回异常（HTTP ${res.status}）`);
    }
    if (!res.ok && !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    return data;
  }

  function categoryChip(label, count, active) {
    return `<button class="chip ${active ? 'active' : ''}" data-cat="${esc(label)}">${esc(label)}${count != null ? `<span class="n">${count}</span>` : ''}</button>`;
  }

  function renderMeta(meta) {
    state.meta = meta;
    $('#statLine').textContent = `${meta.total} 门课 · ${meta.withPhone} 门有电话 · ${meta.withAddr} 门有地址`;
    $('#anchorList').innerHTML = (meta.anchors || [])
      .map((a) => `<option value="${esc(a.name)}"></option>`)
      .join('');
    renderCategoryChips();
    renderRegions(meta);
    if (meta.lastCrawl) {
      const c = meta.lastCrawl;
      const loc = (c.note || '').match(/location=([^,]+)/)?.[1];
      $('#lastCrawl').textContent = `最近采集：${fmtDate(c.ended_at || c.started_at)} · 抓取 ${c.fetched ?? 0} / 新增 ${c.inserted ?? 0} / 更新 ${c.updated ?? 0}${loc ? ` · ${loc}` : ''}`;
    }
  }

  function renderCategoryChips() {
    const meta = state.meta;
    if (!meta) return;
    const src = state.includeNoPhone
      ? (meta.byCategory || [])
      : (meta.byCategoryPhone || meta.byCategory || []);
    const counts = new Map(src.map((x) => [x.category, x.n]));
    const order = ['吉他', '钢琴', '游泳', '绘画', '声乐', '架子鼓', '其他乐器', '书法', '音乐综合', '冥想', '瑜伽', '演讲表达', '射箭', '潜水', '攀岩', '卡丁车', '滑雪', '健身', '舞蹈', '台球', '其他'];
    const present = [...counts.keys()].filter((x) => !order.includes(x));
    const labels = ['全部', ...order.filter((x) => counts.has(x)), ...present];
    if (!labels.includes(state.category)) state.category = '全部';
    const all = state.includeNoPhone ? meta.total : meta.withPhone;
    $('#categoryChips').innerHTML = labels
      .map((l) => categoryChip(l, l === '全部' ? all : counts.get(l) || 0, l === state.category))
      .join('');
  }

  async function loadMeta() {
    const meta = await api('/api/meta');
    renderMeta(meta);
  }

  function activeLocationHtml() {
    const box = $('#activeLoc');
    if (!state.location) {
      box.hidden = true;
      $('#collectBtn').disabled = true;
      $('#emptyCollectBtn').disabled = true;
      return;
    }
    box.hidden = false;
    $('#activeLocName').textContent = state.location.name || state.location.query;
    $('#activeLocAddr').textContent = state.location.address || '';
    $('#collectBtn').disabled = state.collecting;
    $('#emptyCollectBtn').disabled = state.collecting;
  }

  function buildQuery() {
    const p = new URLSearchParams();
    if (state.location) {
      p.set('lat', state.location.lat);
      p.set('lng', state.location.lng);
      p.set('radius', state.radius);
    }
    if (state.category && state.category !== '全部') p.set('category', state.category);
    if (state.audience !== 'all') p.set('audience', state.audience);
    if (state.q) p.set('q', state.q);
    if (state.priceMin !== '') p.set('priceMin', state.priceMin);
    if (state.priceMax !== '') p.set('priceMax', state.priceMax);
    p.set('sort', state.sort);
    p.set('includeNoPhone', state.includeNoPhone ? '1' : '0');
    return p.toString();
  }

  function setSkeletons(n = 6) {
    $('#empty').hidden = true;
    $('#grid').innerHTML = Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
    $('#resultCount').textContent = '加载中…';
    $('#resultHint').textContent = '';
  }

  function renderCard(c) {
    const cat = c.category || '其他';
    const aud = c.audience === 'mixed' ? '成人/青少年' : '成人';
    const price = fmtPrice(c.price);
    const orig = c.original_price != null && Number(c.original_price) > Number(c.price)
      ? `<span class="orig">${fmtPrice(c.original_price)}</span>`
      : '';
    const dist = c.distanceKm != null
      ? `<span class="dist">${c.distanceKm < 1 ? `${Math.round(c.distanceKm * 1000)}m` : `${c.distanceKm.toFixed(1)}km`}</span>`
      : '';
    const phone = c.phone
      ? `<a class="phone" href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}${c.phone_ext ? ` 转 ${esc(c.phone_ext)}` : ''}</a>`
      : '<span class="phone missing">电话待补</span>';
    const booking = c.booking_url
      ? `<a href="${esc(c.booking_url)}" target="_blank" rel="noreferrer">去美团看看 →</a>`
      : '';
    const mapUrl = amapMarkerUrl(c);
    const mapLink = mapUrl
      ? `<a class="map-link" href="${esc(mapUrl)}" target="_blank" rel="noreferrer">🗺️ 地图</a>`
      : '';
    const venue = [c.venue_name, c.branch_name].filter(Boolean).join(' · ');
    const desc = c.description || '';
    const hours = fmtHours(c);
    return `<article class="card">
      <div class="card-head">
        <h3 class="course-name">${esc(c.course_name)}</h3>
        <span class="card-chevron" aria-hidden="true">▾</span>
      </div>
      <div class="card-detail">
      <div class="card-top">
        <span class="badge cat ${esc(cat)}">${esc(cat)}</span>
        <span class="badge aud ${c.audience === 'mixed' ? 'mixed' : ''}">${aud}</span>
        ${c.rating ? `<span class="badge src">⭐ ${esc(String(c.rating))}</span>` : ''}
      </div>
      <div class="price-row"><span class="price">${price}</span>${orig}</div>
      <div class="meta">
        ${venue ? `<div class="meta-row"><span class="meta-ico">🏠</span><span class="meta-text" title="${esc(venue)}">${esc(venue)}</span></div>` : ''}
        ${c.address ? `<div class="meta-row"><span class="meta-ico">📍</span><span class="meta-text" title="${esc(c.address)}">${esc(c.address)} ${dist}</span></div>` : (dist ? `<div class="meta-row"><span class="meta-ico">📍</span><span class="meta-text">${dist}</span></div>` : '')}
        ${hours ? `<div class="meta-row"><span class="meta-ico">🕒</span><span class="meta-text">营业 ${esc(hours)}</span></div>` : ''}
      </div>
      <div class="phone-row">${phone}${c.phone_source === 'amap' ? '<span class="price-note">高德</span>' : ''}</div>
      ${desc ? `<div class="desc">${esc(desc)}</div>` : ''}
      <div class="card-foot">
        <span>采集 ${fmtDate(c.last_seen_at)}</span>
        <span class="card-links">${mapLink}${booking}</span>
      </div>
      </div>
    </article>`;
  }

  function renderCourses(data) {
    const list = data.courses || [];
    $('#grid').innerHTML = list.map(renderCard).join('');
    $('#resultCount').textContent = `${list.length} 门课`;
    const bits = [];
    if (state.location) bits.push(`${state.location.name} · ${state.radius}km 内`);
    if (state.category !== '全部') bits.push(state.category);
    if (state.audience === 'adult') bits.push('仅成人');
    if (state.audience === 'mixed') bits.push('成人/青少年');
    if (state.q) bits.push(`搜索「${state.q}」`);
    if (state.sort === 'distance' && state.location) bits.push('按距离');
    if (state.sort === 'price') bits.push('按价格');
    if (state.sort === 'rating') bits.push('按评分');
    if (!state.includeNoPhone) bits.push('已隐藏无电话');
    $('#resultHint').textContent = bits.join(' · ');
    $('#empty').hidden = list.length > 0;
    if (!list.length) $('#grid').innerHTML = '';
    updateMap(list);
  }

  async function loadCourses() {
    setSkeletons();
    try {
      const data = await api(`/api/courses?${buildQuery()}`);
      renderCourses(data);
    } catch (e) {
      $('#grid').innerHTML = '';
      $('#resultCount').textContent = '加载失败';
      $('#resultHint').textContent = e.message;
      updateMap([]);
      toast(e.message, true);
    }
  }

  async function geocode(q) {
    const text = String(q || '').trim();
    if (!text) return;
    $('#locateBtn').disabled = true;
    $('#locateBtn').textContent = '定位中…';
    try {
      const r = await api(`/api/geocode?q=${encodeURIComponent(text)}`);
      state.location = { query: text, name: r.name || text, address: r.address || '', lat: r.lat, lng: r.lng };
      state.sort = 'distance';
      $('#sortSelect').value = 'distance';
      $('#locInput').value = r.name || text;
      const hit = matchRegion(state.location.lat, state.location.lng);
      state.regionId = hit ? hit.id : null;
      activeLocationHtml();
      renderRegions(state.meta);
      await loadCourses();
      toast(`已定位：${state.location.name}`);
    } catch (e) {
      toast(`定位失败：${e.message}`, true);
    } finally {
      $('#locateBtn').disabled = false;
      $('#locateBtn').textContent = '定位';
    }
  }

  function clearLocation() {
    state.location = null;
    state.sort = 'price';
    $('#sortSelect').value = 'price';
    state.regionId = null;
    $('#locInput').value = '';
    activeLocationHtml();
    if (state.meta) renderRegions(state.meta);
    loadCourses();
  }

  async function collect() {
    if (state.collecting) return;
    if (!state.location) {
      toast('请先输入地点并点「定位」', true);
      return;
    }
    const btn = $('#collectBtn');
    state.collecting = true;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '采集中…（首次会打开 Chrome 登录）';
    try {
      const payload = {
        location: state.location.query || `${state.location.lat},${state.location.lng}`,
        radius: state.radius,
        llm: $('#llmCheck').checked,
      };
      const r = await api('/api/collect', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(r.message || r.error || '采集失败');
      const c = r.counters || {};
      toast(`采集完成：${r.fetched ?? 0} 条 / 新增 ${r.inserted ?? 0} / 跳过重复 ${r.duplicates ?? 0} / 范围内 ${c.offers ?? 0} 门课`);
      await loadMeta();
      await loadCourses();
    } catch (e) {
      toast(e.message, true);
    } finally {
      state.collecting = false;
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  function bind() {
    $('#regionChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      setRegion(btn.dataset.region || '');
    });
    $('#locateBtn').addEventListener('click', () => geocode($('#locInput').value));
    $('#locInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') geocode($('#locInput').value);
    });
    $('#radiusSelect').addEventListener('change', (e) => {
      state.radius = Number(e.target.value);
      if (state.location) loadCourses();
    });
    $('#sortSelect').addEventListener('change', (e) => {
      state.sort = e.target.value;
      loadCourses();
    });
    $('#qInput').addEventListener('input', (e) => {
      clearTimeout(bind._q);
      bind._q = setTimeout(() => {
        state.q = e.target.value.trim();
        loadCourses();
      }, 220);
    });
    $('#clearLocBtn').addEventListener('click', clearLocation);
    $('#refreshBtn').addEventListener('click', async () => {
      await loadMeta();
      await loadCourses();
      toast('已刷新');
    });
    // 手机上点卡片标题展开/收起详情（点电话、链接不触发）
    $('#grid').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      if (e.target.closest('a, button')) return;
      card.classList.toggle('open');
    });
    $('#collectBtn').addEventListener('click', collect);
    $('#emptyCollectBtn').addEventListener('click', collect);
    $('#resetBtn').addEventListener('click', () => {
      state.category = '全部';
      state.audience = 'all';
      state.q = '';
      state.priceMin = '';
      state.priceMax = '';
      state.includeNoPhone = false;
      if ($('#noPhoneCheck')) $('#noPhoneCheck').checked = false;
      state.radius = 10;
      $('#qInput').value = '';
      $('#radiusSelect').value = '10';
      $('#priceChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.price === ''));
      $('#audienceChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.audience === 'all'));
      $('#categoryChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.cat === '全部'));
      loadCourses();
    });
    $('#categoryChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      state.category = btn.dataset.cat || '全部';
      $('#categoryChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === btn));
      loadCourses();
    });
    $('#audienceChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      state.audience = btn.dataset.audience || 'all';
      $('#audienceChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === btn));
      loadCourses();
    });
    $('#noPhoneCheck').addEventListener('change', (e) => {
      state.includeNoPhone = e.target.checked;
      renderCategoryChips();
      loadCourses();
    });
    $('#priceChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      const [min, max] = (btn.dataset.price || '').split('-');
      state.priceMin = min || '';
      state.priceMax = max || '';
      $('#priceChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === btn));
      loadCourses();
    });
  }

  async function init() {
    if (location.protocol === 'file:') {
      $('#statLine').textContent = '请通过本地服务打开';
      $('#resultCount').textContent = '不能直接双击 HTML';
      $('#resultHint').textContent = '先运行 node modules/meituan/courses/web/server.mjs，再打开 http://127.0.0.1:8788';
      return;
    }
    bind();
    initMap();
    const params = new URLSearchParams(location.search);
    if (params.get('radius')) {
      state.radius = Number(params.get('radius')) || 10;
      $('#radiusSelect').value = String(state.radius);
    }
    if (params.get('category')) {
      state.category = params.get('category');
      $('#categoryChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.cat === state.category));
    }
    await loadMeta();
    if (params.get('location')) {
      $('#locInput').value = params.get('location');
      await geocode(params.get('location'));
    } else {
      await loadCourses();
    }
    activeLocationHtml();
  }

  init().catch((e) => {
    const msg = e?.message || '无法连接本地服务';
    $('#statLine').textContent = '加载失败';
    $('#resultCount').textContent = '本地服务未连接';
    $('#resultHint').textContent = '请先运行 node modules/meituan/courses/web/server.mjs，或从 M5「课程体验课」重新打开';
    toast(`连接失败：${msg}`, true);
    if (!init._retried) {
      init._retried = true;
      setTimeout(() => location.reload(), 2500);
    }
  });
})();

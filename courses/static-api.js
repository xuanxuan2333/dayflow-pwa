/* 课程页的「静态后端」
   把 server.mjs 的 /api/meta /api/courses /api/geocode 用前端实现一遍，
   数据来自构建时导出的 window.__COURSES_DATA（courses-data.js）。
   这样同一份 index.html + app.js 既能跑本地服务，也能直接放 GitHub Pages。
   必须在 app.js 之前加载。 */
(() => {
  'use strict';

  const DATA = window.__COURSES_DATA || { meta: {}, courses: [] };
  const ALL = Array.isArray(DATA.courses) ? DATA.courses : [];
  const RAD = Math.PI / 180;

  function distanceKm(a, b) {
    const dLat = (b.lat - a.lat) * RAD;
    const dLng = (b.lng - a.lng) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  function filterCourses(params) {
    const lat = params.get('lat');
    const lng = params.get('lng');
    const radius = Number(params.get('radius') || 0);
    const category = params.get('category') || '';
    const audience = params.get('audience') || '';
    const q = (params.get('q') || '').trim().toLowerCase();
    const priceMin = params.get('priceMin');
    const priceMax = params.get('priceMax');
    const sort = params.get('sort') || (lat && lng ? 'distance' : 'price');
    const includeNoPhone = params.get('includeNoPhone') === '1';
    const limit = Math.min(500, Math.max(1, Number(params.get('limit') || 500)));

    let rows = ALL.slice();
    if (!includeNoPhone) rows = rows.filter((r) => r.phone && String(r.phone).trim());

    if (category && category !== '全部') rows = rows.filter((r) => r.category === category);
    if (audience && audience !== 'all') {
      if (audience === 'adult') rows = rows.filter((r) => r.audience === 'adult');
      else if (audience === 'mixed') rows = rows.filter((r) => r.audience === 'mixed');
      else rows = rows.filter((r) => ['adult', 'mixed'].includes(r.audience));
    }
    if (q) {
      rows = rows.filter((r) =>
        `${r.course_name} ${r.venue_name || ''} ${r.address || ''} ${r.description || ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (priceMin !== null && priceMin !== '') rows = rows.filter((r) => Number(r.price || 0) >= Number(priceMin));
    if (priceMax !== null && priceMax !== '') rows = rows.filter((r) => Number(r.price || 0) <= Number(priceMax));

    let origin = null;
    if (lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      origin = { lat: Number(lat), lng: Number(lng) };
    }

    if (origin) {
      rows = rows
        .map((r) => ({
          ...r,
          distanceKm:
            r.lat != null && r.lng != null
              ? Number(distanceKm(origin, { lat: r.lat, lng: r.lng }).toFixed(2))
              : null,
        }))
        .filter((r) => (r.distanceKm != null && radius > 0 ? r.distanceKm <= radius : true));
    }

    if (sort === 'distance' && origin) {
      rows.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    } else if (sort === 'rating') {
      rows.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    } else {
      rows.sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
    }

    return { ok: true, total: rows.length, origin, radius: radius || null, courses: rows.slice(0, limit) };
  }

  function geocode(q) {
    const text = String(q || '').trim();
    const m = text.match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { ok: true, name: '自定义坐标', lat: Number(m[1]), lng: Number(m[2]) };
    const list = DATA.meta.anchors || [];
    const hit =
      list.find((a) => a.name === text) ||
      list.find((a) => text.includes(a.name) || a.name.includes(text));
    if (hit) return { ok: true, name: hit.name, lat: hit.lat, lng: hit.lng };
    const region = (DATA.meta.regions || []).find((r) => r.name.includes(text) || text.includes(r.name));
    if (region) return { ok: true, name: region.name, lat: region.lat, lng: region.lng };
    return { ok: false, error: 'NOT_FOUND', message: '手机版只能定位预设地点，试试「北苑 / 望京 / 国贸」或直接填坐标' };
  }

  const realFetch = window.fetch.bind(window);

  // 静态版没有采集能力：把按钮藏掉，免得点了报错
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('collectBtn');
    if (btn) btn.hidden = true;
  });

  window.fetch = function patchedFetch(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const p = url.pathname;

    if (p.endsWith('/api/meta')) {
      return Promise.resolve(json({ ok: true, ...DATA.meta }));
    }
    if (p.endsWith('/api/courses')) {
      return Promise.resolve(json(filterCourses(url.searchParams)));
    }
    if (p.endsWith('/api/geocode')) {
      const r = geocode(url.searchParams.get('q'));
      return Promise.resolve(json(r, r.ok ? 200 : 400));
    }
    if (p.endsWith('/api/collect')) {
      return Promise.resolve(
        json({ ok: false, message: '手机端不能采集，请在 Mac 上跑「开始爬取」' }, 400),
      );
    }
    if (p.endsWith('/api/health')) return Promise.resolve(json({ ok: true, static: true }));

    // 其它请求交给真正的 fetch
    return realFetch(input, init);
  };
})();

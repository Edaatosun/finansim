/* Finansım — tüm veriler bu cihazın localStorage'ında tutulur. Kod içinde kişisel veri yoktur. */
(() => {
  'use strict';

  // ---------- Yardımcılar ----------
  const STORE_KEY = 'finansim:v1';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sum = (arr, f) => arr.reduce((a, x) => a + (typeof f === 'function' ? f(x) : (+x[f] || 0)), 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lower = (s) => String(s || '').toLocaleLowerCase('tr').trim();
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
  const money = (n) => (Math.round(n) < 0 ? '−' : '') + '₺' + nf0.format(Math.abs(Math.round(n || 0)));
  const money2 = (n) => (n < 0 ? '−' : '') + '₺' + nf2.format(Math.abs(n || 0));
  const signed = (n) => (Math.round(n) > 0 ? '+' : '') + money(n);
  const pct = (n) => (n < 0 ? '−' : '') + '%' + nf2.format(Math.abs(Math.round(n * 10) / 10));
  const num = (n) => nf2.format(n || 0);
  const amtStr = (n) => (n === '' || n == null ? '' : String(n).replace('.', ','));

  function parseAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(v || '').replace(/[₺\s]|TL/gi, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
    return parseFloat(s);
  }

  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const monthKeyOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const addMonth = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKeyOf(new Date(y, m - 1 + n, 1)); };
  const monthName = (key, short) => { const [y, m] = key.split('-').map(Number); const n = MONTHS[m - 1]; return short ? `${n.slice(0, 3)} ${String(y).slice(2)}` : `${n} ${y}`; };
  const daysInMonth = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const dayLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }); };
  const shortDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }); };

  // ---------- Durum ----------
  let state = load();
  let unlocked = false;

  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch { toast('Kaydedilemedi: tarayıcı depolaması kapalı olabilir'); }
  }
  function freshState(name) {
    return {
      version: 2, user: { name }, settings: { theme: 'auto', pinHash: null },
      months: {}, savings: { holdings: [], goals: [] },
      rates: null, rateOverrides: {}, ui: { month: monthKeyOf(), mode: 'gider', cat: null },
    };
  }
  function migrate(s) {
    s.ui = s.ui || {}; s.ui.month = s.ui.month || monthKeyOf(); s.ui.mode = s.ui.mode || 'gider';
    s.settings = s.settings || { theme: 'auto' };
    s.rateOverrides = s.rateOverrides || {};
    s.savings = s.savings || { holdings: [], goals: [] };
    s.months = s.months || {};
    s.version = 2;
    return s;
  }

  // --- Veri kodu (kişisel başlangıç verisi linkin # kısmında taşınır, sunucuya gitmez) ---
  // Kompakt biçim: { m, i:[[ad,tutar]], c:[[ad,plan,sabit,emoji]], e:[[katIndex,açıklama,tutar,gün]], h:[[tür,adet,fiyat,tarih]], g:[[ad,emoji,hedef,tarih]] }
  function decodeCode(text) {
    const m = String(text || '').match(/(?:#veri=)?([A-Za-z0-9_-]{20,})\s*$/);
    if (!m) return null;
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const json = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
      const d = JSON.parse(json);
      return d && d.m && Array.isArray(d.c) ? d : null;
    } catch { return null; }
  }
  function applyCode(d) {
    const cats = d.c.map(([name, planned, fixed, emoji]) => ({ id: uid(), name, planned, fixed: !!fixed, emoji }));
    state.months[d.m] = {
      incomes: (d.i || []).map(([name, amount]) => ({ id: uid(), name, amount })),
      categories: cats,
      expenses: (d.e || []).map(([ci, desc, amount, day]) => ({ id: uid(), catId: cats[ci].id, desc, amount, date: `${d.m}-${pad(day)}`, extra: false })),
      transferred: 0,
    };
    (d.h || []).forEach(([type, qty, buyPrice, date]) => state.savings.holdings.push({ id: uid(), type, qty, buyPrice, date, note: '' }));
    (d.g || []).forEach(([name, emoji, target, deadline]) => state.savings.goals.push({ id: uid(), name, emoji, target, deadline, mode: 'all', manual: 0 }));
    state.ui.month = d.m;
  }
  let pendingCode = null;
  if (location.hash.startsWith('#veri=')) {
    pendingCode = decodeCode(location.hash);
    history.replaceState(null, '', location.pathname + '#/ozet');
  }

  const curMonthKey = () => state.ui.month || monthKeyOf();
  const getMonth = (key) => state.months[key];
  const monthKeys = () => Object.keys(state.months).sort();

  // Ay yoksa, en yakın önceki aydan planı kopyalayarak oluştur (otomatik yeni ay)
  function ensureMonth(key) {
    if (state.months[key]) return state.months[key];
    const prev = monthKeys().filter((k) => k < key).pop();
    const src = prev && state.months[prev];
    state.months[key] = {
      incomes: src ? src.incomes.map((i) => ({ ...i, id: uid() })) : [],
      categories: src ? src.categories.map((c) => ({ ...c, id: uid() })) : [],
      expenses: [], transferred: 0,
    };
    return state.months[key];
  }

  // ---------- Hesaplar ----------
  function catStats(m, c) {
    const ex = m.expenses.filter((e) => e.catId === c.id);
    const spent = sum(ex, 'amount');
    const planned = +c.planned || 0;
    const extraFlagged = sum(ex.filter((e) => e.extra), 'amount');
    const nonExtra = spent - extraFlagged;
    const diff = planned - spent;
    let status;
    if (planned === 0 && spent > 0) status = 'unplanned';
    else if (planned === 0) status = 'empty';
    else if (diff < 0) status = 'over';
    else if (spent === 0) status = c.fixed ? 'pending' : 'untouched';
    else status = 'ok';
    return {
      ...c, planned, spent, diff, count: ex.length, status,
      extra: planned > 0 ? extraFlagged : spent,
      inPlan: planned > 0 ? Math.min(nonExtra, planned) : 0,
      overrun: planned > 0 ? Math.max(0, nonExtra - planned) : 0,
    };
  }
  function calc(m, key) {
    const income = sum(m.incomes, 'amount');
    const cats = m.categories.map((c) => catStats(m, c));
    const planned = sum(cats, 'planned');
    const spent = sum(m.expenses, 'amount');
    const now = monthKeyOf();
    const phase = key < now ? 'past' : key === now ? 'current' : 'future';
    const plannedCats = cats.filter((c) => c.planned > 0);
    const withinCount = plannedCats.filter((c) => c.spent <= c.planned).length;
    // Ay kapanmadan değişken bütçede kalan para "kâr" değil, henüz harcanmamış alandır.
    const closed = (c) => phase === 'past' || (c.fixed && c.spent > 0);
    const saved = sum(plannedCats.filter(closed), (c) => Math.max(0, c.diff));
    const openBudget = sum(plannedCats.filter((c) => !closed(c)), (c) => Math.max(0, c.diff));
    const lost = sum(cats, (c) => Math.max(0, -c.diff));
    const extra = sum(cats, 'extra');
    const inPlan = sum(cats, 'inPlan');
    const overrun = sum(cats, 'overrun');
    const plannedSaving = income - planned;
    const remaining = income - spent;
    const vsPlan = planned - spent;
    const discipline = plannedCats.length ? withinCount / plannedCats.length : (spent <= planned ? 1 : 0);
    let savingPart;
    if (income <= 0) savingPart = 0;
    else if (plannedSaving > 0) savingPart = clamp(remaining / plannedSaving, 0, 1);
    else savingPart = remaining >= plannedSaving ? 1 : clamp(1 + (remaining - plannedSaving) / income, 0, 1);
    const extraPenalty = income > 0 ? clamp(extra / income, 0, 0.2) : 0;
    const score = Math.round(clamp((discipline * 0.5 + savingPart * 0.5 - extraPenalty) * 100, 0, 100));
    const savingRate = income > 0 ? (remaining / income) * 100 : 0;
    const varLeft = sum(cats.filter((c) => !c.fixed && c.planned > 0), (c) => Math.max(0, c.diff));
    const pendingFixed = sum(cats.filter((c) => c.fixed), (c) => Math.max(0, c.diff));
    const daysLeft = phase === 'current' ? daysInMonth(key) - new Date().getDate() + 1 : 0;
    return { income, planned, spent, cats, phase, saved, openBudget, lost, extra, inPlan, overrun, plannedSaving, remaining, vsPlan, score, savingRate, varLeft, pendingFixed, daysLeft, withinCount, plannedCount: plannedCats.length };
  }
  function scoreLabel(s) {
    if (s >= 85) return ['Mükemmel', 'good'];
    if (s >= 70) return ['İyi', 'good'];
    if (s >= 50) return ['Orta', 'warn'];
    return ['Geliştirilmeli', 'bad'];
  }

  // ---------- Kategori tahmini ----------
  const KEYWORDS = [
    [['bim', 'a101', 'şok', 'migros', 'carrefour', 'file', 'market', 'manav', 'kasap', 'getir', 'macro'], ['market']],
    [['trendyol', 'hepsiburada', 'amazon', 'n11', 'temu', 'shein', 'aliexpress'], ['online', 'alışveriş']],
    [['boston', 'zara', 'lcw', 'lc waikiki', 'koton', 'mavi', 'defacto', 'h&m', 'mango', 'bershka', 'pull', 'kıyafet', 'ayakkabı', 'flo'], ['kıyafet', 'giyim', 'kişisel']],
    [['tatlı', 'kafe', 'cafe', 'starbucks', 'kahve', 'restoran', 'yemek', 'burger', 'pizza', 'döner', 'yemeksepeti', 'lokanta', 'simit'], ['dışarı', 'kafe', 'yeme', 'yemek']],
    [['gratis', 'watsons', 'rossmann', 'sephora', 'kozmetik', 'parfüm', 'eveline', 'flormar'], ['kozmetik', 'bakım']],
    [['netflix'], ['netflix', 'abonelik']], [['spotify', 'youtube', 'disney', 'exxen', 'blutv', 'icloud', 'apple'], ['abonelik', 'dijital']],
    [['fatura', 'turkcell', 'vodafone', 'türk telekom', 'elektrik', 'doğalgaz', 'su faturası', 'internet'], ['fatura', 'telefon']],
    [['benzin', 'akaryakıt', 'shell', 'opet', 'bp', 'taksi', 'uber', 'bitaksi', 'metro', 'otobüs', 'istanbulkart', 'marmaray'], ['ulaşım', 'yol', 'araba']],
    [['ikea', 'koçtaş', 'masa', 'mobilya', 'english home', 'madame coco'], ['masa', 'ev']],
    [['eczane', 'doktor', 'hastane', 'ilaç'], ['sağlık']],
    [['spor', 'gym', 'salon', 'fitness'], ['spor']],
  ];
  function guessCategory(desc, month) {
    const d = lower(desc);
    if (!d) return null;
    for (const k of monthKeys().reverse()) {
      const mm = state.months[k];
      const hit = [...mm.expenses].reverse().find((e) => lower(e.desc).replace(/\s*\(\d+\/\d+\)$/, '') === d);
      if (hit) {
        const cat = mm.categories.find((c) => c.id === hit.catId);
        const same = cat && month.categories.find((c) => lower(c.name) === lower(cat.name));
        if (same) return same.id;
      }
    }
    const direct = month.categories.find((c) => lower(c.name) === d || (d.length >= 3 && lower(c.name).startsWith(d)));
    if (direct) return direct.id;
    for (const [words, hints] of KEYWORDS) {
      if (words.some((w) => d.includes(w))) {
        for (const h of hints) { const cat = month.categories.find((c) => lower(c.name).includes(h)); if (cat) return cat.id; }
      }
    }
    return null;
  }
  function knownDescriptions() {
    const set = new Set();
    for (const k of monthKeys()) for (const e of state.months[k].expenses) if (e.desc) set.add(e.desc.replace(/\s*\(\d+\/\d+\)$/, ''));
    return [...set].slice(-200);
  }

  // ---------- Kurlar (Harem Altın öncelikli) ----------
  const ASSETS = {
    CEYREK: { name: 'Çeyrek Altın (yeni)', unit: 'adet', key: 'CEYREKALTIN', icon: '🪙' },
    CEYREK_ESKI: { name: 'Çeyrek Altın (eski)', unit: 'adet', key: 'CEYREK_ESKI', alt: 'CEYREKALTIN', icon: '🪙' },
    YARIM: { name: 'Yarım Altın (yeni)', unit: 'adet', key: 'YARIMALTIN', icon: '🪙' },
    YARIM_ESKI: { name: 'Yarım Altın (eski)', unit: 'adet', key: 'YARIM_ESKI', alt: 'YARIMALTIN', icon: '🪙' },
    TAM: { name: 'Tam Altın (yeni)', unit: 'adet', key: 'TAMALTIN', icon: '🪙' },
    TAM_ESKI: { name: 'Tam Altın (eski)', unit: 'adet', key: 'TAM_ESKI', alt: 'TAMALTIN', icon: '🪙' },
    CUMHURIYET: { name: 'Cumhuriyet / Ata Altın', unit: 'adet', key: 'ATAALTIN', icon: '🪙' },
    ATA_ESKI: { name: 'Ata Altın (eski)', unit: 'adet', key: 'ATA_ESKI', alt: 'ATAALTIN', icon: '🪙' },
    ATA5: { name: 'Ata Beşli', unit: 'adet', key: 'ATA5', icon: '🪙' },
    GREMSE: { name: 'Gremse (2,5)', unit: 'adet', key: 'GREMSE', icon: '🪙' },
    GRAM: { name: 'Gram Altın (külçe)', unit: 'gram', key: 'GRA', icon: '🟨' },
    HAS: { name: 'Has Altın', unit: 'gram', key: 'HAS', icon: '🟨' },
    A22: { name: '22 Ayar Bilezik', unit: 'gram', key: '22AYAR', icon: '📿' },
    A18: { name: '18 Ayar Altın', unit: 'gram', key: '18AYARALTIN', icon: '💍' },
    A14: { name: '14 Ayar Altın', unit: 'gram', key: '14AYARALTIN', icon: '💍' },
    GUMUS: { name: 'Gümüş', unit: 'gram', key: 'GUMUS', icon: '🥈' },
    USD: { name: 'Amerikan Doları', unit: '$', key: 'USD', icon: '💵' },
    EUR: { name: 'Euro', unit: '€', key: 'EUR', icon: '💶' },
    GBP: { name: 'İngiliz Sterlini', unit: '£', key: 'GBP', icon: '💷' },
    TRY: { name: 'Türk Lirası (nakit / hesap)', unit: '₺', key: null, icon: '🏦' },
  };
  const RATE_SHOW = [['GRA', 'Gram altın'], ['HAS', 'Has altın'], ['CEYREKALTIN', 'Çeyrek (yeni)'], ['CEYREK_ESKI', 'Çeyrek (eski)'], ['YARIMALTIN', 'Yarım (yeni)'], ['TAMALTIN', 'Tam (yeni)'], ['ATAALTIN', 'Ata / Cumhuriyet'], ['22AYAR', '22 ayar (gr)'], ['USD', 'Dolar'], ['EUR', 'Euro'], ['GBP', 'Sterlin'], ['GUMUS', 'Gümüş (gr)']];
  const HAREM_MAP = {
    GRA: 'KULCEALTIN', HAS: 'ALTIN', '22AYAR': 'AYAR22', '14AYARALTIN': 'AYAR14',
    CEYREKALTIN: 'CEYREK_YENI', CEYREK_ESKI: 'CEYREK_ESKI', YARIMALTIN: 'YARIM_YENI', YARIM_ESKI: 'YARIM_ESKI',
    TAMALTIN: 'TEK_YENI', TAM_ESKI: 'TEK_ESKI', ATAALTIN: 'ATA_YENI', ATA_ESKI: 'ATA_ESKI', ATA5: 'ATA5_YENI', GREMSE: 'GREMESE_YENI',
    GUMUS: 'GUMUSTRY', USD: 'USDTRY', EUR: 'EURTRY', GBP: 'GBPTRY',
  };

  function haremSnapshot(ms = 8000) {
    return new Promise((resolve, reject) => {
      let ws;
      const t = setTimeout(() => { try { ws && ws.close(); } catch {} reject(new Error('zaman aşımı')); }, ms);
      try { ws = new WebSocket('wss://hrmsocketonly.haremaltin.com/socket.io/?EIO=4&transport=websocket'); }
      catch (e) { clearTimeout(t); reject(e); return; }
      ws.onmessage = (msg) => {
        const s = String(msg.data);
        if (s[0] === '0') ws.send('40');
        else if (s === '2') ws.send('3');
        else if (s.startsWith('42')) {
          try {
            const [ev, p] = JSON.parse(s.slice(2));
            if (ev === 'price_changed' && p && p.data && p.data.ALTIN && p.data.KULCEALTIN) { clearTimeout(t); ws.close(); resolve(p); }
          } catch {}
        }
      };
      ws.onerror = () => { clearTimeout(t); reject(new Error('bağlantı')); };
    });
  }
  function normalizeHarem(p) {
    const out = {};
    for (const [k, code] of Object.entries(HAREM_MAP)) {
      const v = p.data[code];
      if (!v) continue;
      const buy = parseFloat(v.alis), sell = parseFloat(v.satis), close = parseFloat(v.kapanis);
      if (buy > 0) out[k] = { buy, sell: sell > 0 ? sell : buy, change: close > 0 ? ((sell - close) / close) * 100 : 0 };
    }
    if (out.HAS && !out['18AYARALTIN']) out['18AYARALTIN'] = { buy: out.HAS.buy * 0.75 * 0.97, sell: out.HAS.sell * 0.75 * 1.08, change: out.HAS.change };
    return out;
  }
  function normalizeTruncgil(d) {
    const out = {};
    for (const [k, v] of Object.entries(d)) {
      if (v && typeof v === 'object' && 'Buying' in v) {
        const buy = parseAmount(v.Buying), sell = parseAmount(v.Selling);
        if (isFinite(buy) && buy > 0) out[k] = { buy, sell: isFinite(sell) && sell > 0 ? sell : buy, change: +v.Change || 0 };
      }
    }
    if (out.HAS && !out['22AYAR']) out['22AYAR'] = { buy: out.HAS.buy * 0.916, sell: out.HAS.sell * 0.916 * 1.03, change: out.HAS.change };
    return out;
  }
  async function getJSON(url, ms = 9000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  let ratesLoading = false;
  async function refreshRates({ force = false, silent = false } = {}) {
    if (ratesLoading) return;
    const fresh = state.rates && Date.now() - state.rates.ts < 2 * 60 * 1000;
    if (fresh && !force) return;
    ratesLoading = true;
    if (route() === 'birikim' && !silent) renderView();
    const tries = [
      async () => { const p = await haremSnapshot(); return { data: normalizeHarem(p), source: 'Harem Altın', date: new Date(p.meta.time).toLocaleString('tr-TR') }; },
      async () => { const d = await getJSON('https://finans.truncgil.com/v4/today.json'); return { data: normalizeTruncgil(d), source: 'Truncgil (Kapalıçarşı)', date: d.Update_Date }; },
      async () => { const d = await getJSON('api/rates'); return { data: normalizeTruncgil(d), source: 'Truncgil (yerel sunucu)', date: d.Update_Date }; },
      async () => {
        const [g, fx] = await Promise.all([getJSON('https://api.gold-api.com/price/XAU'), getJSON('https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR,GBP')]);
        const usd = fx.rates.TRY, gram = (g.price * usd) / 31.1035;
        const mk = (v) => ({ buy: v, sell: v * 1.02, change: 0 });
        return { source: 'Tahmini (ons × dolar)', date: fx.date, data: {
          USD: mk(usd), EUR: mk(usd / fx.rates.EUR), GBP: mk(usd / fx.rates.GBP), HAS: mk(gram * 0.995), GRA: mk(gram),
          '22AYAR': mk(gram * 0.916), '18AYARALTIN': mk(gram * 0.73), '14AYARALTIN': mk(gram * 0.57),
          CEYREKALTIN: mk(gram * 1.6), YARIMALTIN: mk(gram * 3.2), TAMALTIN: mk(gram * 6.4), ATAALTIN: mk(gram * 6.62),
        } };
      },
    ];
    let got = null;
    for (const t of tries) {
      try { const r = await t(); if (r && r.data && r.data.GRA) { got = r; break; } } catch { /* sonraki kaynak */ }
    }
    ratesLoading = false;
    if (got) { state.rates = { ts: Date.now(), source: got.source, date: got.date, data: got.data }; save(); if (force && !silent) toast(`Kurlar güncellendi · ${got.source}`); }
    else if (force && !silent) toast('Kurlar alınamadı — internet bağlantını kontrol et');
    if (route() === 'birikim' && $('#sheet').hidden && !$('#app').hidden) renderView();
  }
  function unitPrice(type) {
    const a = ASSETS[type];
    if (!a) return null;
    if (!a.key) return 1;
    const o = state.rateOverrides[a.key];
    if (o) return o;
    const d = state.rates && state.rates.data;
    const r = d && (d[a.key] || (a.alt && d[a.alt]));
    return r ? r.buy : null; // bozdurma (alış) fiyatı
  }
  function portfolio() {
    const rows = state.savings.holdings.map((h) => {
      const p = unitPrice(h.type);
      const cost = h.qty * h.buyPrice;
      const value = p == null ? cost : h.qty * p;
      return { ...h, price: p, cost, value, pl: value - cost, plPct: cost ? ((value - cost) / cost) * 100 : 0, known: p != null };
    });
    const cost = sum(rows, 'cost'), value = sum(rows, 'value');
    return { rows, cost, value, pl: value - cost, plPct: cost ? ((value - cost) / cost) * 100 : 0 };
  }

  // ---------- UI altyapısı ----------
  const view = $('#view');
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2800);
  }
  function openSheet(title, html, onMount) {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    $('#sheet').hidden = false; $('#sheet-backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
    onMount && onMount($('#sheet-body'));
  }
  function closeSheet() {
    $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true;
    document.body.style.overflow = '';
    $('#sheet-body').innerHTML = '';
  }
  $('#sheet-close').onclick = closeSheet;
  $('#sheet-backdrop').onclick = closeSheet;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  const tip = $('#tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = clamp(x - r.width / 2, 8, window.innerWidth - r.width - 8) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  }
  const hideTip = () => (tip.hidden = true);
  window.addEventListener('scroll', hideTip, { passive: true });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.hit')) hideTip(); });

  function applyTheme() {
    const t = state && state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  const route = () => (location.hash.replace(/^#\/?/, '') || 'ozet').split('?')[0];

  // ---------- Ortak parçalar ----------
  function statusChip(c, phase) {
    switch (c.status) {
      case 'over': return `<span class="chip bad">▲ Aşım ${money(-c.diff)}</span>`;
      case 'unplanned': return `<span class="chip warn">◆ Plan dışı</span>`;
      case 'pending': return `<span class="chip neutral">○ Ödenmedi</span>`;
      case 'empty': return `<span class="chip neutral">Bütçe yok</span>`;
      case 'untouched': return phase === 'past' ? `<span class="chip good">✓ Tasarruf ${money(c.diff)}</span>` : `<span class="chip info">Kalan ${money(c.diff)}</span>`;
      case 'ok':
        if (c.diff === 0) return `<span class="chip good">✓ Tam plan</span>`;
        return phase === 'past' || c.fixed ? `<span class="chip good">✓ Tasarruf ${money(c.diff)}</span>` : `<span class="chip info">Kalan ${money(c.diff)}</span>`;
      default: return '';
    }
  }
  function ring(score) {
    const [, cls] = scoreLabel(score);
    const r = 36, C = 2 * Math.PI * r, off = C * (1 - score / 100);
    const col = cls === 'good' ? 'var(--good)' : cls === 'warn' ? 'var(--warn)' : 'var(--bad)';
    return `<svg class="ring" viewBox="0 0 84 84" role="img" aria-label="Başarı puanı ${score}">
      <circle class="bg" cx="42" cy="42" r="${r}"/>
      <circle cx="42" cy="42" r="${r}" stroke="${col}" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 42 42)"/>
      <text x="42" y="50" text-anchor="middle">${score}</text></svg>`;
  }
  function catBar(c) {
    const p = c.planned > 0 ? clamp((c.spent / c.planned) * 100, 0, 100) : (c.spent > 0 ? 100 : 0);
    const cls = c.status === 'over' || c.status === 'unplanned' ? 'over' : c.status === 'ok' && c.diff === 0 ? 'good' : '';
    return `<div class="bar"><i class="${cls}" style="width:${p}%"></i></div>`;
  }
  function emptyMonth(key) {
    const prev = monthKeys().filter((k) => k < key).pop() || monthKeys().filter((k) => k > key)[0];
    return `<div class="card empty">
      <div class="big">🗓️</div>
      <h3>${monthName(key)} için plan yok</h3>
      <p class="small">Gelirini, sabit giderlerini ve kategori bütçelerini ekleyerek başla.</p>
      ${prev ? `<button class="btn" data-act="copy-month" data-from="${prev}">${monthName(prev)} planını kopyala</button><div style="height:8px"></div>` : ''}
      <button class="btn secondary" data-act="blank-month">Boş plan oluştur</button>
      ${prev ? `<p class="hint">Kopyalama gelirleri, sabit giderleri ve kategori limitlerini aktarır; harcamaları aktarmaz.</p>` : ''}
    </div>`;
  }
  function bindEmptyMonth(key) {
    const b1 = $('[data-act="copy-month"]', view);
    if (b1) b1.onclick = () => {
      const src = state.months[b1.dataset.from];
      state.months[key] = { incomes: src.incomes.map((i) => ({ ...i, id: uid() })), categories: src.categories.map((c) => ({ ...c, id: uid() })), expenses: [], transferred: 0 };
      save(); toast('Plan kopyalandı'); renderView();
    };
    const b2 = $('[data-act="blank-month"]', view);
    if (b2) b2.onclick = () => { state.months[key] = { incomes: [], categories: [], expenses: [], transferred: 0 }; save(); renderView(); };
  }
  function warnAfterSave(month, catId) {
    const c = month.categories.find((x) => x.id === catId);
    if (!c) return 'Kaydedildi';
    const st = catStats(month, c);
    if (!(st.planned > 0)) return `${c.name}: bütçesi yok, ekstra sayıldı`;
    if (st.diff < 0) return `⚠︎ ${c.name}: ${money(-st.diff)} aşıldı`;
    if (st.spent / st.planned >= 0.8) return `⚠︎ ${c.name}: bütçenin %${Math.round((st.spent / st.planned) * 100)}'i doldu · ${money(st.diff)} kaldı`;
    return `${c.name}: ${money(st.diff)} kaldı`;
  }

  // ---------- Sayfa: Özet (ana sayfa) ----------
  function renderOzet() {
    const key = curMonthKey(), m = getMonth(key);
    if (!m) { view.innerHTML = emptyMonth(key); bindEmptyMonth(key); return; }
    const s = calc(m, key);
    const usedPct = s.income ? clamp((s.spent / s.income) * 100, 0, 100) : 0;
    const [lbl, lcls] = scoreLabel(s.score);
    const phaseNote = s.phase === 'current' ? 'Ay devam ediyor' : s.phase === 'future' ? 'Gelecek ay' : 'Ay kapandı';
    const daily = s.daysLeft > 0 ? s.varLeft / s.daysLeft : 0;
    const fixed = s.cats.filter((c) => c.fixed);
    const order = { over: 0, unplanned: 1, ok: 2, untouched: 3, empty: 4, pending: 5 };
    const vari = s.cats.filter((c) => !c.fixed).sort((a, b) => order[a.status] - order[b.status] || b.spent - a.spent);
    const unalloc = s.income - s.planned;
    const canTransfer = s.remaining > 0 && !(m.transferred > 0) && s.phase !== 'future';

    view.innerHTML = `
      <div class="card hero">
        <div class="hero-label">${s.phase === 'past' ? 'Ay sonunda kalan' : 'Toplam bütçeden kalan'}</div>
        <div class="hero-num ${s.remaining < 0 ? 'bad' : ''}">${money(s.remaining)}</div>
        <div class="hero-sub">Gelir ${money(s.income)} · Harcanan ${money(s.spent)}</div>
        <div class="bar thick" style="margin-top:12px"><i class="${s.spent > s.income ? 'over' : ''}" style="width:${usedPct}%"></i></div>
        <div class="stats">
          <div class="stat"><div class="k">Planlanan gider</div><div class="v">${money(s.planned)}</div></div>
          <div class="stat"><div class="k">Serbest cep (plansız)</div><div class="v ${s.plannedSaving < 0 ? 'bad' : ''}">${money(s.plannedSaving)}</div></div>
          <div class="stat"><div class="k">${s.phase === 'past' ? 'Plana göre' : 'Bütçede kalan'}</div><div class="v ${s.vsPlan < 0 ? 'bad' : 'good'}">${s.phase === 'past' ? signed(s.vsPlan) : money(s.vsPlan)}</div></div>
          <div class="stat"><div class="k">${s.phase === 'current' ? 'Günlük harcama hakkın' : 'Tasarruf oranı'}</div><div class="v">${s.phase === 'current' ? money(daily) : pct(s.savingRate)}</div></div>
        </div>
        ${unalloc < 0 ? `<p class="small bad" style="margin:10px 0 0">⚠︎ Planın gelirini ${money(-unalloc)} aşıyor.</p>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h3>💰 Gelirlerim</h3><button class="btn small" id="add-inc">+ Gelir</button></div>
        <ul class="list">${m.incomes.map((i) => `<li class="tap" data-inc="${i.id}"><div class="main"><div class="title">${esc(i.name)}</div>${i.note ? `<div class="sub">${esc(i.note)}</div>` : ''}</div><div class="amt good">+${money(i.amount)}</div></li>`).join('') || '<li class="muted small">Maaş, ek iş, burs gibi gelirlerini ekle.</li>'}</ul>
        ${m.incomes.length > 1 ? `<div class="card-foot"><span class="muted small">Toplam gelir</span><b>${money(s.income)}</b></div>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h3>📌 Sabit giderlerim</h3><button class="btn small secondary" id="add-fixed">+ Ekle</button></div>
        <ul class="list">${fixed.map((c) => `<li>
          <div class="main tap" data-editcat="${c.id}"><div class="title">${esc(c.emoji || '•')} ${esc(c.name)}</div>
            <div class="sub">${c.spent > 0 ? `Ödenen ${money(c.spent)}${c.diff !== 0 ? ` · ${c.diff > 0 ? 'plandan ' + money(c.diff) + ' az' : '<span class="bad">' + money(-c.diff) + ' fazla</span>'}` : ''}` : 'Henüz ödenmedi'}</div></div>
          <div class="right"><div class="amt">${money(c.planned)}</div>
            ${c.spent > 0 ? '<span class="chip good">✓ Ödendi</span>' : `<button class="btn small" data-pay="${c.id}">Öde</button>`}</div></li>`).join('') || '<li class="muted small">Kredi kartı, fatura, kira, abonelik gibi her ay ödediklerin.</li>'}</ul>
        ${fixed.length ? `<div class="card-foot"><span class="muted small">Ödenen ${money(sum(fixed, 'spent'))} / ${money(sum(fixed, 'planned'))}</span><b class="${s.pendingFixed > 0 ? '' : 'good'}">${s.pendingFixed > 0 ? 'Kalan ' + money(s.pendingFixed) : 'Hepsi ödendi'}</b></div>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h3>🗂️ Kategorilerim</h3><button class="btn small secondary" id="add-cat">+ Kategori</button></div>
        ${vari.length ? vari.map((c) => `<div class="cat-row">
            <div class="cat-top">
              <div class="cat-name tap" data-go="${c.id}"><span>${esc(c.emoji || '•')}</span><span class="t">${esc(c.name)}</span></div>
              <div class="cat-amt">${money(c.spent)} / ${money(c.planned)} <button class="mini-btn" data-editcat="${c.id}" aria-label="${esc(c.name)} düzenle">✎</button></div>
            </div>
            <div class="tap" data-go="${c.id}">${catBar(c)}</div>
            <div class="cat-bottom"><span>${statusChip(c, s.phase)}</span><span class="muted">${c.count} işlem</span></div>
          </div>`).join('') : `<div class="empty small">Kıyafet, market, kafe gibi limit koyacağın kategorileri ekle.</div>`}
        <p class="hint">Bir kategoriye dokununca İşlem sayfasında detayını ve bu ayki harcamalarını görürsün. ✎ ile tutarı değiştir veya sil.</p>
      </div>

      <div class="card">
        <div class="card-head"><h3>Ay sonu analizi</h3><span class="muted tiny">${phaseNote}</span></div>
        <div class="score">
          ${ring(s.score)}
          <div>
            <div style="font-weight:700;font-size:17px" class="${lcls}">${lbl}</div>
            <div class="small muted">${s.withinCount}/${s.plannedCount} kategori bütçe içinde.<br>${s.phase === 'past'
              ? (s.vsPlan >= 0 ? `Plana göre <b class="good">${money(s.vsPlan)} kârla</b> kapattın.` : `Plana göre <b class="bad">${money(-s.vsPlan)} zararla</b> kapattın.`)
              : (s.lost > 0 ? `Şu ana kadar <b class="bad">${money(s.lost)} aşım</b> var.` : `Şu ana kadar <b class="good">aşım yok</b>.`)}</div>
          </div>
        </div>
        <ul class="list" style="margin-top:12px">
          <li><div class="main"><div class="title">Plan içi harcama</div><div class="sub">Bütçe limitleri içinde kalan kısım</div></div><div class="amt">${money(s.inPlan)}</div></li>
          <li><div class="main"><div class="title">Bütçe aşımı</div><div class="sub">Planlı kategorilerde limiti geçen</div></div><div class="amt ${s.overrun ? 'bad' : ''}">${money(s.overrun)}</div></li>
          <li><div class="main"><div class="title">Ekstra (plan dışı)</div><div class="sub">Planda olmayan / ekstra işaretli</div></div><div class="amt ${s.extra ? 'warn' : ''}">${money(s.extra)}</div></li>
          <li><div class="main"><div class="title">Kâr edilen (tasarruf)</div><div class="sub">${s.phase === 'past' ? 'Limitin altında kalan kategoriler' : 'Ödenmiş sabitlerde plandan artan'}</div></div><div class="amt good">+${money(s.saved)}</div></li>
          ${s.phase !== 'past' ? `<li><div class="main"><div class="title">Henüz harcanmamış bütçe</div><div class="sub">Ay sonunda harcanmazsa kâra döner</div></div><div class="amt">${money(s.openBudget)}</div></li>` : ''}
          <li><div class="main"><div class="title">Zarar edilen</div><div class="sub">Limiti aşan + plansız kategoriler</div></div><div class="amt ${s.lost ? 'bad' : ''}">${s.lost ? '−' + money(s.lost) : money(0)}</div></li>
          <li><div class="main"><div class="title">Totalde sana kalan</div><div class="sub">Gelir − tüm harcamalar</div></div><div class="amt ${s.remaining < 0 ? 'bad' : ''}" style="font-size:17px">${money(s.remaining)}</div></li>
        </ul>
        ${canTransfer ? `<button class="btn secondary" style="margin-top:10px" id="btn-transfer">Kalanı (${money(s.remaining)}) birikime aktar</button>` : ''}
        ${m.transferred > 0 ? `<p class="hint">✓ Bu aydan ${money(m.transferred)} birikime aktarıldı.</p>` : ''}
      </div>`;

    $('#add-inc').onclick = () => incomeForm(m);
    $$('[data-inc]', view).forEach((li) => (li.onclick = () => incomeForm(m, m.incomes.find((i) => i.id === li.dataset.inc))));
    $('#add-fixed').onclick = () => categoryForm(m, null, true);
    $('#add-cat').onclick = () => categoryForm(m, null, false);
    $$('[data-editcat]', view).forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); categoryForm(m, m.categories.find((c) => c.id === b.dataset.editcat)); }));
    $$('[data-go]', view).forEach((b) => (b.onclick = () => { state.ui.cat = b.dataset.go; state.ui.mode = 'gider'; location.hash = '#/islem'; }));
    $$('[data-pay]', view).forEach((b) => (b.onclick = () => {
      const c = m.categories.find((x) => x.id === b.dataset.pay);
      payFixed(m, key, c);
    }));
    const bt = $('#btn-transfer');
    if (bt) bt.onclick = () => {
      if (!confirm(`${money(s.remaining)} Türk Lirası olarak birikimine eklensin mi?`)) return;
      state.savings.holdings.push({ id: uid(), type: 'TRY', qty: Math.round(s.remaining), buyPrice: 1, date: todayISO(), note: `${monthName(key)} artanı` });
      m.transferred = Math.round(s.remaining);
      save(); toast('Birikime aktarıldı'); renderView();
    };
  }

  function payFixed(m, key, c) {
    openSheet(`${c.name} — öde`, `
      <form id="f">
        <div class="field"><label>Ödenen tutar</label><input class="input big" name="amount" inputmode="decimal" value="${amtStr(c.planned)}"></div>
        <div class="field"><label>Tarih</label><input class="input" type="date" name="date" value="${monthKeyOf() === key ? todayISO() : key + '-01'}"></div>
        <p class="hint" style="margin-top:-4px">Ekstre/fatura plandan farklı geldiyse tutarı değiştir; fark kâr ya da zarar olarak yazılır.</p>
        <button class="btn" type="submit">Ödendi olarak kaydet</button>
      </form>`, (root) => {
      const f = $('#f', root);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount > 0)) return toast('Geçerli bir tutar gir');
        m.expenses.push({ id: uid(), catId: c.id, desc: c.name, amount, date: f.date.value, extra: false });
        save(); closeSheet(); toast(`${c.name} ödendi`); renderView();
      };
    });
  }

  // ---------- Sayfa: İşlem (giriş / çıkış) ----------
  function renderIslem() {
    const key = curMonthKey(), m = getMonth(key);
    if (!m) { view.innerHTML = emptyMonth(key); bindEmptyMonth(key); return; }
    const mode = state.ui.mode || 'gider';
    if (state.ui.cat && !m.categories.some((c) => c.id === state.ui.cat)) {
      // Ay değişince aynı isimli kategoriyi seçili tut
      state.ui.cat = null;
    }
    const sel = m.categories.find((c) => c.id === state.ui.cat);
    const st = sel ? catStats(m, sel) : null;
    const s = calc(m, key);
    const defDate = monthKeyOf() === key ? todayISO() : `${key}-01`;
    const catById = Object.fromEntries(m.categories.map((c) => [c.id, c]));
    const history = [...m.expenses].filter((e) => !sel || e.catId === sel.id).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));

    const giderHTML = `
      <div class="card">
        <div class="card-head"><h3>Hangi kategori?</h3><button class="link-btn" id="new-cat">+ Yeni</button></div>
        <div class="cat-grid">
          ${[...s.cats.filter((c) => !c.fixed), ...s.cats.filter((c) => c.fixed)].map((c) => `<button class="cat-pick ${sel && sel.id === c.id ? 'on' : ''}" data-pick="${c.id}">
            <span class="e">${esc(c.emoji || '•')}</span><span class="n">${esc(c.name)}</span>
            <span class="l ${c.diff < 0 ? 'bad' : ''}">${c.fixed && c.spent > 0 && c.diff >= 0 ? '✓ ödendi' : c.planned > 0 ? (c.diff < 0 ? '−' + money(-c.diff) : money(c.diff) + ' kaldı') : 'bütçesiz'}</span></button>`).join('')}
        </div>
      </div>

      ${st ? `<div class="card">
        <div class="card-head"><h3>${esc(st.emoji || '')} ${esc(st.name)}</h3><button class="link-btn" id="edit-sel">Düzenle</button></div>
        <div class="stats" style="margin-top:0;grid-template-columns:repeat(3,1fr)">
          <div class="stat"><div class="k">Ayrılan</div><div class="v">${money(st.planned)}</div></div>
          <div class="stat"><div class="k">Harcanan</div><div class="v">${money(st.spent)}</div></div>
          <div class="stat"><div class="k">${st.diff < 0 ? 'Aşım' : 'Kalan'}</div><div class="v ${st.diff < 0 ? 'bad' : 'good'}">${money(Math.abs(st.diff))}</div></div>
        </div>
        <div style="margin-top:12px">${catBar(st)}</div>
        <div class="cat-bottom"><span>${statusChip(st, s.phase)}</span><span class="muted">${st.planned > 0 ? '%' + Math.round((st.spent / st.planned) * 100) + ' kullanıldı' : ''}</span></div>
      </div>` : ''}

      <div class="card">
        <h3>Gider gir</h3>
        <form id="f" autocomplete="off">
          <div class="field"><input class="input big" name="amount" inputmode="decimal" placeholder="₺0" required></div>
          <div class="field"><label>Ne aldın / nereye? <span class="muted">(yazınca kategori otomatik seçilir)</span></label>
            <input class="input" name="desc" list="desc-list" placeholder="ör. Boston, BİM, Trendyol">
            <datalist id="desc-list">${knownDescriptions().map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
            <div class="hint" id="guess-hint"></div></div>
          <div class="field"><label>Kategori</label>
            <select class="input" name="catId" required>
              <option value="">Kategori seç</option>
              ${m.categories.map((c) => `<option value="${c.id}" ${sel && sel.id === c.id ? 'selected' : ''}>${esc(c.emoji || '')} ${esc(c.name)}</option>`).join('')}
            </select>
            <div class="hint" id="cat-left"></div></div>
          <div class="row2">
            <div class="field"><label>Tarih</label><input class="input" type="date" name="date" value="${defDate}" required></div>
            <div class="field"><label>Taksit</label><select class="input" name="taksit">${[1, 2, 3, 4, 5, 6, 9, 12].map((n) => `<option value="${n}">${n === 1 ? 'Tek çekim' : n + ' taksit'}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label>Not</label><input class="input" name="note" placeholder="İsteğe bağlı"></div>
          <label class="check"><input type="checkbox" name="extra"> Plan dışı / ekstra harcama</label>
          <button class="btn" type="submit">Kaydet</button>
        </form>
      </div>

      <div class="section-title">${monthName(key)} · ${sel ? esc(sel.name) : 'tüm'} hareketleri</div>
      ${history.length ? `<div class="card" style="padding:4px 16px"><ul class="list">${history.map((e) => {
        const c = catById[e.catId];
        const extra = e.extra || !(+c?.planned > 0);
        return `<li class="tap" data-exp="${e.id}">
          <div class="main"><div class="title">${esc(e.desc || c?.name || 'Harcama')}</div>
          <div class="sub">${shortDate(e.date)}${sel ? '' : ' · ' + esc(c ? (c.emoji || '') + ' ' + c.name : 'Kategorisiz')}${extra ? ' · <span class="warn">Ekstra</span>' : ''}${e.group ? ' · taksit' : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
          <div class="amt">−${money(e.amount)}</div></li>`;
      }).join('')}</ul>
      <div class="card-foot"><span class="muted small">${history.length} işlem</span><b>${money(sum(history, 'amount'))}</b></div></div>`
      : `<div class="card empty small">${sel ? 'Bu kategoride bu ay henüz harcama yok.' : 'Bu ay henüz harcama yok.'}</div>`}
      ${sel ? '<button class="btn secondary" id="show-all">Tüm kategorileri göster</button>' : `<button class="btn secondary" id="csv">Bu ayı CSV (Excel) olarak indir</button>`}`;

    const gelirHTML = `
      <div class="card">
        <h3>Gelir gir</h3>
        <form id="fi" autocomplete="off">
          <div class="field"><input class="input big" name="amount" inputmode="decimal" placeholder="₺0" required></div>
          <div class="field"><label>Gelir adı</label><input class="input" name="name" list="inc-list" placeholder="ör. Maaş, Ek iş, Prim" required>
            <datalist id="inc-list">${[...new Set(monthKeys().flatMap((k) => state.months[k].incomes.map((i) => i.name)))].map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
          <div class="field"><label>Not</label><input class="input" name="note" placeholder="İsteğe bağlı"></div>
          <button class="btn" type="submit">Geliri ekle</button>
        </form>
      </div>
      <div class="section-title">${monthName(key)} gelirleri</div>
      <div class="card" style="padding:4px 16px"><ul class="list">${m.incomes.map((i) => `<li class="tap" data-inc="${i.id}"><div class="main"><div class="title">${esc(i.name)}</div>${i.note ? `<div class="sub">${esc(i.note)}</div>` : ''}</div><div class="amt good">+${money(i.amount)}</div></li>`).join('') || '<li class="muted small">Henüz gelir yok.</li>'}</ul>
      <div class="card-foot"><span class="muted small">Toplam</span><b>${money(s.income)}</b></div></div>`;

    view.innerHTML = `
      <div class="seg" id="mode"><button data-m="gider" class="${mode === 'gider' ? 'on' : ''}">− Gider (çıkış)</button><button data-m="gelir" class="${mode === 'gelir' ? 'on' : ''}">+ Gelir (giriş)</button></div>
      ${mode === 'gelir' ? gelirHTML : giderHTML}`;

    $$('#mode button').forEach((b) => (b.onclick = () => { state.ui.mode = b.dataset.m; renderIslem(); }));

    if (mode === 'gelir') {
      const fi = $('#fi');
      fi.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(fi.amount.value);
        if (!(amount > 0)) return toast('Geçerli bir tutar gir');
        m.incomes.push({ id: uid(), name: fi.name.value.trim(), amount, note: fi.note.value.trim() });
        save(); toast(`+${money(amount)} gelir eklendi`); renderIslem();
      };
      $$('[data-inc]', view).forEach((li) => (li.onclick = () => incomeForm(m, m.incomes.find((i) => i.id === li.dataset.inc))));
      return;
    }

    $$('[data-pick]', view).forEach((b) => (b.onclick = () => { state.ui.cat = state.ui.cat === b.dataset.pick ? null : b.dataset.pick; renderIslem(); }));
    $('#new-cat').onclick = () => categoryForm(m, null, false);
    const es = $('#edit-sel'); if (es) es.onclick = () => categoryForm(m, sel);
    const sa = $('#show-all'); if (sa) sa.onclick = () => { state.ui.cat = null; renderIslem(); };
    const csv = $('#csv'); if (csv) csv.onclick = () => exportCSV(m, key);
    $$('[data-exp]', view).forEach((li) => (li.onclick = () => expenseForm(m.expenses.find((e) => e.id === li.dataset.exp))));

    const f = $('#f');
    let touched = !!sel;
    const left = () => {
      const c = m.categories.find((x) => x.id === f.catId.value);
      const h = $('#cat-left');
      if (!c) { h.textContent = ''; return; }
      const cs = catStats(m, c);
      const n = +f.taksit.value || 1;
      const amt = (parseAmount(f.amount.value) || 0) / n;
      const rest = cs.planned - cs.spent - amt;
      h.innerHTML = cs.planned > 0
        ? `Ayrılan ${money(cs.planned)} · harcanan ${money(cs.spent)} → bundan sonra <b class="${rest < 0 ? 'bad' : 'good'}">${rest < 0 ? money(-rest) + ' aşım' : money(rest) + ' kalır'}</b>${n > 1 ? ` (bu ay ${money(amt)})` : ''}`
        : `<span class="warn">Bu kategoride bütçe yok — ekstra sayılır.</span>`;
    };
    f.catId.onchange = () => { touched = true; left(); };
    f.amount.oninput = left;
    f.taksit.onchange = left;
    f.desc.oninput = () => {
      if (touched) return;
      const g = guessCategory(f.desc.value, m);
      if (g) { f.catId.value = g; $('#guess-hint').textContent = `✨ ${catById[g].name} seçildi`; left(); }
    };
    left();
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const amount = parseAmount(f.amount.value);
      if (!(amount > 0)) return toast('Geçerli bir tutar gir');
      if (!f.catId.value) return toast('Kategori seç');
      const data = { desc: f.desc.value.trim(), amount, catId: f.catId.value, date: f.date.value, extra: f.extra.checked, note: f.note.value.trim() };
      const res = addExpense(m, key, data, +f.taksit.value || 1);
      if (!res) return;
      save();
      state.ui.cat = res.catIdInView || state.ui.cat;
      renderIslem();
      toast(res.msg);
    };
  }

  // Gideri ekler; taksitliyse sonraki aylara böler (gerekirse ayı/kategoriyi oluşturur)
  function addExpense(m, key, data, n) {
    const targetKey = data.date.slice(0, 7);
    const catName = m.categories.find((c) => c.id === data.catId)?.name;
    const srcCat = m.categories.find((c) => c.id === data.catId);
    const findCat = (mm) => {
      let c = mm.categories.find((x) => lower(x.name) === lower(catName));
      if (!c) { c = { ...srcCat, id: uid() }; mm.categories.push(c); }
      return c;
    };
    const group = n > 1 ? uid() : undefined;
    const per = Math.round((data.amount / n) * 100) / 100;
    const day = Number(data.date.slice(8, 10));
    let firstMonth = null, firstCat = null;
    for (let i = 0; i < n; i++) {
      const k = addMonth(targetKey, i);
      const mm = k === key ? m : ensureMonth(k);
      const c = mm === m && k === key ? srcCat : findCat(mm);
      const amt = i === n - 1 ? Math.round((data.amount - per * (n - 1)) * 100) / 100 : per;
      mm.expenses.push({
        id: uid(), ...data, catId: c.id, amount: amt,
        date: `${k}-${pad(Math.min(day, daysInMonth(k)))}`,
        desc: n > 1 ? `${data.desc || catName} (${i + 1}/${n})` : data.desc,
        ...(group ? { group, total: data.amount } : {}),
      });
      if (i === 0) { firstMonth = mm; firstCat = c; }
    }
    let msg = warnAfterSave(firstMonth, firstCat.id);
    if (n > 1) msg = `${n} taksit: ayda ${money(per)} · ${msg}`;
    if (targetKey !== key) msg = `${monthName(targetKey)} ayına kaydedildi · ${msg}`;
    return { msg, catIdInView: targetKey === key ? firstCat.id : null };
  }

  function exportCSV(m, key) {
    const catById = Object.fromEntries(m.categories.map((c) => [c.id, c]));
    const rows = [['Tarih', 'Açıklama', 'Kategori', 'Tutar', 'Ekstra', 'Not']].concat(
      [...m.expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.desc, catById[e.catId]?.name || '', String(e.amount).replace('.', ','), e.extra ? 'Evet' : 'Hayır', e.note || '']));
    download(`harcamalar-${key}.csv`, '﻿' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
  }

  // Hızlı gider ekleme / düzenleme (alt sayfa)
  function expenseForm(exp) {
    const key = curMonthKey();
    const m = getMonth(key);
    if (!m) { toast('Önce bu ay için bir plan oluştur'); return; }
    if (!m.categories.length) { toast('Önce bir kategori ekle'); categoryForm(m, null, false); return; }
    const isNew = !exp;
    const e = exp || { desc: '', amount: '', catId: state.ui.cat || '', date: monthKeyOf() === key ? todayISO() : `${key}-01`, extra: false, note: '' };
    openSheet(isNew ? 'Gider ekle' : 'Gideri düzenle', `
      <form id="f" autocomplete="off">
        <div class="field"><input class="input big" name="amount" inputmode="decimal" placeholder="₺0" value="${amtStr(e.amount)}" required></div>
        <div class="field"><label>Ne aldın / nereye?</label>
          <input class="input" name="desc" list="desc-list2" placeholder="ör. Boston, BİM" value="${esc(e.desc)}">
          <datalist id="desc-list2">${knownDescriptions().map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
          <div class="hint" id="guess-hint"></div></div>
        <div class="field"><label>Hangi bütçeden düşsün?</label>
          <select class="input" name="catId" required><option value="">Kategori seç</option>
            ${m.categories.map((c) => `<option value="${c.id}" ${c.id === e.catId ? 'selected' : ''}>${esc(c.emoji || '')} ${esc(c.name)}</option>`).join('')}</select>
          <div class="hint" id="cat-left"></div></div>
        <div class="row2">
          <div class="field"><label>Tarih</label><input class="input" type="date" name="date" value="${e.date}" required></div>
          ${isNew ? `<div class="field"><label>Taksit</label><select class="input" name="taksit">${[1, 2, 3, 4, 5, 6, 9, 12].map((n) => `<option value="${n}">${n === 1 ? 'Tek çekim' : n + ' taksit'}</option>`).join('')}</select></div>`
                  : `<div class="field"><label>Not</label><input class="input" name="note" value="${esc(e.note || '')}"></div>`}
        </div>
        ${isNew ? `<div class="field"><label>Not</label><input class="input" name="note" placeholder="İsteğe bağlı"></div>` : ''}
        <label class="check"><input type="checkbox" name="extra" ${e.extra ? 'checked' : ''}> Plan dışı / ekstra harcama</label>
        <button class="btn" type="submit">${isNew ? 'Kaydet' : 'Güncelle'}</button>
        ${isNew ? '' : `<div class="btn-row"><button class="btn danger" type="button" id="del">Sil</button>${e.group ? '<button class="btn danger" type="button" id="del-all">Tüm taksitleri sil</button>' : ''}</div>`}
      </form>`, (root) => {
      const f = $('#f', root);
      let touched = !!e.catId;
      const left = () => {
        const c = m.categories.find((x) => x.id === f.catId.value);
        const h = $('#cat-left', root);
        if (!c) { h.textContent = ''; return; }
        const spent = sum(m.expenses.filter((x) => x.catId === c.id && x.id !== e.id), 'amount');
        const n = f.taksit ? +f.taksit.value || 1 : 1;
        const rest = (+c.planned || 0) - spent - (parseAmount(f.amount.value) || 0) / n;
        h.innerHTML = c.planned > 0
          ? `Bundan sonra <b class="${rest < 0 ? 'bad' : 'good'}">${rest < 0 ? money(-rest) + ' aşım' : money(rest) + ' kalır'}</b>`
          : `<span class="warn">Bu kategoride bütçe yok — ekstra sayılır.</span>`;
      };
      f.catId.onchange = () => { touched = true; left(); };
      f.amount.oninput = left;
      if (f.taksit) f.taksit.onchange = left;
      f.desc.oninput = () => {
        if (touched) return;
        const g = guessCategory(f.desc.value, m);
        if (g) { f.catId.value = g; $('#guess-hint', root).textContent = '✨ Kategori otomatik seçildi'; left(); }
      };
      left();
      if (isNew) setTimeout(() => f.amount.focus(), 250);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount > 0)) return toast('Geçerli bir tutar gir');
        if (!f.catId.value) return toast('Kategori seç');
        const data = { desc: f.desc.value.trim(), amount, catId: f.catId.value, date: f.date.value, extra: f.extra.checked, note: f.note.value.trim() };
        if (isNew) {
          const res = addExpense(m, key, data, +f.taksit.value || 1);
          save(); closeSheet(); renderView(); toast(res.msg); return;
        }
        const targetKey = data.date.slice(0, 7);
        if (targetKey !== key) {
          const tm = ensureMonth(targetKey);
          const cname = lower(m.categories.find((c) => c.id === data.catId)?.name);
          let tc = tm.categories.find((c) => lower(c.name) === cname);
          if (!tc) { tc = { ...m.categories.find((c) => c.id === data.catId), id: uid() }; tm.categories.push(tc); }
          m.expenses = m.expenses.filter((x) => x.id !== e.id);
          tm.expenses.push({ ...e, ...data, catId: tc.id });
        } else Object.assign(e, data);
        save(); closeSheet(); renderView(); toast('Güncellendi');
      };
      const del = $('#del', root);
      if (del) del.onclick = () => { if (confirm('Bu gider silinsin mi?')) { m.expenses = m.expenses.filter((x) => x.id !== e.id); save(); closeSheet(); toast('Silindi'); renderView(); } };
      const delAll = $('#del-all', root);
      if (delAll) delAll.onclick = () => {
        if (!confirm('Bu alışverişin tüm aylardaki taksitleri silinsin mi?')) return;
        for (const k of monthKeys()) state.months[k].expenses = state.months[k].expenses.filter((x) => x.group !== e.group);
        save(); closeSheet(); toast('Tüm taksitler silindi'); renderView();
      };
    });
  }

  function incomeForm(m, inc) {
    const isNew = !inc;
    const i = inc || { name: 'Maaş', amount: '', note: '' };
    openSheet(isNew ? 'Gelir ekle' : 'Geliri düzenle', `
      <form id="f">
        <div class="field"><label>Gelir adı</label><input class="input" name="name" value="${esc(i.name)}" required></div>
        <div class="field"><label>Tutar</label><input class="input" name="amount" inputmode="decimal" value="${amtStr(i.amount)}" placeholder="₺0" required></div>
        <div class="field"><label>Not</label><input class="input" name="note" value="${esc(i.note || '')}" placeholder="İsteğe bağlı"></div>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : '<div class="btn-row"><button class="btn danger" type="button" id="del">Sil</button></div>'}
      </form>`, (root) => {
      const f = $('#f', root);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount >= 0)) return toast('Geçerli bir tutar gir');
        const data = { name: f.name.value.trim(), amount, note: f.note.value.trim() };
        if (isNew) m.incomes.push({ id: uid(), ...data }); else Object.assign(inc, data);
        save(); closeSheet(); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => { if (confirm('Gelir silinsin mi?')) { m.incomes = m.incomes.filter((x) => x.id !== inc.id); save(); closeSheet(); renderView(); } };
    });
  }

  function categoryForm(m, cat, fixedDefault) {
    const isNew = !cat;
    const c = cat || { name: '', planned: '', fixed: !!fixedDefault, emoji: '' };
    const used = cat ? m.expenses.filter((e) => e.catId === cat.id) : [];
    const others = cat ? m.categories.filter((x) => x.id !== cat.id) : [];
    openSheet(isNew ? (c.fixed ? 'Sabit gider ekle' : 'Kategori ekle') : 'Düzenle', `
      <form id="f">
        <div class="row2" style="grid-template-columns:80px 1fr">
          <div class="field"><label>Simge</label><input class="input" name="emoji" value="${esc(c.emoji || '')}" maxlength="4" placeholder="${c.fixed ? '💳' : '👕'}" style="text-align:center"></div>
          <div class="field"><label>Ad</label><input class="input" name="name" value="${esc(c.name)}" placeholder="${c.fixed ? 'ör. Kira, Elektrik' : 'ör. Kıyafet'}" required></div>
        </div>
        <div class="field"><label>${monthName(curMonthKey())} için ayrılan tutar</label><input class="input" name="planned" inputmode="decimal" value="${amtStr(c.planned)}" placeholder="₺0 (0 = bütçesiz)"></div>
        <label class="check"><input type="checkbox" name="fixed" ${c.fixed ? 'checked' : ''}> Sabit gider (fatura, kredi kartı, kira, abonelik) — ana sayfada “Öde” düğmesiyle görünür</label>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : `
          ${used.length && others.length ? `<div class="field" style="margin-top:14px"><label>Silerken ${used.length} harcamayı şuraya taşı</label>
            <select class="input" name="moveTo">${others.map((o) => `<option value="${o.id}">${esc(o.emoji || '')} ${esc(o.name)}</option>`).join('')}</select></div>` : ''}
          <div class="btn-row"><button class="btn danger" type="button" id="del">Kategoriyi sil</button></div>`}
      </form>`, (root) => {
      const f = $('#f', root);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const planned = f.planned.value.trim() ? parseAmount(f.planned.value) : 0;
        if (!(planned >= 0)) return toast('Geçerli bir tutar gir');
        const data = { name: f.name.value.trim(), planned, fixed: f.fixed.checked, emoji: f.emoji.value.trim() };
        if (isNew) m.categories.push({ id: uid(), ...data }); else Object.assign(cat, data);
        save(); closeSheet(); toast('Kaydedildi'); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => {
        if (used.length && !others.length) return toast('Önce bu kategorideki harcamaları sil');
        const msg = used.length ? `${cat.name} silinsin ve ${used.length} harcama taşınsın mı?` : `${cat.name} silinsin mi?`;
        if (!confirm(msg)) return;
        if (used.length) { const to = f.moveTo.value; used.forEach((e) => (e.catId = to)); }
        m.categories = m.categories.filter((x) => x.id !== cat.id);
        if (state.ui.cat === cat.id) state.ui.cat = null;
        save(); closeSheet(); toast('Silindi'); renderView();
      };
    });
  }

  // ---------- Sayfa: Rapor ----------
  function renderRapor() {
    const keys = monthKeys().filter((k) => { const m = state.months[k]; return m.categories.length || m.expenses.length || m.incomes.length; });
    if (!keys.length) { view.innerHTML = `<div class="card empty"><div class="big">📊</div>Henüz rapor için veri yok.</div>`; return; }
    const rows = keys.map((k) => ({ key: k, ...calc(state.months[k], k) }));
    const last = rows.slice(-12);
    const done = rows.filter((r) => r.phase === 'past');
    const avgScore = done.length ? Math.round(sum(done, 'score') / done.length) : null;
    const totals = { income: sum(rows, 'income'), planned: sum(rows, 'planned'), spent: sum(rows, 'spent') };
    const byName = {};
    rows.forEach((r) => r.cats.forEach((c) => {
      const k = lower(c.name);
      const o = (byName[k] = byName[k] || { name: c.name, emoji: c.emoji, planned: 0, spent: 0, over: 0, months: 0 });
      o.planned += c.planned; o.spent += c.spent; o.months++; if (c.spent > c.planned) o.over++;
    }));
    const catRows = Object.values(byName).sort((a, b) => (b.spent - b.planned) - (a.spent - a.planned));
    // Gelecek aylara yazılmış taksit yükü
    const futureInst = monthKeys().filter((k) => k > monthKeyOf()).map((k) => ({ k, t: sum(state.months[k].expenses.filter((e) => e.group), 'amount') })).filter((x) => x.t > 0);

    view.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Planlanan ve harcanan</h3><span class="muted tiny">Son ${last.length} ay</span></div>
        <div class="legend"><span><i style="background:var(--plan)"></i>Planlanan</span><span><i style="background:var(--spent)"></i>Harcanan</span><span><i style="background:var(--good);border-radius:50%"></i>Gelir</span></div>
        ${barChart(last)}
      </div>
      <div class="card">
        <div class="card-head"><h3>Finansal başarı</h3>${avgScore != null ? `<span class="chip ${scoreLabel(avgScore)[1]}">Ortalama ${avgScore}</span>` : ''}</div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Ay</th><th>Gelir</th><th>Planlanan</th><th>Harcanan</th><th>Plana göre</th><th>Kalan</th><th>Tasarruf</th><th>Başarı</th></tr></thead>
          <tbody>${rows.slice().reverse().map((r) => `<tr class="${r.phase === 'current' ? 'cur' : ''}">
            <td>${monthName(r.key, true)}${r.phase === 'current' ? ' •' : r.phase === 'future' ? ' ◦' : ''}</td>
            <td>${money(r.income)}</td><td>${money(r.planned)}</td><td>${money(r.spent)}</td>
            <td class="${r.vsPlan < 0 ? 'bad' : 'good'}">${signed(r.vsPlan)}</td>
            <td class="${r.remaining < 0 ? 'bad' : ''}">${money(r.remaining)}</td>
            <td>${pct(r.savingRate)}</td>
            <td><span class="chip ${scoreLabel(r.score)[1]}">${r.score}</span></td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Toplam</td><td>${money(totals.income)}</td><td>${money(totals.planned)}</td><td>${money(totals.spent)}</td>
            <td class="${totals.planned - totals.spent < 0 ? 'bad' : 'good'}">${signed(totals.planned - totals.spent)}</td>
            <td>${money(totals.income - totals.spent)}</td><td>${totals.income ? pct(((totals.income - totals.spent) / totals.income) * 100) : '—'}</td><td></td></tr></tfoot>
        </table></div>
        <p class="hint">• devam eden ay, ◦ gelecek ay. Başarı puanı: %50 bütçe içinde kalan kategori oranı + %50 planlanan birikime ulaşma; ekstra harcama kadar puan düşer.</p>
      </div>
      ${futureInst.length ? `<div class="card"><h3>Gelecek taksit yükü</h3><ul class="list">${futureInst.map((x) => `<li><div class="main"><div class="title">${monthName(x.k)}</div></div><div class="amt">${money(x.t)}</div></li>`).join('')}</ul></div>` : ''}
      <div class="card">
        <h3>Kategori karnesi (tüm aylar)</h3>
        <div class="table-wrap"><table class="t" style="min-width:460px">
          <thead><tr><th>Kategori</th><th>Planlanan</th><th>Harcanan</th><th>Fark</th><th>Aşılan ay</th></tr></thead>
          <tbody>${catRows.map((c) => `<tr><td>${esc(c.emoji || '')} ${esc(c.name)}</td><td>${money(c.planned)}</td><td>${money(c.spent)}</td>
            <td class="${c.planned - c.spent < 0 ? 'bad' : 'good'}">${signed(c.planned - c.spent)}</td><td>${c.over}/${c.months}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    bindChart();
  }

  function barChart(rows) {
    const W = 640, H = 230, padL = 50, padB = 26, padT = 10;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.planned, r.spent, r.income))) * 1.08;
    const step = (W - padL) / rows.length;
    const bw = Math.min(22, step * 0.32);
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      g += `<line class="grid" x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}"/><text x="${padL - 6}" y="${yy + 4}" text-anchor="end">${v >= 1000 ? nf0.format(Math.round(v / 1000)) + ' bin' : nf0.format(v)}</text>`;
    }
    const bar = (x, v, fill) => {
      const top = y(v), h = Math.max(0, y(0) - top);
      if (h <= 0) return '';
      const r = Math.min(4, h, bw / 2);
      return `<path fill="${fill}" d="M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z"/>`;
    };
    const bars = rows.map((r, i) => {
      const cx = padL + step * i + step / 2;
      return `${bar(cx - bw - 1, r.planned, 'var(--plan)')}${bar(cx + 1, r.spent, r.spent > r.planned ? 'var(--bad)' : 'var(--spent)')}
        <circle cx="${cx}" cy="${y(r.income)}" r="4.5" fill="var(--good)" stroke="var(--surface)" stroke-width="2"/>
        <text x="${cx}" y="${H - 8}" text-anchor="middle">${monthName(r.key, true)}</text>
        <rect class="hit" x="${padL + step * i}" y="${padT}" width="${step}" height="${H - padT}" data-i="${i}"/>`;
    }).join('');
    barChart._rows = rows;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Aylara göre planlanan ve harcanan">${g}<line class="grid" x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--text-3)"/>${bars}</svg>
      <p class="hint">Harcanan bar plan aşıldığında kırmızı olur. Ayrıntı için bara dokun.</p>`;
  }
  function bindChart() {
    $$('svg.chart .hit', view).forEach((h) => {
      const show = () => {
        const r = barChart._rows[+h.dataset.i];
        const b = h.getBoundingClientRect();
        showTip(`<b>${monthName(r.key)}</b>
          <div><span class="sw" style="background:var(--good)"></span>Gelir ${money(r.income)}</div>
          <div><span class="sw" style="background:var(--plan)"></span>Planlanan ${money(r.planned)}</div>
          <div><span class="sw" style="background:var(--spent)"></span>Harcanan ${money(r.spent)}</div>
          <div style="margin-top:3px" class="${r.vsPlan < 0 ? 'bad' : 'good'}">Plana göre ${signed(r.vsPlan)}</div>`, b.left + b.width / 2, b.top + 30);
      };
      h.addEventListener('pointerenter', show);
      h.addEventListener('pointerdown', show);
      h.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
    });
  }

  // ---------- Sayfa: Birikim ----------
  function renderBirikim() {
    const P = portfolio();
    const r = state.rates;
    const age = r ? Math.round((Date.now() - r.ts) / 60000) : null;
    const goals = state.savings.goals;
    // Ay ay birikime aktarılan
    const transfers = monthKeys().map((k) => ({ k, t: state.months[k].transferred || 0 })).filter((x) => x.t > 0);
    view.innerHTML = `
      <div class="card hero">
        <div class="hero-label">Toplam birikim (bugünkü değer)</div>
        <div class="hero-num">${money(P.value)}</div>
        <div class="hero-sub">Maliyet ${money(P.cost)} · <b class="${P.pl < 0 ? 'bad' : 'good'}">${signed(P.pl)} (${pct(P.plPct)})</b></div>
        ${r && state.rates.data.USD ? `<div class="hero-sub" style="margin-top:4px">≈ $${nf0.format(P.value / state.rates.data.USD.buy)} · ≈ ${num(P.value / (state.rates.data.GRA?.buy || 1))} gr altın</div>` : ''}
      </div>

      <div class="section-title">Hedefler</div>
      ${goals.map((g) => {
        const cur = g.mode === 'manual' ? +g.manual || 0 : P.value;
        const p = g.target ? clamp((cur / g.target) * 100, 0, 100) : 0;
        const leftAmt = Math.max(0, g.target - cur);
        let monthly = '';
        if (g.deadline && leftAmt > 0) {
          const n = (Number(g.deadline.slice(0, 4)) - new Date().getFullYear()) * 12 + (Number(g.deadline.slice(5, 7)) - (new Date().getMonth() + 1));
          monthly = n > 0 ? `Hedefe ${n} ay var · ayda <b>${money(leftAmt / n)}</b> biriktirmelisin` : '<span class="bad">Hedef tarihi geçti</span>';
        }
        return `<div class="card tap" data-goal="${g.id}">
          <div class="card-head"><h3>${esc(g.emoji || '🎯')} ${esc(g.name)}</h3><b>${pct(p)}</b></div>
          <div class="bar thick"><i class="${p >= 100 ? 'good' : ''}" style="width:${p}%"></i></div>
          <div class="cat-bottom"><span>${money(cur)} / ${money(g.target)}</span><span class="muted">Kalan ${money(leftAmt)}</span></div>
          ${monthly ? `<div class="small muted" style="margin-top:6px">${monthly}</div>` : ''}
          ${p >= 100 ? '<div class="small good" style="margin-top:6px">🎉 Hedefe ulaştın!</div>' : ''}
        </div>`;
      }).join('')}
      <button class="btn secondary" id="add-goal">+ Hedef ekle</button>

      <div class="section-title">Varlıklarım</div>
      <div class="card" style="padding:4px 16px">
        <ul class="list">${P.rows.map((h) => {
          const a = ASSETS[h.type] || { name: h.type, unit: '' };
          return `<li class="tap" data-h="${h.id}">
            <div class="main"><div class="title">${a.icon || ''} ${num(h.qty)} ${a.unit === 'adet' || a.unit === 'gram' ? a.unit : ''} ${esc(a.name)}</div>
            <div class="sub">Alış ${money2(h.buyPrice)}${h.type === 'TRY' ? '' : ` · Güncel ${h.known ? money2(h.price) : '—'}`}${h.note ? ' · ' + esc(h.note) : ''}</div></div>
            <div class="right"><div class="amt">${money(h.value)}</div>
            <div class="small ${h.pl < 0 ? 'bad' : h.pl > 0 ? 'good' : 'muted'}">${h.type === 'TRY' ? '' : `${signed(h.pl)} (${pct(h.plPct)})`}</div></div></li>`;
        }).join('') || '<li class="muted small">Henüz varlık yok. + ile altın, döviz veya TL ekle.</li>'}</ul>
      </div>
      <button class="btn" id="add-h">+ Varlık ekle</button>
      ${transfers.length ? `<p class="hint">Bütçeden aktarılan: ${transfers.map((x) => `${monthName(x.k, true)} ${money(x.t)}`).join(' · ')}</p>` : ''}

      <div class="section-title">Güncel kurlar</div>
      <div class="card">
        <div class="card-head"><span class="small muted">${ratesLoading ? 'Güncelleniyor…' : r ? `${esc(r.source)} · ${age < 1 ? 'az önce' : age < 60 ? age + ' dk önce' : Math.round(age / 60) + ' sa önce'}` : 'Kur bilgisi yok'}</span>
          <button class="btn small secondary" id="ref">↻ Yenile</button></div>
        <div class="rate-grid">${RATE_SHOW.map(([k, n]) => {
          const d = r && r.data[k];
          const o = state.rateOverrides[k];
          return `<div class="rate tap" data-rate="${k}" data-name="${n}">
            <div class="k">${n}${o ? ' · manuel' : ''}</div>
            <div class="v">${o ? money2(o) : d ? money2(d.buy) : '—'}</div>
            ${d && !o ? `<div class="tiny muted">Satış ${money2(d.sell)} · <span class="${d.change < 0 ? 'bad' : 'good'}">${pct(d.change)}</span></div>` : ''}
          </div>`;
        }).join('')}</div>
        <p class="hint">Kaynak öncelikle Harem Altın; ulaşılamazsa Kapalıçarşı verisi kullanılır. Değerleme bozdurma (alış) fiyatıyla yapılır — satsan eline geçecek tutar. Sayfa açıkken kurlar her dakika yenilenir. Bir kura dokunup manuel fiyat girebilirsin.</p>
      </div>`;

    $('#add-h').onclick = () => holdingForm();
    $$('[data-h]', view).forEach((li) => (li.onclick = () => holdingForm(state.savings.holdings.find((h) => h.id === li.dataset.h))));
    $('#add-goal').onclick = () => goalForm();
    $$('[data-goal]', view).forEach((c) => (c.onclick = () => goalForm(goals.find((g) => g.id === c.dataset.goal))));
    $('#ref').onclick = () => refreshRates({ force: true });
    $$('[data-rate]', view).forEach((el) => (el.onclick = () => rateOverrideForm(el.dataset.rate, el.dataset.name)));
  }

  function holdingForm(h) {
    const isNew = !h;
    const x = h || { type: 'CEYREK', qty: 1, buyPrice: '', date: todayISO(), note: '' };
    openSheet(isNew ? 'Varlık ekle' : 'Varlığı düzenle', `
      <form id="f">
        <div class="field"><label>Tür</label><select class="input" name="type">${Object.entries(ASSETS).map(([k, a]) => `<option value="${k}" ${k === x.type ? 'selected' : ''}>${a.icon} ${a.name}</option>`).join('')}</select></div>
        <div class="row2">
          <div class="field"><label id="qty-l">Miktar</label><input class="input" name="qty" inputmode="decimal" value="${amtStr(x.qty)}" required></div>
          <div class="field"><label>Birim alış fiyatı (₺)</label><input class="input" name="buyPrice" inputmode="decimal" value="${amtStr(x.buyPrice)}" required></div>
        </div>
        <div class="hint" id="now-p" style="margin:-6px 0 12px"></div>
        <div class="row2">
          <div class="field"><label>Alış tarihi</label><input class="input" type="date" name="date" value="${x.date}"></div>
          <div class="field"><label>Not</label><input class="input" name="note" value="${esc(x.note || '')}" placeholder="ör. Hediye"></div>
        </div>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : '<div class="btn-row"><button class="btn danger" type="button" id="del">Sil / Sattım</button></div>'}
      </form>`, (root) => {
      const f = $('#f', root);
      const upd = () => {
        const a = ASSETS[f.type.value];
        $('#qty-l', root).textContent = a.unit === 'adet' ? 'Adet' : a.unit === 'gram' ? 'Gram' : `Miktar (${a.unit})`;
        if (f.type.value === 'TRY') { f.buyPrice.value = '1'; f.buyPrice.readOnly = true; $('#now-p', root).textContent = ''; return; }
        f.buyPrice.readOnly = false;
        const d = state.rates && state.rates.data;
        const r = d && (d[a.key] || (a.alt && d[a.alt]));
        $('#now-p', root).innerHTML = r ? `Şu an satış ${money2(r.sell)} · bozdurma ${money2(r.buy)} <button type="button" class="link-btn" id="use-p">Satış fiyatını yaz</button>` : 'Güncel fiyat yok';
        const u = $('#use-p', root); if (u) u.onclick = () => { f.buyPrice.value = amtStr(Math.round(r.sell * 100) / 100); };
      };
      f.type.onchange = upd; upd();
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const qty = parseAmount(f.qty.value), buyPrice = parseAmount(f.buyPrice.value);
        if (!(qty > 0) || !(buyPrice > 0)) return toast('Miktar ve fiyatı kontrol et');
        const data = { type: f.type.value, qty, buyPrice, date: f.date.value, note: f.note.value.trim() };
        if (isNew) state.savings.holdings.push({ id: uid(), ...data }); else Object.assign(h, data);
        save(); closeSheet(); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => { if (confirm('Bu varlık silinsin mi?')) { state.savings.holdings = state.savings.holdings.filter((y) => y.id !== h.id); save(); closeSheet(); renderView(); } };
    });
  }

  function goalForm(g) {
    const isNew = !g;
    const x = g || { name: '', emoji: '🎯', target: '', deadline: '', mode: 'all', manual: 0 };
    openSheet(isNew ? 'Hedef ekle' : 'Hedefi düzenle', `
      <form id="f">
        <div class="row2" style="grid-template-columns:80px 1fr">
          <div class="field"><label>Simge</label><input class="input" name="emoji" value="${esc(x.emoji || '')}" maxlength="4" style="text-align:center"></div>
          <div class="field"><label>Hedef adı</label><input class="input" name="name" value="${esc(x.name)}" placeholder="ör. Araba, Tatil" required></div>
        </div>
        <div class="row2">
          <div class="field"><label>Hedef tutar (₺)</label><input class="input" name="target" inputmode="decimal" value="${amtStr(x.target)}" required></div>
          <div class="field"><label>Hedef tarih</label><input class="input" type="month" name="deadline" value="${x.deadline || ''}"></div>
        </div>
        <div class="field"><label>İlerleme neye göre hesaplansın?</label>
          <select class="input" name="mode"><option value="all" ${x.mode === 'all' ? 'selected' : ''}>Tüm birikimimin güncel değeri</option><option value="manual" ${x.mode === 'manual' ? 'selected' : ''}>Kendi girdiğim tutar</option></select></div>
        <div class="field" id="man"><label>Bu hedef için biriken (₺)</label><input class="input" name="manual" inputmode="decimal" value="${x.manual ? amtStr(x.manual) : ''}"></div>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : '<div class="btn-row"><button class="btn danger" type="button" id="del">Sil</button></div>'}
      </form>`, (root) => {
      const f = $('#f', root);
      const t = () => ($('#man', root).hidden = f.mode.value !== 'manual');
      f.mode.onchange = t; t();
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const target = parseAmount(f.target.value);
        if (!(target > 0)) return toast('Hedef tutarı gir');
        const data = { name: f.name.value.trim(), emoji: f.emoji.value.trim(), target, deadline: f.deadline.value, mode: f.mode.value, manual: parseAmount(f.manual.value) || 0 };
        if (isNew) state.savings.goals.push({ id: uid(), ...data }); else Object.assign(g, data);
        save(); closeSheet(); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => { if (confirm('Hedef silinsin mi?')) { state.savings.goals = state.savings.goals.filter((y) => y.id !== g.id); save(); closeSheet(); renderView(); } };
    });
  }

  function rateOverrideForm(k, name) {
    const cur = state.rateOverrides[k] || '';
    openSheet(`${name} — manuel fiyat`, `
      <form id="f">
        <p class="small muted" style="margin-top:0">Kuyumcunun verdiği bozdurma fiyatını kullanmak istersen gir. Boş bırakırsan otomatik fiyat kullanılır.</p>
        <div class="field"><input class="input big" name="p" inputmode="decimal" value="${amtStr(cur)}" placeholder="Otomatik"></div>
        <button class="btn" type="submit">Kaydet</button>
        <div class="btn-row"><button class="btn secondary" type="button" id="clr">Otomatiğe dön</button></div>
      </form>`, (root) => {
      $('#f', root).onsubmit = (ev) => { ev.preventDefault(); const v = parseAmount($('#f', root).p.value); if (v > 0) state.rateOverrides[k] = v; else delete state.rateOverrides[k]; save(); closeSheet(); renderView(); };
      $('#clr', root).onclick = () => { delete state.rateOverrides[k]; save(); closeSheet(); renderView(); };
    });
  }

  // ---------- PIN kilidi (ekran kilidi; şifreleme değildir) ----------
  const pinHash = (p) => { let h = 5381; for (const ch of 'finansim:' + p) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
  function renderLock() {
    $('#app').hidden = true;
    let el = $('#lock');
    if (!el) { el = document.createElement('div'); el.id = 'lock'; document.body.appendChild(el); }
    el.className = 'onboard';
    el.innerHTML = `<div class="card" style="text-align:center">
      <div style="font-size:40px">🔒</div><h1 style="font-size:22px">Merhaba ${esc(state.user.name)}</h1>
      <p class="muted" style="margin-top:0">PIN'ini gir</p>
      <input class="input big" id="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" style="letter-spacing:.5em">
      <div class="hint" id="pin-err"></div></div>`;
    const inp = $('#pin');
    setTimeout(() => inp.focus(), 100);
    inp.oninput = () => {
      if (inp.value.length >= 4 && pinHash(inp.value) === state.settings.pinHash) { unlocked = true; el.remove(); render(); }
      else if (inp.value.length >= 6) { $('#pin-err').textContent = 'Yanlış PIN'; inp.value = ''; }
    };
  }

  // ---------- Sayfa: Ayarlar ----------
  function renderAyarlar() {
    const bytes = new Blob([localStorage.getItem(STORE_KEY) || '']).size;
    view.innerHTML = `
      <div class="card">
        <h3>Profil</h3>
        <div class="field"><label>Adın</label><input class="input" id="name" value="${esc(state.user.name)}"></div>
        <div class="field"><label>Görünüm</label>
          <div class="seg" id="theme">${[['auto', 'Otomatik'], ['light', 'Açık'], ['dark', 'Koyu']].map(([v, n]) => `<button data-v="${v}" class="${state.settings.theme === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      </div>
      <div class="card">
        <h3>PIN kilidi</h3>
        <p class="small muted" style="margin-top:0">Uygulama her açıldığında PIN sorar. ${state.settings.pinHash ? '<b class="good">Açık</b>' : 'Kapalı'}</p>
        <div class="btn-row" style="margin-top:0"><button class="btn secondary" id="pin-set">${state.settings.pinHash ? 'PIN değiştir' : 'PIN belirle'}</button>${state.settings.pinHash ? '<button class="btn danger" id="pin-off">Kapat</button>' : ''}</div>
      </div>
      <div class="card">
        <h3>Yedekleme</h3>
        <p class="small muted" style="margin-top:0">Tüm veriler yalnızca bu cihazda (${(bytes / 1024).toFixed(1)} KB). Ayda bir yedek indirmeni öneririm.</p>
        <button class="btn" id="exp">Yedeği indir (.json)</button>
        <div class="btn-row"><button class="btn secondary" id="imp">Yedek dosyasından yükle</button></div>
        <div class="btn-row"><button class="btn secondary" id="code">Veri kodu / link yapıştır</button></div>
        <input type="file" id="file" accept="application/json,.json" hidden>
      </div>
      <div class="card">
        <h3>Telefona kur</h3>
        <p class="small muted" style="margin:0">iPhone Safari'de <b>Paylaş</b> → <b>Ana Ekrana Ekle</b>. Ana ekrandaki uygulamanın verisi Safari'den ayrı tutulur; hep ana ekrandan aç.</p>
      </div>
      <div class="card">
        <h3>Tehlikeli bölge</h3>
        <button class="btn danger" id="reset">Tüm verileri sil</button>
      </div>
      <p class="hint" style="text-align:center">Finansım · üyelik yok · verilerin hiçbir sunucuya gönderilmez (yalnızca kur bilgisi çekilir)</p>`;
    $('#name').onchange = (e) => { state.user.name = e.target.value.trim() || state.user.name; save(); updateHeader(); };
    $$('#theme button').forEach((b) => (b.onclick = () => { state.settings.theme = b.dataset.v; save(); applyTheme(); renderAyarlar(); }));
    $('#pin-set').onclick = () => openSheet('PIN belirle', `
      <form id="f"><div class="field"><label>4–6 haneli PIN</label><input class="input big" name="p1" type="password" inputmode="numeric" maxlength="6" required></div>
      <div class="field"><label>Tekrar</label><input class="input big" name="p2" type="password" inputmode="numeric" maxlength="6" required></div>
      <p class="hint">PIN'i unutursan verilere ulaşmak için yedek gerekir; ekran kilididir, şifreleme değildir.</p>
      <button class="btn" type="submit">Kaydet</button></form>`, (root) => {
      $('#f', root).onsubmit = (ev) => {
        ev.preventDefault(); const f = ev.target;
        if (!/^\d{4,6}$/.test(f.p1.value)) return toast('PIN 4–6 rakam olmalı');
        if (f.p1.value !== f.p2.value) return toast('PIN\'ler eşleşmiyor');
        state.settings.pinHash = pinHash(f.p1.value); unlocked = true; save(); closeSheet(); toast('PIN kilidi açıldı'); renderAyarlar();
      };
    });
    const po = $('#pin-off'); if (po) po.onclick = () => { if (confirm('PIN kilidi kapatılsın mı?')) { state.settings.pinHash = null; save(); renderAyarlar(); } };
    $('#exp').onclick = () => download(`finansim-yedek-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
    $('#imp').onclick = () => $('#file').click();
    $('#file').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const d = JSON.parse(await file.text());
        if (!d || !d.months || !d.savings || !d.user) throw new Error('format');
        if (!confirm('Mevcut verilerin bu yedekle değiştirilecek. Devam?')) return;
        state = migrate(d); save(); applyTheme(); toast('Yedek geri yüklendi'); location.hash = '#/ozet'; render();
      } catch { toast('Bu dosya geçerli bir Finansım yedeği değil'); }
    };
    $('#code').onclick = () => openSheet('Veri kodu yapıştır', `
      <form id="f"><div class="field"><textarea class="input" name="c" rows="5" placeholder="https://…#veri=… ya da sadece kod"></textarea></div>
      <p class="hint">Koddaki ayın planı ve harcamaları eklenir; aynı ay varsa üzerine yazılır.</p>
      <button class="btn" type="submit">Yükle</button></form>`, (root) => {
      $('#f', root).onsubmit = (ev) => {
        ev.preventDefault();
        const d = decodeCode(ev.target.c.value);
        if (!d) return toast('Kod okunamadı');
        if (state.months[d.m] && !confirm(`${monthName(d.m)} zaten var, üzerine yazılsın mı?`)) return;
        applyCode(d); save(); closeSheet(); toast(`${monthName(d.m)} verileri yüklendi`); location.hash = '#/ozet';
      };
    });
    $('#reset').onclick = () => {
      if (!confirm('Tüm bütçe, harcama ve birikim verilerin silinecek. Emin misin?')) return;
      if (!confirm('Son kez soruyorum: geri alınamaz. Silinsin mi?')) return;
      localStorage.removeItem(STORE_KEY); state = null; location.hash = ''; render();
    };
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- Karşılama ----------
  function renderOnboarding() {
    $('#app').hidden = true;
    let ob = $('#onboard');
    if (!ob) { ob = document.createElement('div'); ob.id = 'onboard'; document.body.appendChild(ob); }
    ob.className = 'onboard';
    ob.innerHTML = `<div class="card">
      <div style="font-size:42px">💰</div>
      <h1>Finansım'a hoş geldin</h1>
      <p class="muted" style="margin-top:0">Üyelik yok. Her şey yalnızca bu cihazda saklanır.</p>
      <form id="ob-f">
        <div class="field"><label>Adın</label><input class="input" name="name" placeholder="Adını yaz" required autocomplete="given-name"></div>
        ${pendingCode ? `<label class="check"><input type="checkbox" name="usecode" checked> ${monthName(pendingCode.m)} planımı ve harcamalarımı yükle (linkten geldi)</label>`
          : `<details class="small" style="margin-bottom:12px"><summary class="muted">Veri kodum var</summary><textarea class="input" name="code" rows="3" style="margin-top:8px" placeholder="Link ya da kod"></textarea></details>`}
        <button class="btn" type="submit">Başla</button>
      </form></div>`;
    $('#ob-f').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      state = freshState(f.name.value.trim());
      const code = pendingCode && f.usecode && f.usecode.checked ? pendingCode : f.code ? decodeCode(f.code.value) : null;
      if (f.code && f.code.value.trim() && !code) return toast('Veri kodu okunamadı');
      if (code) applyCode(code);
      pendingCode = null; unlocked = true;
      autoRollover();
      save(); ob.remove(); $('#app').hidden = false; location.hash = '#/ozet'; render(); refreshRates();
    };
  }

  // Yeni aya girildiğinde planı önceki aydan otomatik kopyala
  function autoRollover() {
    const now = monthKeyOf();
    if (!state || state.months[now]) return;
    const prev = monthKeys().filter((k) => k < now).pop();
    if (!prev) return;
    ensureMonth(now);
    state.ui.month = now;
    save();
    setTimeout(() => toast(`${monthName(now)} planı ${monthName(prev)} ayından kopyalandı`), 600);
  }

  // ---------- Yönlendirme ----------
  function updateHeader() {
    const r = route();
    const h = new Date().getHours();
    const greet = h < 6 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'Merhaba' : 'İyi akşamlar';
    const titles = { birikim: 'Birikimim', ayarlar: 'Ayarlar', rapor: 'Raporlar', islem: 'Giriş / Çıkış' };
    $('#hello').textContent = titles[r] || `${greet}, ${state.user.name}`;
    $('#month-switch').hidden = !(r === 'ozet' || r === 'islem');
    $('#m-label').textContent = monthName(curMonthKey());
    $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r));
    $('#fab').hidden = !(r === 'ozet' || r === 'birikim');
    $('#fab').setAttribute('aria-label', r === 'birikim' ? 'Varlık ekle' : 'Gider ekle');
  }
  function renderView() {
    hideTip();
    updateHeader();
    ({ ozet: renderOzet, islem: renderIslem, rapor: renderRapor, birikim: renderBirikim, ayarlar: renderAyarlar }[route()] || renderOzet)();
  }
  function render() {
    applyTheme();
    if (!state) return renderOnboarding();
    if (state.settings.pinHash && !unlocked) return renderLock();
    if (pendingCode) {
      const d = pendingCode; pendingCode = null;
      if (confirm(`Linkteki ${monthName(d.m)} verileri yüklensin mi?${state.months[d.m] ? ' (Bu ay zaten var, üzerine yazılır.)' : ''}`)) { applyCode(d); save(); toast('Veriler yüklendi'); }
    }
    $('#app').hidden = false;
    renderView();
  }

  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); if (state && (unlocked || !state.settings.pinHash)) renderView(); });
  $('#m-prev').onclick = () => { state.ui.month = addMonth(curMonthKey(), -1); save(); renderView(); };
  $('#m-next').onclick = () => { state.ui.month = addMonth(curMonthKey(), 1); save(); renderView(); };
  $('#m-label').onclick = () => {
    const keys = [...new Set([...monthKeys(), monthKeyOf()])].sort().reverse();
    openSheet('Ay seç', `<ul class="list">${keys.map((k) => {
      const m = state.months[k];
      const s = m ? calc(m, k) : null;
      return `<li class="tap" data-k="${k}"><div class="main"><div class="title">${monthName(k)}${k === monthKeyOf() ? ' · bu ay' : ''}</div><div class="sub">${s ? `Harcanan ${money(s.spent)} / Gelir ${money(s.income)}` : 'Plan yok'}</div></div>${k === curMonthKey() ? '<span class="chip info">Seçili</span>' : ''}</li>`;
    }).join('')}</ul>`, (root) => $$('[data-k]', root).forEach((li) => (li.onclick = () => { state.ui.month = li.dataset.k; save(); closeSheet(); renderView(); })));
  };
  $('#btn-settings').onclick = () => (location.hash = '#/ayarlar');
  $('#fab').onclick = () => (route() === 'birikim' ? holdingForm() : expenseForm());

  if (state) { state = migrate(state); state.ui.cat = null; autoRollover(); }
  render();
  if (state) refreshRates();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state) refreshRates({ silent: true }); });
  setInterval(() => { if (state && !document.hidden && route() === 'birikim' && $('#sheet').hidden) refreshRates({ force: true, silent: true }); }, 60 * 1000);

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

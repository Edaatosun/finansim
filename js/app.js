/* Finansım — tüm veriler bu cihazın localStorage'ında tutulur. Kod içinde kişisel veri yoktur.
 *
 * Bütçe mantığı (kullanıcının düzeni):
 *   Gelirler − Sabit giderler − Taksitler − Planlanan birikim = Kalan
 *   Kalan → kişinin kendi belirlediği kategorilere (alt başlıklarıyla) dağıtılır.
 * Plan bir kez kurulur (state.plan) ve her yeni ay bu plandan oluşturulur.
 */
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
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
  const money = (n) => (Math.round(n) < 0 ? '−' : '') + '₺' + nf0.format(Math.abs(Math.round(n || 0)));
  const money2 = (n) => (n < 0 ? '−' : '') + '₺' + nf2.format(Math.abs(n || 0));
  const signed = (n) => (Math.round(n) > 0 ? '+' : '') + money(n);
  const pct = (n) => (n < 0 ? '−' : '') + '%' + nf2.format(Math.abs(Math.round(n * 10) / 10));
  const num = (n) => nf2.format(n || 0);
  const amtStr = (n) => (n === '' || n == null || n === 0 ? '' : String(n).replace('.', ','));
  const round50 = (n) => Math.max(0, Math.round(n / 50) * 50);

  // ---------- Düzenli birikim & hedef türleri ----------
  const SAVING_TYPES = ['CEYREK', 'GRAM', 'YARIM', 'TAM', 'CUMHURIYET', 'USD', 'EUR', 'GUMUS', 'TRY'];
  const GOAL_KINDS = {
    car: ['🚗', 'Araba', 'Arabana kavuştun! 🎉'], house: ['🏠', 'Ev', 'Evine kavuştun! 🎉'], debt: ['🔓', 'Borç bitirme', 'Borçsuzsun! 🎉'],
    travel: ['🏖️', 'Tatil', 'Tatil seni bekliyor! 🎉'], wedding: ['💍', 'Düğün', 'Hedefe ulaştın! 🎉'], edu: ['🎓', 'Eğitim', 'Hedefe ulaştın! 🎉'],
    emergency: ['🛟', 'Acil durum fonu', 'Güvenlik ağın hazır! 🎉'], other: ['🎯', 'Diğer', 'Hedefe ulaştın! 🎉'],
  };
  // Planlanan birikim kaleminin bugünkü tahmini TL karşılığı (satış fiyatıyla)
  function estItem(i) {
    if (i.type === 'TRY') return +i.amount || 0;
    const r = rateOf(i.type);
    return (+i.qty || 0) * (r ? r.sell : +i.lastPrice || 0);
  }
  const planSavingTotal = (p) => sum((p && p.savingItems) || [], estItem);
  function itemLabel(i) {
    if (i.type === 'TRY') return `${money(i.amount)} TL`;
    const a = ASSETS[i.type];
    if (!a) return i.type;
    return a.unit === 'adet' ? `${num(i.qty)} ${a.name}` : a.unit === 'gram' ? `${num(i.qty)} gr ${a.name}` : `${num(i.qty)} ${a.unit} (${a.name})`;
  }

  function parseAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(v || '').replace(/[₺\s]|TL/gi, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
    return parseFloat(s);
  }
  const amt0 = (v) => { const n = parseAmount(v); return isFinite(n) && n > 0 ? n : 0; };

  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const monthKeyOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const addMonth = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKeyOf(new Date(y, m - 1 + n, 1)); };
  const monthDiff = (a, b) => { const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
  const monthName = (key, short) => { const [y, m] = key.split('-').map(Number); const n = MONTHS[m - 1]; return short ? `${n.slice(0, 3)} ${String(y).slice(2)}` : `${n} ${y}`; };
  const daysInMonth = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const shortDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }); };

  // ---------- Öneriler ----------
  const SUGGEST_CATS = [
    { name: 'İhtiyaçlarım', emoji: '🛍️', subs: ['Kıyafet', 'Kozmetik', 'Ev ihtiyaçları', 'İstediğim bir şey'], toSavings: true, w: 22, def: true, why: 'kıyafet, kozmetik, ev ihtiyacı gibi kişisel alımlar; artanı birikime gider' },
    { name: 'Market', emoji: '🛒', subs: ['BİM / A101 / Şok', 'Gross / toptan'], w: 30, def: true, why: 'temel ihtiyaç, en büyük pay' },
    { name: 'Dışarıda yeme-içme', emoji: '🍽️', subs: [], w: 14, def: true, why: 'kafe, restoran, tatlıcı' },
    { name: 'Gezme / Eğlence', emoji: '✈️', subs: [], w: 10, why: 'gezi, sinema, etkinlik' },
    { name: 'Yol / Ulaşım', emoji: '🚌', subs: [], w: 12, def: true, why: 'toplu taşıma, taksi, yakıt' },
    { name: 'Yardım', emoji: '🤝', subs: ['Aile'], w: 8, why: 'aileye / yakınlara destek; ortalama bir tutar ayır' },
    { name: 'Sağlık', emoji: '💊', subs: [], w: 5, why: 'eczane, muayene' },
    { name: 'Hediye', emoji: '🎁', subs: [], w: 4, why: 'doğum günü, özel gün' },
    { name: 'Evcil hayvan', emoji: '🐾', subs: [], w: 6, why: 'mama, veteriner' },
    { name: 'Kitap / Eğitim', emoji: '📚', subs: [], w: 5, why: 'kitap, kurs materyali' },
    { name: 'Araba / Yakıt', emoji: '⛽', subs: [], w: 15, why: 'yakıt, otopark, bakım' },
    { name: 'Değişken faturalar', emoji: '💡', subs: [], w: 8, why: 'tutarı her ay değişen faturalar' },
  ];
  const SUGGEST_FIXED = [['Kira', '🏠'], ['Kredi kartı', '💳'], ['Telefon', '📱'], ['İnternet', '🌐'], ['Elektrik', '💡'], ['Su', '🚰'], ['Doğalgaz', '🔥'], ['Aidat', '🏢'], ['Netflix', '🎬'], ['Spotify', '🎵'], ['Spor salonu', '🏋️'], ['Kurs', '📚']];
  const weightOf = (name) => (SUGGEST_CATS.find((s) => lower(s.name) === lower(name)) || {}).w || 7;
  const whyOf = (name) => (SUGGEST_CATS.find((s) => lower(s.name) === lower(name)) || {}).why || 'kendi kategorin';

  // Önerilen plan: gelirin %20'si birikim (sabitlerden sonra kalanın en fazla %40'ı),
  // kalanın %95'i kategorilere ağırlığa göre, %5'i beklenmedik giderler için serbest.
  function suggestPlan(income, committed, cats) {
    const afterFixed = Math.max(0, income - committed);
    const saving = round50(Math.min(income * 0.2, afterFixed * 0.4));
    const rest = afterFixed - saving;
    const pool = rest * 0.95;
    const wsum = sum(cats, (c) => weightOf(c.name)) || 1;
    const alloc = {};
    cats.forEach((c) => (alloc[c.id] = round50((pool * weightOf(c.name)) / wsum)));
    return { saving, afterFixed, rest, alloc, buffer: rest - sum(Object.values(alloc), (x) => x) };
  }

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
  // Kullanıcı adı: küçük harf, Türkçe karakterler sadeleştirilir; sonuna 4 haneli etiket eklenir (@eda#4821)
  const slugHandle = (s) => String(s || '').toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c])).replace(/[^a-z0-9._]/g, '').slice(0, 20);
  const newTag = () => String(Math.floor(1000 + Math.random() * 9000));
  function freshState(name, handle) {
    return {
      version: 4, user: { name, handle: handle || slugHandle(name) || 'kullanici', tag: newTag(), id: uid() + uid() }, settings: { theme: 'auto', pinHash: null },
      plan: null, installments: [], months: {}, savings: { holdings: [], goals: [] },
      rates: null, rateOverrides: {}, ui: { month: monthKeyOf(), mode: 'gider', cat: null },
    };
  }
  const isCommit = (c) => c.kind === 'fixed' || c.kind === 'taksit';
  const catLabel = (c) => (c.kind === 'taksit' && c.count ? `${c.name} (${c.seq}/${c.count})` : c.name);
  // Taksit, eklendiği aydan (from) itibaren görünür; daha önceki aylara hiç yazılmaz.
  const instFrom = (i) => (i.from && i.from > i.start ? i.from : i.start);
  const instActive = (i, k) => k >= instFrom(i) && monthDiff(i.start, k) < i.count;

  function migrate(s) {
    s.ui = s.ui || {}; s.ui.month = s.ui.month || monthKeyOf(); s.ui.mode = s.ui.mode || 'gider';
    s.settings = s.settings || { theme: 'auto' };
    s.rateOverrides = s.rateOverrides || {};
    s.savings = s.savings || { holdings: [], goals: [] };
    s.months = s.months || {};
    s.installments = s.installments || [];
    for (const m of Object.values(s.months)) {
      m.categories.forEach((c) => { c.kind = c.kind || (c.fixed ? 'fixed' : 'var'); c.subs = c.subs || []; delete c.fixed; });
      m.saving = m.saving || { planned: 0, done: m.transferred || 0 };
      delete m.transferred;
    }
    // v2 → v3: mevcut en son aydan bir plan türet
    if (!s.plan) {
      const keys = Object.keys(s.months).sort();
      const base = keys.filter((k) => k <= monthKeyOf()).pop() || keys[keys.length - 1];
      if (base) {
        const bm = s.months[base];
        s.plan = {
          incomes: bm.incomes.map((i) => ({ id: uid(), name: i.name, amount: i.amount })),
          fixed: bm.categories.filter((c) => c.kind === 'fixed').map((c) => ({ id: uid(), name: c.name, emoji: c.emoji, amount: c.planned })),
          categories: bm.categories.filter((c) => c.kind === 'var').map((c) => ({ id: uid(), name: c.name, emoji: c.emoji, planned: c.planned, subs: clone(c.subs || []), toSavings: false })),
          saving: 0, reviewed: false,
        };
        for (const k of keys.filter((k) => k >= base)) {
          const m = s.months[k];
          m.incomes.forEach((i) => { const t = s.plan.incomes.find((x) => lower(x.name) === lower(i.name)); if (t) i.tplId = t.id; });
          m.categories.forEach((c) => { const t = [...s.plan.fixed, ...s.plan.categories].find((x) => lower(x.name) === lower(c.name)); if (t) c.tplId = t.id; });
        }
      }
    }
    // v3 → v4: tek tutarlı birikim yerine düzenli birikim kalemleri (ör. her ay 1 çeyrek)
    let convertedId = null;
    if (s.plan && !s.plan.savingItems) {
      s.plan.savingItems = [];
      if (s.plan.saving > 0) { convertedId = uid(); s.plan.savingItems.push({ id: convertedId, type: 'TRY', amount: s.plan.saving, qty: 0, goalId: null }); }
    }
    if (s.plan) delete s.plan.saving;
    for (const m of Object.values(s.months)) {
      if (m.saving.items) continue;
      const planned = +m.saving.planned || 0;
      m.saving.items = planned > 0 ? [{ id: uid(), tplId: convertedId || undefined, type: 'TRY', amount: planned, qty: 0, goalId: null, done: (m.saving.done || 0) >= planned, doneAmount: (m.saving.done || 0) >= planned ? planned : 0 }] : [];
      delete m.saving.planned;
    }
    s.savings.goals.forEach((g) => { g.kind = g.kind || 'other'; g.mode = g.mode || 'all'; });
    s.user = s.user || { name: 'Ben' };
    if (!s.user.handle) s.user.handle = slugHandle(s.user.name) || 'kullanici';
    if (!s.user.tag) s.user.tag = newTag();
    if (!s.user.id) s.user.id = uid() + uid();
    s.version = 4;
    return s;
  }

  const curMonthKey = () => state.ui.month || monthKeyOf();
  const getMonth = (key) => state.months[key];
  const monthKeys = () => Object.keys(state.months).sort();

  // ---------- Plan → ay senkronizasyonu ----------
  // only: değişen öğe id'leri (Set) — null ise her şey plandaki değerlere eşitlenir.
  function syncMonth(k, only) {
    const m = state.months[k], p = state.plan;
    if (!m || !p || m.detached) return; // 'boş başlatılan' aylar plandan etkilenmez
    m.skip = m.skip || [];
    const want = (id) => !only || only.has(id);
    const hasEx = (c) => m.expenses.some((e) => e.catId === c.id);

    // Yinelenen gelir: count yoksa her ay; varsa start'tan itibaren count ay
    const incActive = (t) => !t.count || (k >= t.start && monthDiff(t.start, k) < t.count);
    p.incomes.forEach((t) => {
      if (m.skip.includes(t.id) || !incActive(t)) return;
      const x = m.incomes.find((i) => i.tplId === t.id) || m.incomes.find((i) => !i.tplId && lower(i.name) === lower(t.name));
      if (!x) m.incomes.push({ id: uid(), tplId: t.id, name: t.name, amount: t.amount });
      else { const fresh = !x.tplId; x.tplId = t.id; if (want(t.id) || fresh) { x.name = t.name; x.amount = t.amount; } }
    });
    m.incomes = m.incomes.filter((i) => { if (!i.tplId) return true; const t = p.incomes.find((x) => x.id === i.tplId); return t && incActive(t); });

    const upsert = (t, kind, fieldsFn) => {
      if (m.skip.includes(t.id)) return;
      let c = m.categories.find((x) => x.tplId === t.id) || m.categories.find((x) => !x.tplId && !x.instId && lower(x.name) === lower(t.name));
      if (!c) { c = { id: uid(), tplId: t.id, kind, subs: [] }; m.categories.push(c); Object.assign(c, fieldsFn(c)); return; }
      const fresh = !c.tplId; c.tplId = t.id; c.kind = kind;
      if (want(t.id) || fresh) Object.assign(c, fieldsFn(c));
    };
    p.fixed.forEach((t) => upsert(t, 'fixed', () => ({ name: t.name, emoji: t.emoji, planned: t.amount, subs: [] })));
    p.categories.forEach((t) => upsert(t, 'var', (c) => {
      // plandaki alt başlıklar + bu ay harcaması olan eski alt başlıklar
      const used = (c.subs || []).filter((s) => m.expenses.some((e) => e.subId === s.id) && !t.subs.some((x) => x.id === s.id));
      return { name: t.name, emoji: t.emoji, planned: t.planned, toSavings: !!t.toSavings, subs: [...clone(t.subs), ...used] };
    }));
    const tplIds = new Set([...p.fixed, ...p.categories].map((t) => t.id));
    m.categories = m.categories.filter((c) => {
      if (c.tplId && !tplIds.has(c.tplId)) { if (hasEx(c)) { delete c.tplId; return true; } return false; }
      return true;
    });

    state.installments.forEach((i) => {
      const c = m.categories.find((x) => x.instId === i.id);
      if (instActive(i, k)) {
        const f = { kind: 'taksit', name: i.name, emoji: i.emoji || '🧾', planned: i.monthly, seq: monthDiff(i.start, k) + 1, count: i.count, subs: [] };
        if (!c) m.categories.push({ id: uid(), instId: i.id, ...f });
        else if (want(i.id)) Object.assign(c, f);
      } else if (c && !hasEx(c)) m.categories = m.categories.filter((x) => x !== c);
    });
    m.categories = m.categories.filter((c) => !c.instId || state.installments.some((i) => i.id === c.instId) || hasEx(c));

    m.saving = m.saving || { done: 0, items: [] };
    m.saving.items = m.saving.items || [];
    (p.savingItems || []).forEach((t) => {
      if (m.skip.includes(t.id)) return;
      const x = m.saving.items.find((i) => i.tplId === t.id);
      const f = { type: t.type, qty: t.qty, amount: t.amount, goalId: t.goalId || null, lastPrice: t.lastPrice };
      if (!x) m.saving.items.push({ id: uid(), tplId: t.id, ...f, done: false, doneAmount: 0 });
      else if (!x.done && want(t.id)) Object.assign(x, f);
    });
    m.saving.items = m.saving.items.filter((i) => i.done || !i.tplId || (p.savingItems || []).some((t) => t.id === i.tplId));
  }
  const syncFuture = (only) => monthKeys().filter((k) => k >= monthKeyOf()).forEach((k) => syncMonth(k, only));

  // Ayın son hali plana yazılır: limitler, alt başlıklar, ay içinde eklenen/silinen kategoriler ve sabit giderler.
  // (Gelirler ve düzenli birikim kalemleri planda kalır; "bu ay atla / bu aydan sil" sadece o ayı etkiler.)
  function promoteToPlan(pm) {
    const p = state.plan;
    if (!p || !pm) return;
    const gone = new Set(pm.skip || []);
    p.fixed = p.fixed.filter((t) => !gone.has(t.id));
    p.categories = p.categories.filter((t) => !gone.has(t.id));
    pm.categories.forEach((c) => {
      if (c.kind === 'taksit') return;
      const list = c.kind === 'fixed' ? p.fixed : p.categories;
      let t = c.tplId && list.find((x) => x.id === c.tplId);
      if (!t) { t = { id: uid() }; list.push(t); c.tplId = t.id; }
      if (c.kind === 'fixed') Object.assign(t, { name: c.name, emoji: c.emoji, amount: c.planned });
      else Object.assign(t, { name: c.name, emoji: c.emoji, planned: c.planned, subs: clone(c.subs || []), toSavings: !!c.toSavings });
    });
    pm.incomes.filter((i) => i.tplId).forEach((i) => { const t = p.incomes.find((x) => x.id === i.tplId); if (t) { t.name = i.name; t.amount = i.amount; } });
    delete p.empty;
  }
  // Yeni ay: bir önceki (boş başlatılmamış) ayın son hali + taksitler + yinelenen gelirler/birikimler
  function buildMonth(k) {
    const prevKey = monthKeys().filter((x) => x < k && !state.months[x].detached && state.months[x].categories.length).pop();
    if (prevKey && state.plan) promoteToPlan(state.months[prevKey]);
    state.months[k] = { incomes: [], categories: [], expenses: [], saving: { done: 0, items: [] }, skip: [] };
    if (state.plan) syncMonth(k, null);
    return state.months[k];
  }
  function ensureMonth(k) {
    if (state.months[k]) return state.months[k];
    if (state.plan) return buildMonth(k);
    const prev = monthKeys().filter((x) => x < k).pop();
    const src = prev && state.months[prev];
    state.months[k] = {
      incomes: src ? src.incomes.map((i) => ({ ...i, id: uid() })) : [],
      categories: src ? src.categories.map((c) => ({ ...c, id: uid() })) : [],
      expenses: [], saving: { done: 0, items: src ? (src.saving.items || []).map((i) => ({ ...i, id: uid(), done: false, doneAmount: 0, holdingId: undefined })) : [] }, skip: [],
    };
    return state.months[k];
  }

  // ---------- Veri kodu (kişisel başlangıç verisi; linkin # kısmında taşınır, sunucuya gitmez) ----------
  function decodeCode(text) {
    const mt = String(text || '').match(/(?:#veri=)?([A-Za-z0-9_-]{20,})\s*$/);
    if (!mt) return null;
    try {
      const b64 = mt[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
      return d && d.m && (Array.isArray(d.c) || d.v === 3) ? d : null;
    } catch { return null; }
  }
  function addHoldingsGoals(d) {
    (d.h || []).forEach(([type, qty, buyPrice, date]) => {
      if (!state.savings.holdings.some((h) => h.type === type && h.qty === qty && h.buyPrice === buyPrice && h.date === date)) state.savings.holdings.push({ id: uid(), type, qty, buyPrice, date, note: '' });
    });
    (d.g || []).forEach(([name, emoji, target, deadline, kind]) => {
      if (!state.savings.goals.some((g) => lower(g.name) === lower(name))) state.savings.goals.push({ id: uid(), name, emoji, target, deadline, kind: kind || 'other', mode: 'all', manual: 0 });
    });
  }
  function applyCode(d) {
    if (d.v === 3) {
      const p = d.p;
      state.plan = {
        incomes: p.i.map(([name, amount]) => ({ id: uid(), name, amount })),
        fixed: p.f.map(([name, amount, emoji]) => ({ id: uid(), name, amount, emoji })),
        categories: p.c.map(([name, emoji, planned, subs, toSav]) => ({ id: uid(), name, emoji, planned, subs: (subs || []).map((n) => (Array.isArray(n) ? { id: uid(), name: n[0], planned: n[1] || 0 } : { id: uid(), name: n, planned: 0 })), toSavings: !!toSav })),
        savingItems: [], reviewed: false,
      };
      addHoldingsGoals(d);
      const goalId = (n) => (n ? (state.savings.goals.find((g) => lower(g.name) === lower(n)) || {}).id || null : null);
      (p.si || []).forEach(([type, qty, amount, goal, lastPrice]) => state.plan.savingItems.push({ id: uid(), type, qty, amount, goalId: goalId(goal), lastPrice }));
      if (p.s > 0) state.plan.savingItems.push({ id: uid(), type: 'TRY', amount: p.s, qty: 0, goalId: null });
      (d.t || []).forEach(([name, emoji, monthly, count, start]) => state.installments.push({ id: uid(), name, emoji, monthly, count, start }));
      delete state.months[d.m];
      const m = buildMonth(d.m);
      (d.e || []).forEach(([cat, sub, desc, amount, day]) => {
        const c = m.categories.find((x) => lower(x.name) === lower(cat));
        if (!c) return;
        const s = sub ? (c.subs || []).find((x) => lower(x.name) === lower(sub)) : null;
        m.expenses.push({ id: uid(), catId: c.id, subId: s ? s.id : undefined, desc, amount, date: `${d.m}-${pad(day)}`, extra: false });
      });
      syncFuture(null);
      state.ui.month = d.m;
      return;
    }
    // eski (v1) kod biçimi
    const cats = d.c.map(([name, planned, fixed, emoji]) => ({ id: uid(), name, planned, kind: fixed ? 'fixed' : 'var', emoji, subs: [] }));
    state.months[d.m] = {
      incomes: (d.i || []).map(([name, amount]) => ({ id: uid(), name, amount })),
      categories: cats,
      expenses: (d.e || []).map(([ci, desc, amount, day]) => ({ id: uid(), catId: cats[ci].id, desc, amount, date: `${d.m}-${pad(day)}`, extra: false })),
      saving: { done: 0, items: [] }, skip: [],
    };
    addHoldingsGoals(d);
    if (!state.plan) { state = migrate(state); }
    state.ui.month = d.m;
  }
  // ---------- Taşıma linki: tüm veriler sıkıştırılıp linkin # kısmına konur (sunucuya gitmez) ----------
  const b64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64url = (str) => { const b = str.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(b + '==='.slice((b.length + 3) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
  async function pipeBytes(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function encodeTransfer() {
    const data = { ...state, rates: null, ui: { month: monthKeyOf(), mode: 'gider', cat: null } };
    const raw = new TextEncoder().encode(JSON.stringify(data));
    let payload;
    if (window.CompressionStream) payload = 'z' + b64url(await pipeBytes(raw, new CompressionStream('deflate-raw')));
    else payload = 'j' + b64url(raw);
    return `${location.origin}${location.pathname}#tasi=${payload}`;
  }
  async function decodeTransfer(text) {
    try {
      const mt = String(text).trim().match(/(?:#tasi=)?([zj])([A-Za-z0-9_-]+)\s*$/);
      if (!mt) return null;
      let bytes = unb64url(mt[2]);
      if (mt[1] === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
      const d = JSON.parse(new TextDecoder().decode(bytes));
      if (!d || !d.months || !d.user) return null;
      return migrate(d);
    } catch { return null; }
  }
  let pendingTransfer = null;
  if (location.hash.startsWith('#tasi=')) {
    pendingTransfer = location.hash;
    history.replaceState(null, '', location.pathname + '#/ozet');
  }

  let pendingCode = null;
  if (location.hash.startsWith('#veri=')) {
    pendingCode = decodeCode(location.hash);
    history.replaceState(null, '', location.pathname + '#/ozet');
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
    else if (spent === 0) status = isCommit(c) ? 'pending' : 'untouched';
    else status = 'ok';
    const bySub = (c.subs || []).map((s) => ({ ...s, planned: +s.planned || 0, spent: sum(ex.filter((e) => e.subId === s.id), 'amount') }));
    const noSub = sum(ex.filter((e) => !e.subId || !(c.subs || []).some((s) => s.id === e.subId)), 'amount');
    return {
      ...c, planned, spent, diff, count: ex.length, status, bySub, noSub,
      extra: planned > 0 ? extraFlagged : spent,
      inPlan: planned > 0 ? Math.min(nonExtra, planned) : 0,
      overrun: planned > 0 ? Math.max(0, nonExtra - planned) : 0,
    };
  }
  function calc(m, key) {
    const income = sum(m.incomes, 'amount');
    const cats = m.categories.map((c) => catStats(m, c));
    const fixedCats = cats.filter((c) => c.kind === 'fixed'), instCats = cats.filter((c) => c.kind === 'taksit'), varCats = cats.filter((c) => c.kind === 'var');
    const fixedPlan = sum(fixedCats, 'planned'), instPlan = sum(instCats, 'planned');
    const committed = fixedPlan + instPlan;
    const sItemsAll = (m.saving && m.saving.items) || [];
    const sItems = sItemsAll.filter((i) => !i.skipped); // "bu ay yapmayacağım" işaretlenenler hesaba girmez
    const savingPlanned = sum(sItems, (i) => (i.done ? i.doneAmount : estItem(i)));
    const savingDone = (m.saving && m.saving.done) || 0;
    const savingLeft = sum(sItems.filter((i) => !i.done), estItem);
    const kalan = income - committed - savingPlanned;
    const allocated = sum(varCats, 'planned');
    const unalloc = kalan - allocated;
    const planned = committed + allocated;
    const spent = sum(m.expenses, 'amount');
    const now = monthKeyOf();
    const phase = key < now ? 'past' : key === now ? 'current' : 'future';
    const plannedCats = cats.filter((c) => c.planned > 0);
    const withinCount = plannedCats.filter((c) => c.spent <= c.planned).length;
    const closed = (c) => phase === 'past' || (isCommit(c) && c.spent > 0);
    const saved = sum(plannedCats.filter(closed), (c) => Math.max(0, c.diff));
    const openBudget = sum(plannedCats.filter((c) => !closed(c)), (c) => Math.max(0, c.diff));
    const lost = sum(cats, (c) => Math.max(0, -c.diff));
    const extra = sum(cats, 'extra');
    const inPlan = sum(cats, 'inPlan');
    const overrun = sum(cats, 'overrun');
    const plannedSaving = income - planned; // birikim + dağıtılmamış
    const remaining = income - spent;       // birikime aktarılan dahil, elde kalan toplam
    const cash = remaining - savingDone;     // birikime aktarılanlar düşülmüş nakit
    const vsPlan = planned - spent;
    const discipline = plannedCats.length ? withinCount / plannedCats.length : (spent <= planned ? 1 : 0);
    let savingPart;
    if (income <= 0) savingPart = 0;
    else if (plannedSaving > 0) savingPart = clamp(remaining / plannedSaving, 0, 1);
    else savingPart = remaining >= plannedSaving ? 1 : clamp(1 + (remaining - plannedSaving) / income, 0, 1);
    const extraPenalty = income > 0 ? clamp(extra / income, 0, 0.2) : 0;
    const score = Math.round(clamp((discipline * 0.5 + savingPart * 0.5 - extraPenalty) * 100, 0, 100));
    const savingRate = income > 0 ? (remaining / income) * 100 : 0;
    const varLeft = sum(varCats.filter((c) => c.planned > 0), (c) => Math.max(0, c.diff));
    const pendingFixed = sum(cats.filter(isCommit), (c) => Math.max(0, c.diff));
    const daysLeft = phase === 'current' ? daysInMonth(key) - new Date().getDate() + 1 : 0;
    const toSavingsLeft = sum(varCats.filter((c) => c.toSavings), (c) => Math.max(0, c.diff));
    // Bütçe planına göre bu ay birikime ayrılabilecek en fazla tutar:
    // gelir − şimdiye kadarki harcama − ödenmemiş sabit/taksit − kategorilerde kalan bütçe − zaten aktarılan
    const savingRoom = income - spent - pendingFixed - varLeft - savingDone;
    const savingShort = phase !== 'past' ? Math.max(0, Math.round(savingLeft - Math.max(0, savingRoom))) : 0;
    return { income, cats, sItems, sItemsAll, savingLeft, savingRoom, savingShort, fixedCats, instCats, varCats, fixedPlan, instPlan, committed, savingPlanned, savingDone, kalan, allocated, unalloc, planned, spent, phase, saved, openBudget, lost, extra, inPlan, overrun, plannedSaving, remaining, cash, vsPlan, score, savingRate, varLeft, pendingFixed, daysLeft, withinCount, plannedCount: plannedCats.length, toSavingsLeft };
  }
  function scoreLabel(s) {
    if (s >= 85) return ['Mükemmel', 'good'];
    if (s >= 70) return ['İyi', 'good'];
    if (s >= 50) return ['Orta', 'warn'];
    return ['Geliştirilmeli', 'bad'];
  }

  // ---------- Kategori / alt başlık tahmini ----------
  const KEYWORDS = [
    [['bim', 'a101', 'şok', 'migros', 'carrefour', 'file', 'market', 'manav', 'kasap', 'getir'], ['bim', 'market']],
    [['gross', 'metro', 'makro', 'toptan'], ['gross', 'toptan', 'market']],
    [['boston', 'zara', 'lcw', 'lc waikiki', 'koton', 'mavi', 'defacto', 'h&m', 'mango', 'bershka', 'pull', 'kıyafet', 'ayakkabı', 'flo', 'giyim'], ['kıyafet', 'giyim', 'ihtiyaç', 'kişisel', 'kendime']],
    [['gratis', 'watsons', 'rossmann', 'sephora', 'kozmetik', 'parfüm', 'flormar'], ['kozmetik', 'bakım', 'ihtiyaç']],
    [['ikea', 'koçtaş', 'masa', 'mobilya', 'english home', 'madame coco', 'deterjan', 'temizlik'], ['ev ihtiyaç', 'ev', 'ihtiyaç']],
    [['trendyol', 'hepsiburada', 'amazon', 'n11', 'temu', 'shein', 'aliexpress'], ['istediğim', 'online', 'alışveriş', 'ihtiyaç']],
    [['tatlı', 'kafe', 'cafe', 'starbucks', 'kahve', 'restoran', 'yemek', 'burger', 'pizza', 'döner', 'yemeksepeti', 'lokanta', 'simit'], ['dışarı', 'kafe', 'yeme', 'yemek']],
    [['otel', 'uçak', 'pegasus', 'thy', 'bilet', 'sinema', 'konser', 'tatil', 'müze'], ['gezme', 'eğlence', 'tatil']],
    [['benzin', 'akaryakıt', 'shell', 'opet', 'taksi', 'uber', 'bitaksi', 'metro kart', 'otobüs', 'istanbulkart', 'marmaray', 'dolmuş'], ['yol', 'ulaşım', 'araba']],
    [['kardeş', 'anne', 'baba', 'bağış', 'yardım'], ['kardeş', 'aile', 'yardım']],
    [['eczane', 'doktor', 'hastane', 'ilaç'], ['sağlık']],
    [['netflix', 'spotify', 'youtube', 'disney', 'icloud'], ['netflix', 'spotify', 'abonelik']],
    [['fatura', 'turkcell', 'vodafone', 'türk telekom', 'elektrik', 'doğalgaz', 'internet'], ['fatura', 'telefon', 'internet', 'elektrik']],
  ];
  const stripSeq = (s) => lower(s).replace(/\s*\(\d+\/\d+\)$/, '');
  function guessCategory(desc, month) {
    const d = lower(desc);
    if (!d) return null;
    for (const k of monthKeys().reverse()) {
      const mm = state.months[k];
      const hit = [...mm.expenses].reverse().find((e) => stripSeq(e.desc) === d);
      if (!hit) continue;
      const cat = mm.categories.find((c) => c.id === hit.catId);
      const same = cat && month.categories.find((c) => lower(c.name) === lower(cat.name));
      if (same) {
        const sname = hit.subId && (cat.subs || []).find((s) => s.id === hit.subId)?.name;
        const sub = sname && (same.subs || []).find((s) => lower(s.name) === lower(sname));
        return { cat: same.id, sub: sub ? sub.id : null };
      }
    }
    for (const c of month.categories) {
      if (lower(c.name) === d || (d.length >= 3 && lower(c.name).startsWith(d))) return { cat: c.id, sub: null };
      const s = (c.subs || []).find((x) => d.length >= 3 && lower(x.name).includes(d));
      if (s) return { cat: c.id, sub: s.id };
    }
    for (const [words, hints] of KEYWORDS) {
      if (!words.some((w) => d.includes(w))) continue;
      for (const h of hints) {
        for (const c of month.categories) { const s = (c.subs || []).find((x) => lower(x.name).includes(h)); if (s) return { cat: c.id, sub: s.id }; }
        const c = month.categories.find((x) => lower(x.name).includes(h));
        if (c) return { cat: c.id, sub: null };
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
      async () => { const p = await haremSnapshot(); return { data: normalizeHarem(p), source: 'Harem Altın' }; },
      async () => { const d = await getJSON('https://finans.truncgil.com/v4/today.json'); return { data: normalizeTruncgil(d), source: 'Truncgil (Kapalıçarşı)' }; },
      async () => { const d = await getJSON('api/rates'); return { data: normalizeTruncgil(d), source: 'Truncgil (yerel sunucu)' }; },
      async () => {
        const [g, fx] = await Promise.all([getJSON('https://api.gold-api.com/price/XAU'), getJSON('https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR,GBP')]);
        const usd = fx.rates.TRY, gram = (g.price * usd) / 31.1035;
        const mk = (v) => ({ buy: v, sell: v * 1.02, change: 0 });
        return { source: 'Tahmini (ons × dolar)', data: {
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
    if (got) { state.rates = { ts: Date.now(), source: got.source, data: got.data }; save(); if (force && !silent) toast(`Kurlar güncellendi · ${got.source}`); }
    else if (force && !silent) toast('Kurlar alınamadı — internet bağlantını kontrol et');
    if (route() === 'birikim' && $('#sheet').hidden && !$('#app').hidden) renderView();
  }
  const rateOf = (type) => { const a = ASSETS[type]; const d = state.rates && state.rates.data; return a && a.key && d ? d[a.key] || (a.alt && d[a.alt]) : null; };
  function unitPrice(type) {
    const a = ASSETS[type];
    if (!a) return null;
    if (!a.key) return 1;
    const o = state.rateOverrides[a.key];
    if (o) return o;
    const r = rateOf(type);
    return r ? r.buy : null;
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

  // ---------- Hedef ilerlemesi ve tahmin ----------
  function goalCurrent(g, P) {
    if (g.mode === 'manual') return +g.manual || 0;
    if (g.mode === 'linked') return sum(P.rows.filter((h) => h.goalId === g.id), 'value');
    return P.value;
  }
  // Bu hedefe her ay planlanan katkı (düzenli birikim kalemlerinden)
  function goalMonthly(g) {
    const items = (state.plan && state.plan.savingItems) || [];
    return sum(g.mode === 'linked' ? items.filter((i) => i.goalId === g.id) : items, estItem);
  }
  function goalForecast(g, P) {
    const cur = goalCurrent(g, P);
    const left = Math.max(0, g.target - cur);
    const pctDone = g.target ? clamp((cur / g.target) * 100, 0, 100) : 0;
    const now = monthKeyOf();
    const monthly = goalMonthly(g);
    const out = { cur, left, pctDone, monthly, monthsToDeadline: g.deadline ? monthDiff(now, g.deadline) : null };
    if (left <= 0) return { ...out, done: true };
    if (!(monthly > 0)) return { ...out, noPlan: true };
    // Bu ayın planlanan birikimi yapıldıysa sayım gelecek aydan başlar
    const m = state.months[now];
    const thisDone = m && m.saving.items.length && m.saving.items.every((i) => i.done || i.skipped);
    const startK = thisDone ? addMonth(now, 1) : now;
    const need = Math.ceil(left / monthly);
    const eta = addMonth(startK, need - 1);
    const late = g.deadline ? monthDiff(g.deadline, eta) : 0;
    const monthsAvail = g.deadline ? monthDiff(startK, g.deadline) + 1 : null;
    const needMonthly = monthsAvail > 0 ? left / monthsAvail : null;
    return { ...out, eta, late, needMonthly, startK };
  }
  function goalMessage(p) {
    if (p >= 100) return 'Hedefe ulaştın!';
    if (p >= 75) return 'Son çeyrek — hedef göründü!';
    if (p >= 50) return 'Yarıyı geçtin — artık geri dönüş yok!';
    if (p >= 25) return '%25\'i geçtin — çeyrek yol tamam!';
    return 'Yolun başındasın; her ay bir adım daha.';
  }
  function goalTrack(g, F) {
    const kind = GOAL_KINDS[g.kind] || GOAL_KINDS.other;
    const icon = g.emoji || kind[0];
    const p = F.pctDone;
    return `<div class="track">
        <div class="track-bar"><i style="width:${p}%"></i>
          ${[25, 50, 75].map((x) => `<span class="ms ${p >= x ? 'on' : ''}" style="left:${x}%"></span>`).join('')}
          <span class="runner" style="left:${clamp(p, 3, 97)}%">${Math.round(p)}%</span>
        </div>
        <div class="track-end ${p >= 100 ? 'done' : ''}" aria-hidden="true">${esc(icon)}</div>
      </div>
      <div class="track-labels"><span>%0</span><span>%25</span><span>%50</span><span>%75</span><span>%100</span></div>`;
  }
  function goalText(g, F) {
    const kind = GOAL_KINDS[g.kind] || GOAL_KINDS.other;
    const lines = [];
    lines.push(`<b>${F.done ? kind[2] : goalMessage(F.pctDone)}</b> %${Math.round(F.pctDone)} tamamlandı.`);
    lines.push(`${money(F.cur)} birikti${F.left > 0 ? `, ${money(F.left)} kaldı` : ''}.`);
    if (g.deadline) {
      const n = F.monthsToDeadline;
      lines.push(n > 0 ? `Hedef ay: ${monthName(g.deadline)} — ${n} ay kaldı.` : n === 0 ? `Hedef ay: bu ay.` : `Hedef ay ${monthName(g.deadline)} geçti.`);
    }
    let warn = '';
    if (!F.done) {
      if (F.noPlan) warn = `Planında bu hedefe düzenli birikim yok. Planım → Birikim adımından ekle.`;
      else {
        lines.push(`Ayda ~${money(F.monthly)} birikimle tahmini ulaşma: <b>${monthName(F.eta)}</b>.`);
        if (F.late > 0) warn = `Bu planla hedefe ${F.late} ay geç ulaşıyorsun. Zamanında ulaşmak için ayda ${money(F.needMonthly)} biriktirmen gerek (${money(F.needMonthly - F.monthly)} daha).`;
      }
    }
    return `<div class="goal-text">${lines.join(' ')}</div>${warn ? `<div class="warnbox">⚠︎ ${warn}</div>` : ''}`;
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
    $('#sheet-body').scrollTop = 0;
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
        return phase === 'past' || isCommit(c) ? `<span class="chip good">✓ Tasarruf ${money(c.diff)}</span>` : `<span class="chip info">Kalan ${money(c.diff)}</span>`;
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
  // Alt başlık satırı: "Ayakkabı ₺800/₺1.000 · Giyim ₺1.200/₺4.000"
  const subLine = (c) => {
    if (!c.bySub || !c.bySub.length) return '';
    const parts = c.bySub.map((s) => {
      const over = s.planned > 0 && s.spent > s.planned;
      return `<span class="${over ? 'bad' : ''}">${esc(s.name)} ${money(s.spent)}${s.planned > 0 ? '/' + money(s.planned) : ''}${over ? ' ▲' : ''}</span>`;
    });
    if (c.noSub > 0) parts.push(`Diğer ${money(c.noSub)}`);
    return `<div class="subline">${parts.join(' · ')}</div>`;
  };
  // Açık (detayı gösterilen) kategoriler — yalnızca bu oturumda
  const openCats = new Set();
  // Kategoriye dokununca: alt başlık bazında toplamlar + o ayki tüm giderler
  function catDetail(m, c) {
    const subName = (e) => ((c.subs || []).find((s) => s.id === e.subId) || {}).name || '';
    const ex = m.expenses.filter((e) => e.catId === c.id).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    const subs = c.bySub && c.bySub.length ? c.bySub : [];
    return `<div class="cat-detail">
      ${subs.length ? `<div class="cd-title">Neye ne kadar</div><ul class="list cd-subs">${subs.map((s) => `<li><div class="main"><div class="title">${esc(s.name)}</div>${s.planned > 0 ? `<div class="sub">Limit ${money(s.planned)} · ${s.spent > s.planned ? `<span class="bad">${money(s.spent - s.planned)} aşım</span>` : money(s.planned - s.spent) + ' kaldı'}</div>` : ''}</div><div class="amt">${money(s.spent)}</div></li>`).join('')}
        ${c.noSub > 0 ? `<li><div class="main"><div class="title muted">Alt başlıksız</div></div><div class="amt">${money(c.noSub)}</div></li>` : ''}</ul>` : ''}
      <div class="cd-title">${monthName(curMonthKey())} harcamaları</div>
      ${ex.length ? `<ul class="list">${ex.map((e) => `<li class="tap" data-exp="${e.id}"><div class="main"><div class="title">${esc(e.desc || c.name)}</div><div class="sub">${shortDate(e.date)}${subName(e) ? ' · ' + esc(subName(e)) : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div><div class="amt">−${money(e.amount)}</div></li>`).join('')}</ul>`
        : '<p class="small muted" style="margin:4px 0">Bu ay bu kategoride henüz gider yok — limitin olduğu gibi duruyor.</p>'}
      <button class="btn small secondary" data-go="${c.id}" style="margin-top:8px">+ ${esc(c.name)} için gider gir</button>
    </div>`;
  }

  // Plan seçimi: kendi planı / önerilen plan / boş plan
  const planChoiceHTML = () => `
    <button class="choice" data-pc="own"><span class="ic">✍️</span><span><b>Kendi planımı oluşturayım</b><br><span class="muted small">Gelir → sabit giderler → birikim → kalanı kategorilere dağıt</span></span></button>
    <button class="choice" data-pc="suggested"><span class="ic">✨</span><span><b>Önerilen planla başla</b><br><span class="muted small">Gelirini ve sabit giderlerini gir; birikim ve kategori bütçelerini biz önerelim</span></span></button>
    <button class="choice" data-pc="empty"><span class="ic">📄</span><span><b>Boş plan</b><br><span class="muted small">Hiçbir şey hazır gelmesin; her şeyi kendim eklerim</span></span></button>`;
  function bindPlanChoice(root, after) {
    $$('[data-pc]', root).forEach((b) => (b.onclick = () => {
      const c = b.dataset.pc;
      if (after) after();
      if (c === 'own') openWizard('new');
      else if (c === 'suggested') openWizard('suggested');
      else setEmptyPlan();
    }));
  }
  function setEmptyPlan() {
    state.plan = { incomes: [], fixed: [], categories: [], savingItems: [], reviewed: true, empty: true };
    const now = monthKeyOf();
    if (!state.months[now]) buildMonth(now);
    state.ui.month = now;
    save(); toast('Boş planla başladın — Ayarlar → Planım’dan istediğin zaman plan oluşturabilirsin'); location.hash = '#/ozet'; renderView();
  }
  function emptyMonth(key) {
    if (!state.plan) return `<div class="card"><div style="text-align:center;font-size:40px">🧭</div><h3 style="text-align:center">Planını seç</h3>
      <p class="small muted" style="text-align:center">Plan bir kez kurulur, her ay otomatik kullanılır.</p>${planChoiceHTML()}</div>`;
    return `<div class="card empty"><div class="big">🗓️</div><h3>${monthName(key)} henüz açılmadı</h3>
      <p class="small">Planın bu aya uygulanır; sonra istediğini bu ay için değiştirebilirsin.</p>
      <button class="btn" data-act="build">Planımı ${monthName(key)} ayına uygula</button>
      <div style="height:8px"></div><button class="btn secondary" data-act="blank">Bu ay boş başlasın</button>
      <p class="hint">Boş ay: planın bu aya uygulanmaz; gelir ve kategorileri bu ay için kendin eklersin. Sonraki aylar planınla devam eder.</p></div>`;
  }
  function bindEmptyMonth(key) {
    bindPlanChoice(view);
    const b = $('[data-act="build"]', view); if (b) b.onclick = () => { buildMonth(key); save(); toast('Plan uygulandı'); renderView(); };
    const e = $('[data-act="blank"]', view); if (e) e.onclick = () => { state.months[key] = { incomes: [], categories: [], expenses: [], saving: { done: 0, items: [] }, skip: [], detached: true }; save(); toast(`${monthName(key)} boş başladı`); renderView(); };
  }
  function warnAfterSave(month, catId, subId) {
    const c = month.categories.find((x) => x.id === catId);
    if (!c) return 'Kaydedildi';
    const st = catStats(month, c);
    const sb = subId && st.bySub.find((s) => s.id === subId);
    if (sb && sb.planned > 0 && sb.spent > sb.planned) return `⚠︎ ${sb.name}: alt bütçe ${money(sb.spent - sb.planned)} aşıldı · ${c.name}: ${st.diff >= 0 ? money(st.diff) + ' kaldı' : money(-st.diff) + ' aşım'}`;
    if (!(st.planned > 0)) return `${c.name}: bütçesi yok, ekstra sayıldı`;
    if (st.diff < 0) return `⚠︎ ${c.name}: ${money(-st.diff)} aşıldı`;
    if (st.spent / st.planned >= 0.8) return `⚠︎ ${c.name}: bütçenin %${Math.round((st.spent / st.planned) * 100)}'i doldu · ${money(st.diff)} kaldı`;
    return `${c.name}: ${money(st.diff)} kaldı`;
  }
  const subSelect = (cat, selId) => cat && cat.subs && cat.subs.length
    ? `<option value="">— Alt başlık yok —</option>${cat.subs.map((s) => `<option value="${s.id}" ${s.id === selId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}` : '';

  // ---------- Sayfa: Özet ----------
  function renderOzet() {
    const key = curMonthKey(), m = getMonth(key);
    if (!m) { view.innerHTML = emptyMonth(key); bindEmptyMonth(key); return; }
    const s = calc(m, key);
    const usedPct = s.income ? clamp(((s.spent + s.savingDone) / s.income) * 100, 0, 100) : 0;
    const [lbl, lcls] = scoreLabel(s.score);
    const daily = s.daysLeft > 0 ? s.varLeft / s.daysLeft : 0;
    const commits = [...s.fixedCats, ...s.instCats];
    const order = { over: 0, unplanned: 1, ok: 2, untouched: 3, empty: 4, pending: 5 };
    const vari = [...s.varCats].sort((a, b) => order[a.status] - order[b.status] || b.spent - a.spent);
    const savDoneItems = sum(s.sItems.filter((i) => i.done), 'doneAmount');
    const savPct = s.savingPlanned > 0 ? clamp((savDoneItems / s.savingPlanned) * 100, 0, 100) : 0;
    const P = portfolio();
    const goalWarn = state.savings.goals.map((g) => ({ g, F: goalForecast(g, P) })).filter((x) => !x.F.done && (x.F.late > 0 || x.F.noPlan));
    const avgMonthly = planSavingTotal(state.plan) || 1;
    const slip = s.savingShort > 50 ? Math.max(1, Math.round(s.savingShort / avgMonthly)) : 0;

    view.innerHTML = `
      ${state.plan && !state.plan.reviewed ? `<div class="banner"><div class="t"><b>Planını gözden geçir</b><br>Birikim ve kategori tutarlarını kendine göre ayarla.</div><button class="btn small" id="review">Planım</button></div>` : ''}

      <div class="card hero">
        <div class="hero-label">${s.phase === 'past' ? 'Ay sonunda elinde kalan' : 'Elinde kalan'}</div>
        <div class="hero-num ${s.cash < 0 ? 'bad' : ''}">${money(s.cash)}</div>
        <div class="hero-sub">Gelir ${money(s.income)} − girdiğin giderler ${money(s.spent)}${s.savingDone ? ` − birikime yatırılan ${money(s.savingDone)}` : ''}</div>
        <div class="bar thick" style="margin-top:12px"><i class="${s.spent > s.income ? 'over' : ''}" style="width:${usedPct}%"></i></div>
        <div class="stats">
          <div class="stat"><div class="k">Limitlerinde kalan</div><div class="v ${s.vsPlan < 0 ? 'bad' : 'good'}">${money(s.vsPlan)}</div></div>
          <div class="stat"><div class="k">${s.phase === 'current' ? 'Günlük harcama hakkın' : 'Tasarruf oranı'}</div><div class="v">${s.phase === 'current' ? money(daily) : pct(s.savingRate)}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>🧭 Bu ayın planı</h3><button class="link-btn" id="edit-plan">Planımı düzenle</button></div>
        <p class="small muted" style="margin:-4px 0 6px">Bunlar sadece limit ve hedefler; paradan hiçbir şey düşmez. Para yalnızca gider girdiğinde, “Öde” ya da “Aldım” dediğinde düşer. Bu ay yaptığın düzenlemeler yeni aya aynen aktarılır.</p>
        <ul class="wf">
          <li><span class="k">Toplam gelir</span><span class="v">${money(s.income)}</span></li>
          <li class="minus"><span class="k">− Sabit giderler</span><span class="v">${money(s.fixedPlan)}</span></li>
          ${s.instPlan ? `<li class="minus"><span class="k">− Taksitler</span><span class="v">${money(s.instPlan)}</span></li>` : ''}
          <li class="minus"><span class="k">− Planlanan birikim</span><span class="v">${money(s.savingPlanned)}</span></li>
          <li class="total"><span class="k">= Kalan</span><span class="v ${s.kalan < 0 ? 'bad' : ''}">${money(s.kalan)}</span></li>
          <li class="sub minus"><span class="k">Kategorilere ayrılan</span><span class="v">${money(s.allocated)}</span></li>
          <li class="sub"><span class="k">${s.unalloc < 0 ? '<span class="bad">Limitler kalanı aşıyor</span>' : 'Boşta kalan (hiçbir kategoriye ayrılmamış)'}</span><span class="v ${s.unalloc < 0 ? 'bad' : 'good'}">${money(Math.abs(s.unalloc))}</span></li>
        </ul>
        ${s.unalloc < 0 ? `<div class="warnbox">⚠︎ Kategorilere koyduğun limitlerin toplamı (${money(s.allocated)}), harcamalara kalan paradan (${money(s.kalan)}) <b>${money(-s.unalloc)} fazla</b>. Bütün limitleri sonuna kadar kullanırsan paran yetmez. Bazı limitleri düşür ya da birikimi azalt. <a href="#" id="fix-plan">Planı düzenle</a></div>` : ''}      </div>

      <div class="card">
        <div class="card-head"><h3>💰 Gelirlerim</h3><button class="btn small" id="add-inc">+ Gelir</button></div>
        <ul class="list">${m.incomes.map((i) => `<li class="tap" data-inc="${i.id}"><div class="main"><div class="title">${esc(i.name)}</div><div class="sub">${incLabel(i, key)}${i.note ? ' · ' + esc(i.note) : ''}</div></div><div class="amt good">+${money(i.amount)}</div></li>`).join('') || '<li class="muted small">Bu ay gelir yok. Maaş, ek iş, prim… ekle.</li>'}</ul>
        ${m.incomes.length > 1 ? `<div class="card-foot"><span class="muted small">Toplam gelir</span><b>${money(s.income)}</b></div>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h3>📌 Sabit giderler ve taksitler</h3><a class="link-btn" href="#/odemeler">Tümü →</a></div>
        <ul class="list">${commits.map((c) => `<li>
          <div class="main"><div class="title">${esc(c.emoji || '•')} ${esc(catLabel(c))}</div>
            <div class="sub">${c.kind === 'taksit' ? 'Taksit · ' : ''}${c.spent > 0 ? `Ödenen ${money(c.spent)}${c.diff !== 0 ? ` · ${c.diff > 0 ? 'plandan ' + money(c.diff) + ' az' : '<span class="bad">' + money(-c.diff) + ' fazla</span>'}` : ''}` : 'Henüz ödenmedi'}</div></div>
          <div class="right"><div class="amt">${money(c.planned)}</div>
            ${c.spent > 0 ? `<span class="chip good">✓ Ödendi</span><br><button class="link-btn small" data-unpay="${c.id}">Geri al</button>` : `<button class="btn small" data-pay="${c.id}">Öde</button>`}</div></li>`).join('') || '<li class="muted small">Sabit gider veya taksit yok. <a href="#/odemeler">Ödemeler</a> sayfasından ekle.</li>'}</ul>
        ${commits.length ? `<div class="card-foot"><span class="muted small">Ödenen ${money(sum(commits, 'spent'))} / ${money(s.committed)}</span><b class="${s.pendingFixed > 0 ? '' : 'good'}">${s.pendingFixed > 0 ? 'Kalan ' + money(s.pendingFixed) : 'Hepsi ödendi'}</b></div>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h3>🏦 Düzenli birikim</h3><span class="muted small">Planlanan ${money(s.savingPlanned)}</span></div>
        ${s.sItemsAll.length ? `<ul class="list">${s.sItemsAll.map((i) => {
          const g = i.goalId && state.savings.goals.find((x) => x.id === i.goalId);
          return `<li class="${i.skipped ? 'skipped' : ''}"><div class="main"><div class="title">${(ASSETS[i.type] || {}).icon || '🏦'} ${esc(itemLabel(i))}</div>
            <div class="sub">${i.skipped ? '<span class="muted">⏭ Bu ay atlandı — plandan çıkarıldı</span>' : i.done ? `<span class="good">✓ Gerçekleşti ${money(i.doneAmount)}</span>${i.doneDate ? ' · ' + shortDate(i.doneDate) : ''}` : `Planlanan ≈ ${money(estItem(i))} · <span class="warn">henüz alınmadı</span>`}${g ? ` · ${esc(g.emoji || '')} ${esc(g.name)}` : ''}</div>
            ${i.done ? '' : `<label class="skipbox"><input type="checkbox" data-skip="${i.id}" ${i.skipped ? 'checked' : ''}> Bu ay yapmayacağım</label>`}</div>
            <div class="right">${i.done ? `<button class="link-btn small" data-undo="${i.id}">Geri al</button>` : i.skipped ? '' : `<button class="btn small" data-buy="${i.id}">Aldım</button>`}</div></li>`;
        }).join('')}</ul>` : `<p class="small muted" style="margin:0 0 6px">Düzenli birikim planın yok. ör. her ay 1 çeyrek altın. <button class="link-btn" id="add-si">Ekle</button></p>`}
        ${s.sItems.length ? `<div class="bar thick" style="margin-top:6px"><i class="good" style="width:${savPct}%"></i></div>
        <div class="cat-bottom"><span>Gerçekleşen ${money(savDoneItems)} / planlanan ${money(s.savingPlanned)}</span><span class="muted">${s.savingLeft > 0 ? 'Bekleyen ≈ ' + money(s.savingLeft) : '✓ Tamamlandı'}</span></div>` : ''}
        ${slip ? `<div class="warnbox">⚠︎ Tahmin: bu ayki harcama limitlerini sonuna kadar kullanırsan birikime en fazla <b>${money(Math.max(0, s.savingRoom))}</b> kalır; planlanan ${money(s.savingLeft)}. <b>${money(s.savingShort)}</b> eksik kalırsa hedefin yaklaşık <b>${slip} ay</b> sarkar. (Limitler paradan düşmez; bu yalnızca uyarı.)</div>` : ''}
        ${goalWarn.map(({ g, F }) => `<div class="warnbox">⚠︎ ${esc(g.emoji || '')} <b>${esc(g.name)}</b>: ${F.noPlan ? 'bu hedefe düzenli birikim planı yok.' : `bu planla hedefe ${F.late} ay geç ulaşıyorsun (tahmini ${monthName(F.eta)}).`} <a href="#/birikim">Detay</a></div>`).join('')}
        <p class="hint">“Aldım” dediğinde tutar maaşından düşülür ve hedefin ilerler; demezsen ikisi de olmaz.</p>
        <div class="btn-row"><button class="btn secondary" id="btn-save">Ekstra birikime aktar</button></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>🗂️ Kategorilerim</h3><button class="btn small secondary" id="add-cat">+ Kategori</button></div>
        ${vari.length ? vari.map((c) => `<div class="cat-row ${openCats.has(c.id) ? 'open' : ''}">
            <div class="tap" data-toggle="${c.id}">
              <div class="cat-top">
                <div class="cat-name"><span>${esc(c.emoji || '•')}</span><span class="t">${esc(c.name)}</span><span class="caret">${openCats.has(c.id) ? '▾' : '▸'}</span></div>
                <div class="cat-amt">${money(c.spent)} / ${money(c.planned)} <button class="mini-btn" data-editcat="${c.id}" aria-label="${esc(c.name)} düzenle">✎</button></div>
              </div>
              ${catBar(c)}
              <div class="cat-bottom"><span>Limit ${money(c.planned)} · harcanan ${money(c.spent)} · <b class="${c.diff < 0 ? 'bad' : 'good'}">${c.diff < 0 ? money(-c.diff) + ' aşım' : money(c.diff) + ' kaldı'}</b></span><span class="muted">${c.count} işlem</span></div>
            </div>
            ${openCats.has(c.id) ? catDetail(m, c) : ''}
          </div>`).join('') : `<div class="empty small">Henüz kategori yok. İhtiyaçlarım, market, yol gibi kategoriler ekle.</div>`}
        <p class="hint">Limit sadece plandır; kategoriden yalnızca gider girdiğinde düşer. Kategoriye dokun → altında neye ne kadar harcadığını gör. ✎ → limit, alt başlıklar, silme.</p>
      </div>

      <div class="card">
        <div class="card-head"><h3>Ay sonu analizi</h3><span class="muted tiny">${s.phase === 'current' ? 'Ay devam ediyor' : s.phase === 'future' ? 'Gelecek ay' : 'Ay kapandı'}</span></div>
        <div class="score">
          ${ring(s.score)}
          <div>
            <div style="font-weight:700;font-size:17px" class="${lcls}">${lbl}</div>
            <div class="small muted">${s.withinCount}/${s.plannedCount} kalem bütçe içinde.<br>${s.phase === 'past'
              ? (s.vsPlan >= 0 ? `Plana göre <b class="good">${money(s.vsPlan)} kârla</b> kapattın.` : `Plana göre <b class="bad">${money(-s.vsPlan)} zararla</b> kapattın.`)
              : (s.lost > 0 ? `Şu ana kadar <b class="bad">${money(s.lost)} aşım</b> var.` : `Şu ana kadar <b class="good">aşım yok</b>.`)}</div>
          </div>
        </div>
        <ul class="list" style="margin-top:12px">
          <li><div class="main"><div class="title">Plan içi harcama</div><div class="sub">Bütçe limitleri içinde kalan kısım</div></div><div class="amt">${money(s.inPlan)}</div></li>
          <li><div class="main"><div class="title">Bütçe aşımı</div><div class="sub">Limiti geçen kısım</div></div><div class="amt ${s.overrun ? 'bad' : ''}">${money(s.overrun)}</div></li>
          <li><div class="main"><div class="title">Ekstra (plan dışı)</div><div class="sub">Planda olmayan / ekstra işaretli</div></div><div class="amt ${s.extra ? 'warn' : ''}">${money(s.extra)}</div></li>
          <li><div class="main"><div class="title">Kâr edilen (tasarruf)</div><div class="sub">${s.phase === 'past' ? 'Limitin altında kalanlar' : 'Ödenmiş sabitlerde plandan artan'}</div></div><div class="amt good">+${money(s.saved)}</div></li>
          ${s.phase !== 'past' ? `<li><div class="main"><div class="title">Henüz harcanmamış bütçe</div><div class="sub">Ay sonunda harcanmazsa kâra döner</div></div><div class="amt">${money(s.openBudget)}</div></li>` : ''}
          <li><div class="main"><div class="title">Zarar edilen</div><div class="sub">Limiti aşan + plansız</div></div><div class="amt ${s.lost ? 'bad' : ''}">${s.lost ? '−' + money(s.lost) : money(0)}</div></li>
          <li><div class="main"><div class="title">Birikime aktarılan</div></div><div class="amt good">${money(s.savingDone)}</div></li>
          <li><div class="main"><div class="title">Totalde sana kalan</div><div class="sub">Gelir − harcamalar − birikime aktarılan</div></div><div class="amt ${s.cash < 0 ? 'bad' : ''}" style="font-size:17px">${money(s.cash)}</div></li>
        </ul>
        ${s.cash > 0 && s.phase !== 'future' ? `<button class="btn secondary" style="margin-top:10px" id="btn-rest">Kalanı (${money(s.cash)}) birikime aktar</button>` : ''}
      </div>`;

    const rv = $('#review'); if (rv) rv.onclick = () => openWizard('edit');
    $('#edit-plan').onclick = () => openWizard(state.plan ? 'edit' : 'first');
    const fp = $('#fix-plan'); if (fp) fp.onclick = (ev) => { ev.preventDefault(); openWizard('edit', 3); };
    $('#add-inc').onclick = () => incomeForm(m);
    $$('[data-inc]', view).forEach((li) => (li.onclick = () => incomeForm(m, m.incomes.find((i) => i.id === li.dataset.inc))));
    $('#add-cat').onclick = () => categoryForm(m, null);
    $$('[data-editcat]', view).forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); categoryForm(m, m.categories.find((c) => c.id === b.dataset.editcat)); }));
    $$('[data-go]', view).forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); state.ui.cat = b.dataset.go; state.ui.mode = 'gider'; location.hash = '#/islem'; }));
    $$('[data-toggle]', view).forEach((b) => (b.onclick = () => { const id = b.dataset.toggle; if (openCats.has(id)) openCats.delete(id); else openCats.add(id); renderOzet(); }));
    $$('[data-exp]', view).forEach((li) => (li.onclick = (ev) => { ev.stopPropagation(); expenseForm(m.expenses.find((e) => e.id === li.dataset.exp)); }));
    $$('[data-unpay]', view).forEach((b) => (b.onclick = () => {
      const c = m.categories.find((x) => x.id === b.dataset.unpay);
      if (!confirm(`${catLabel(c)} ödenmedi olarak geri alınsın mı? Ödeme kaydı silinir, tutar paraya geri eklenir.`)) return;
      m.expenses = m.expenses.filter((e) => e.catId !== c.id);
      save(); toast('Ödeme geri alındı'); renderView();
    }));
    $$('[data-pay]', view).forEach((b) => (b.onclick = () => payFixed(m, key, m.categories.find((x) => x.id === b.dataset.pay))));
    $('#btn-save').onclick = () => transferForm(m, key, '');
    $$('[data-buy]', view).forEach((b) => (b.onclick = () => buyItemForm(m, key, m.saving.items.find((i) => i.id === b.dataset.buy))));
    $$('[data-undo]', view).forEach((b) => (b.onclick = () => undoItem(m, m.saving.items.find((i) => i.id === b.dataset.undo))));
    $$('[data-skip]', view).forEach((cb) => (cb.onchange = () => {
      const it = m.saving.items.find((i) => i.id === cb.dataset.skip);
      it.skipped = cb.checked;
      save(); toast(cb.checked ? `${itemLabel(it)} bu ay plandan çıkarıldı; gelecek ay planına devam eder` : `${itemLabel(it)} bu ay tekrar planda`); renderView();
    }));
    const asi = $('#add-si'); if (asi) asi.onclick = () => openWizard(state.plan ? 'edit' : 'first', 2);
    const br = $('#btn-rest'); if (br) br.onclick = () => transferForm(m, key, Math.round(s.cash));
  }

  function payFixed(m, key, c) {
    openSheet(`${catLabel(c)} — öde`, `
      <form id="f">
        <div class="field"><label>Ödenen tutar</label><input class="input big" name="amount" inputmode="decimal" value="${amtStr(c.planned)}"></div>
        <p class="hint">Tarih: bugün (${shortDate(todayISO())}).</p>
        <p class="hint" style="margin-top:-4px">Ekstre/fatura plandan farklı geldiyse tutarı değiştir; fark kâr ya da zarar olarak yazılır.</p>
        <button class="btn" type="submit">Ödendi olarak kaydet</button>
      </form>`, (root) => {
      const f = $('#f', root);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount > 0)) return toast('Geçerli bir tutar gir');
        m.expenses.push({ id: uid(), catId: c.id, desc: catLabel(c), amount, date: todayISO(), extra: false });
        save(); closeSheet(); toast(`${c.name} ödendi`); renderView();
      };
    });
  }

  function transferForm(m, key, amount) {
    const types = ['TRY', 'GRAM', 'CEYREK', 'USD', 'EUR', 'GUMUS'];
    openSheet('Birikime aktar', `
      <form id="f">
        <div class="field"><label>Tutar</label><input class="input big" name="amount" inputmode="decimal" value="${amtStr(amount)}" placeholder="₺0" required></div>
        <div class="field"><label>Ne olarak biriktirdin?</label><select class="input" name="type">${types.map((t) => `<option value="${t}">${ASSETS[t].icon} ${ASSETS[t].name}</option>`).join('')}</select></div>
        <div class="hint" id="prev" style="margin:-4px 0 12px"></div>
        <button class="btn" type="submit">Aktar</button>
      </form>`, (root) => {
      const f = $('#f', root);
      const upd = () => {
        const a = parseAmount(f.amount.value) || 0, t = f.type.value, r = rateOf(t);
        $('#prev', root).innerHTML = t === 'TRY' ? 'Birikimine TL olarak eklenir.' : r ? `Satış fiyatı ${money2(r.sell)} → yaklaşık <b>${num(a / r.sell)} ${ASSETS[t].unit === 'adet' || ASSETS[t].unit === 'gram' ? ASSETS[t].unit : ASSETS[t].unit}</b>` : '<span class="warn">Kur yok; TL olarak ekle.</span>';
      };
      f.amount.oninput = upd; f.type.onchange = upd; upd();
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const a = parseAmount(f.amount.value);
        if (!(a > 0)) return toast('Geçerli bir tutar gir');
        const t = f.type.value, r = rateOf(t);
        if (t !== 'TRY' && !r) return toast('Kur bilgisi yok');
        const price = t === 'TRY' ? 1 : r.sell;
        state.savings.holdings.push({ id: uid(), type: t, qty: Math.round((a / price) * 10000) / 10000, buyPrice: price, date: todayISO(), note: `${monthName(key)} birikimi` });
        m.saving.done = (m.saving.done || 0) + a;
        m.saving.log = m.saving.log || [];
        m.saving.log.push({ date: monthKeyOf() === key ? todayISO() : `${key}-${pad(daysInMonth(key))}`, label: t === 'TRY' ? 'TL' : ASSETS[t].name, amount: a });
        save(); closeSheet(); toast(`${money(a)} birikime aktarıldı`); renderView();
      };
    });
  }

  // Planlanan düzenli birikimi "aldım" olarak işaretle: maaştan düşer, birikime ve hedefe eklenir
  function buyItemForm(m, key, item) {
    const isTL = item.type === 'TRY';
    const r = rateOf(item.type);
    const goals = state.savings.goals;
    openSheet(`${itemLabel(item)} — aldım`, `
      <form id="f">
        ${isTL ? `<div class="field"><label>Biriktirdiğin tutar</label><input class="input big" name="amount" inputmode="decimal" value="${amtStr(item.amount)}" required></div>`
          : `<div class="row2">
              <div class="field"><label>${ASSETS[item.type].unit === 'adet' ? 'Adet' : ASSETS[item.type].unit === 'gram' ? 'Gram' : 'Miktar'}</label><input class="input" name="qty" inputmode="decimal" value="${amtStr(item.qty)}" required></div>
              <div class="field"><label>Birim fiyat (ödediğin)</label><input class="input" name="price" inputmode="decimal" value="${r ? amtStr(Math.round(r.sell * 100) / 100) : amtStr(item.lastPrice)}" required></div>
            </div><div class="hint" id="tot" style="margin:-4px 0 12px"></div>`}
        <p class="hint">Tarih: bugün (${shortDate(todayISO())}).</p>
        ${goals.length ? `<div class="field"><label>Hangi hedef için?</label><select class="input" name="goal"><option value="">— Genel birikim —</option>${goals.map((g) => `<option value="${g.id}" ${g.id === item.goalId ? 'selected' : ''}>${esc(g.emoji || '')} ${esc(g.name)}</option>`).join('')}</select></div>` : ''}
        <button class="btn" type="submit">Aldım — maaştan düş, birikime ekle</button>
      </form>`, (root) => {
      const f = $('#f', root);
      const upd = () => { if (!isTL) $('#tot', root).innerHTML = `Toplam <b>${money((parseAmount(f.qty.value) || 0) * (parseAmount(f.price.value) || 0))}</b> maaşından düşülecek.`; };
      if (!isTL) { f.qty.oninput = upd; f.price.oninput = upd; upd(); }
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const qty = isTL ? parseAmount(f.amount.value) : parseAmount(f.qty.value);
        const price = isTL ? 1 : parseAmount(f.price.value);
        if (!(qty > 0) || !(price > 0)) return toast('Miktar ve fiyatı kontrol et');
        const amount = Math.round(qty * price * 100) / 100;
        const goalId = f.goal ? f.goal.value || null : item.goalId || null;
        const h = { id: uid(), type: item.type, qty, buyPrice: price, date: todayISO(), note: `${monthName(key)} düzenli birikim`, goalId };
        state.savings.holdings.push(h);
        Object.assign(item, { done: true, doneAmount: amount, doneDate: todayISO(), holdingId: h.id, goalId });
        m.saving.done = (m.saving.done || 0) + amount;
        save(); closeSheet(); toast(`✓ ${itemLabel({ ...item, qty })} birikime eklendi · maaştan ${money(amount)} düştü`); renderView();
      };
    });
  }
  function undoItem(m, item) {
    if (!confirm(`${itemLabel(item)} alınmadı olarak geri alınsın mı? Birikimden çıkarılır, maaşa geri eklenir.`)) return;
    state.savings.holdings = state.savings.holdings.filter((h) => h.id !== item.holdingId);
    m.saving.done = Math.max(0, (m.saving.done || 0) - (item.doneAmount || 0));
    Object.assign(item, { done: false, doneAmount: 0, doneDate: undefined, holdingId: undefined });
    save(); toast('Geri alındı'); renderView();
  }

  // ---------- Sayfa: Giriş / Çıkış ----------
  function renderIslem() {
    const key = curMonthKey(), m = getMonth(key);
    if (!m) { view.innerHTML = emptyMonth(key); bindEmptyMonth(key); return; }
    const mode = state.ui.mode || 'gider';
    if (state.ui.cat && !m.categories.some((c) => c.id === state.ui.cat)) state.ui.cat = null;
    const sel = m.categories.find((c) => c.id === state.ui.cat);
    const st = sel ? catStats(m, sel) : null;
    const s = calc(m, key);
    const defDate = monthKeyOf() === key ? todayISO() : `${key}-01`;
    const catById = Object.fromEntries(m.categories.map((c) => [c.id, c]));
    const subName = (e) => { const c = catById[e.catId]; const sb = c && e.subId && (c.subs || []).find((x) => x.id === e.subId); return sb ? sb.name : ''; };
    const subFilter = state.ui.sub && sel && (sel.subs || []).some((x) => x.id === state.ui.sub) ? state.ui.sub : null;
    const history = [...m.expenses].filter((e) => (!sel || e.catId === sel.id) && (!subFilter || e.subId === subFilter)).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    const pickOrder = [...s.varCats, ...s.fixedCats, ...s.instCats];

    const giderHTML = `
      <div class="card">
        <div class="card-head"><h3>Hangi kategori?</h3><button class="link-btn" id="new-cat">+ Yeni</button></div>
        <div class="cat-grid">
          ${pickOrder.map((c) => `<button class="cat-pick ${sel && sel.id === c.id ? 'on' : ''}" data-pick="${c.id}">
            <span class="e">${esc(c.emoji || '•')}</span><span class="n">${esc(catLabel(c))}</span>
            <span class="l ${c.diff < 0 ? 'bad' : ''}">${isCommit(c) && c.spent > 0 && c.diff >= 0 ? '✓ ödendi' : c.planned > 0 ? (c.diff < 0 ? '−' + money(-c.diff) : money(c.diff) + ' kaldı') : 'bütçesiz'}</span></button>`).join('')}
        </div>
      </div>

      ${st ? `<div class="card">
        <div class="card-head"><h3>${esc(st.emoji || '')} ${esc(catLabel(st))}</h3><button class="link-btn" id="edit-sel">Düzenle</button></div>
        <div class="stats" style="margin-top:0;grid-template-columns:repeat(3,1fr)">
          <div class="stat"><div class="k">Ayrılan</div><div class="v">${money(st.planned)}</div></div>
          <div class="stat"><div class="k">Harcanan</div><div class="v">${money(st.spent)}</div></div>
          <div class="stat"><div class="k">${st.diff < 0 ? 'Aşım' : 'Kalan'}</div><div class="v ${st.diff < 0 ? 'bad' : 'good'}">${money(Math.abs(st.diff))}</div></div>
        </div>
        <div style="margin-top:12px">${catBar(st)}</div>
        <div class="cat-bottom"><span>${statusChip(st, s.phase)}</span><span class="muted">${st.planned > 0 ? '%' + Math.round((st.spent / st.planned) * 100) + ' kullanıldı' : ''}</span></div>
        ${st.bySub.length ? `<div class="filters" style="margin-top:12px;margin-bottom:0">
          <button data-sub="" class="${!subFilter ? 'on' : ''}">Tümü</button>
          ${st.bySub.map((x) => `<button data-sub="${x.id}" class="${subFilter === x.id ? 'on' : ''}" ${x.planned > 0 && x.spent > x.planned ? 'style="color:var(--bad)"' : ''}>${esc(x.name)} · ${money(x.spent)}${x.planned > 0 ? ' / ' + money(x.planned) : ''}</button>`).join('')}
        </div>` : ''}
      </div>` : ''}

      <div class="card"><h3>Gider gir</h3><div id="entry"></div></div>

      <div class="section-title">${monthName(key)} · ${sel ? esc(sel.name) : 'tüm'} hareketleri</div>
      ${history.length ? `<div class="card" style="padding:4px 16px"><ul class="list">${history.map((e) => {
        const c = catById[e.catId];
        const extra = e.extra || !(+c?.planned > 0);
        const sn = subName(e);
        return `<li class="tap" data-exp="${e.id}">
          <div class="main"><div class="title">${esc(e.desc || c?.name || 'Harcama')}</div>
          <div class="sub">${shortDate(e.date)}${sel ? '' : ' · ' + esc(c ? (c.emoji || '') + ' ' + c.name : 'Kategorisiz')}${sn ? ' · ' + esc(sn) : ''}${extra ? ' · <span class="warn">Ekstra</span>' : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
          <div class="amt">−${money(e.amount)}</div></li>`;
      }).join('')}</ul>
      <div class="card-foot"><span class="muted small">${history.length} işlem</span><b>${money(sum(history, 'amount'))}</b></div></div>`
      : `<div class="card empty small">${sel ? 'Bu kategoride bu ay henüz harcama yok.' : 'Bu ay henüz harcama yok.'}</div>`}
      ${sel ? '<button class="btn secondary" id="show-all">Tüm kategorileri göster</button>' : `<button class="btn secondary" id="csv">Bu ayı CSV (Excel) olarak indir</button>`}`;

    const gelirHTML = `
      <div class="card"><h3>Gelir gir</h3><div id="inc-entry"></div></div>
      <div class="section-title">${monthName(key)} gelirleri</div>
      <div class="card" style="padding:4px 16px"><ul class="list">${m.incomes.map((i) => `<li class="tap" data-inc="${i.id}"><div class="main"><div class="title">${esc(i.name)}</div><div class="sub">${incLabel(i, key)}${i.note ? ' · ' + esc(i.note) : ''}</div></div><div class="amt good">+${money(i.amount)}</div></li>`).join('') || '<li class="muted small">Henüz gelir yok.</li>'}</ul>
      <div class="card-foot"><span class="muted small">Toplam</span><b>${money(s.income)}</b></div></div>`;

    view.innerHTML = `
      <div class="seg" id="mode"><button data-m="gider" class="${mode === 'gider' ? 'on' : ''}">− Gider (çıkış)</button><button data-m="gelir" class="${mode === 'gelir' ? 'on' : ''}">+ Gelir (giriş)</button></div>
      ${mode === 'gelir' ? gelirHTML : giderHTML}`;

    $$('#mode button').forEach((b) => (b.onclick = () => { state.ui.mode = b.dataset.m; renderIslem(); }));

    if (mode === 'gelir') {
      incomeEntry($('#inc-entry'), m, { onDone: renderIslem });
      $$('[data-inc]', view).forEach((li) => (li.onclick = () => incomeForm(m, m.incomes.find((i) => i.id === li.dataset.inc))));
      return;
    }

    $$('[data-pick]', view).forEach((b) => (b.onclick = () => { state.ui.cat = state.ui.cat === b.dataset.pick ? null : b.dataset.pick; state.ui.sub = null; renderIslem(); }));
    $$('[data-sub]', view).forEach((b) => (b.onclick = () => { state.ui.sub = b.dataset.sub || null; renderIslem(); }));
    $('#new-cat').onclick = () => categoryForm(m, null);
    const es = $('#edit-sel'); if (es) es.onclick = () => (sel.kind === 'var' ? categoryForm(m, sel) : sel.kind === 'fixed' ? fixedForm(state.plan.fixed.find((x) => x.id === sel.tplId)) : installmentForm(state.installments.find((x) => x.id === sel.instId)));
    const sa = $('#show-all'); if (sa) sa.onclick = () => { state.ui.cat = null; state.ui.sub = null; renderIslem(); };
    const csv = $('#csv'); if (csv) csv.onclick = () => exportCSV(m, key);
    $$('[data-exp]', view).forEach((li) => (li.onclick = () => expenseForm(m.expenses.find((e) => e.id === li.dataset.exp))));

    entryForm($('#entry'), m, key, { sel, subFilter, onDone: renderIslem });
  }

  // ---------- Ortak gider giriş formu (İşlemler sayfası ve ＋ düğmesi) ----------
  // Tek seferlik: bir kategoriden düşer. Yinelenen: "Her ay" → sabit gider; "N ay" → N ay sürer (taksit gibi) sonra biter.
  // Tarih sorulmaz; kayıt oluşturulduğu günün tarihini alır.
  const REPEATS = [[0, 'Her ay (süresiz) — sabit gider'], [2, '2 ay'], [3, '3 ay'], [4, '4 ay'], [5, '5 ay'], [6, '6 ay'], [9, '9 ay'], [12, '12 ay'], [18, '18 ay'], [24, '24 ay'], [36, '36 ay']];
  function entryForm(root, m, key, opts = {}) {
    let kind = opts.kind || 'once';
    const sel = opts.sel || null;
    const cats = [...m.categories.filter((c) => c.kind === 'var'), ...m.categories.filter(isCommit)];
    const catById = Object.fromEntries(m.categories.map((c) => [c.id, c]));
    const today = todayISO();
    const draw = () => {
      root.innerHTML = `
        <div class="seg" id="ef-kind"><button type="button" data-k="once" class="${kind === 'once' ? 'on' : ''}">Tek seferlik</button><button type="button" data-k="rec" class="${kind === 'rec' ? 'on' : ''}">🔁 Yinelenen</button></div>
        ${kind === 'once' ? `
        <form id="ef" autocomplete="off">
          <div class="field"><input class="input big" name="amount" inputmode="decimal" placeholder="₺0" required></div>
          <div class="field"><label>Ne aldın / nereye? <span class="muted">(yazınca kategori seçilir)</span></label>
            <input class="input" name="desc" list="ef-desc" placeholder="ör. Boston, BİM, Trendyol">
            <datalist id="ef-desc">${knownDescriptions().map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
            <div class="hint" id="ef-guess"></div></div>
          <div class="field"><label>Kategori</label>
            <select class="input" name="catId" required><option value="">Kategori seç</option>
              ${cats.map((c) => `<option value="${c.id}" ${sel && sel.id === c.id ? 'selected' : ''}>${esc(c.emoji || '')} ${esc(catLabel(c))}</option>`).join('')}</select>
            <div class="hint" id="ef-left"></div></div>
          <div class="field" id="ef-subw"><label>Alt başlık</label><select class="input" name="subId"></select></div>
          <div class="field"><label>Not</label><input class="input" name="note" placeholder="İsteğe bağlı"></div>
          <label class="check"><input type="checkbox" name="extra"> Plan dışı / ekstra harcama</label>
          <button class="btn" type="submit">Kaydet</button>
          <p class="hint">Tarih: bugün (${shortDate(today)}).</p>
        </form>` : `
        <form id="ef" autocomplete="off">
          <div class="field"><label>Aylık tutar</label><input class="input big" name="amount" inputmode="decimal" placeholder="₺0" required></div>
          <div class="row2" style="grid-template-columns:72px 1fr">
            <div class="field"><label>Simge</label><input class="input" name="emoji" maxlength="4" placeholder="🔁" style="text-align:center"></div>
            <div class="field"><label>Ne için?</label><input class="input" name="name" list="ef-fix" placeholder="ör. Kira, Netflix, Telefon taksiti" required>
              <datalist id="ef-fix">${SUGGEST_FIXED.map(([n]) => `<option value="${n}">`).join('')}</datalist></div>
          </div>
          <div class="field"><label>Kaç ay yinelenecek?</label>
            <select class="input" name="repeat">${REPEATS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
            <div class="hint" id="ef-rep"></div></div>
          <label class="check"><input type="checkbox" name="paid" checked> Bu ayın ödemesini şimdi yaptım (bugün düşülsün)</label>
          <button class="btn" type="submit">Kaydet</button>
        </form>`}`;
      $$('#ef-kind button', root).forEach((b) => (b.onclick = () => { kind = b.dataset.k; draw(); }));
      const f = $('#ef', root);
      if (kind === 'rec') {
        const rep = () => {
          const n = +f.repeat.value, a = parseAmount(f.amount.value) || 0, now = monthKeyOf();
          $('#ef-rep', root).innerHTML = n === 0
            ? `Her ay <b>${money(a)}</b> sabit gider olarak eklenir; Ödemeler'den istediğin zaman durdurursun.`
            : `${monthName(now, true)} → ${monthName(addMonth(now, n - 1), true)} arası <b>${n} ay</b> × ${money(a)} = ${money(a * n)}; sonra kendiliğinden biter.`;
        };
        f.repeat.onchange = rep; f.amount.oninput = rep; rep();
        f.name.onchange = () => { const s = SUGGEST_FIXED.find(([n]) => lower(n) === lower(f.name.value)); if (s && !f.emoji.value) f.emoji.value = s[1]; };
        f.onsubmit = (ev) => {
          ev.preventDefault();
          const amount = parseAmount(f.amount.value);
          if (!(amount > 0)) return toast('Geçerli bir tutar gir');
          const name = f.name.value.trim();
          if (!name) return toast('Ne için olduğunu yaz');
          const msg = addRecurring({ name, emoji: f.emoji.value.trim(), amount, repeat: +f.repeat.value, paid: f.paid.checked });
          save(); toast(msg); opts.onDone && opts.onDone();
        };
        return;
      }
      let touched = !!sel;
      const fillSubs = (selSub) => { const c = catById[f.catId.value]; f.subId.innerHTML = subSelect(c, selSub); $('#ef-subw', root).hidden = !(c && c.subs && c.subs.length); };
      const left = () => {
        const c = catById[f.catId.value], h = $('#ef-left', root);
        if (!c) { h.textContent = ''; return; }
        const cs = catStats(m, c);
        const rest = cs.planned - cs.spent - (parseAmount(f.amount.value) || 0);
        h.innerHTML = cs.planned > 0
          ? `Limit ${money(cs.planned)} · harcanan ${money(cs.spent)} → bundan sonra <b class="${rest < 0 ? 'bad' : 'good'}">${rest < 0 ? money(-rest) + ' aşım' : money(rest) + ' kalır'}</b>`
          : `<span class="warn">Bu kategoride limit yok — ekstra sayılır.</span>`;
      };
      f.catId.onchange = () => { touched = true; fillSubs(); left(); };
      f.amount.oninput = left;
      f.desc.oninput = () => {
        const g = guessCategory(f.desc.value, m);
        if (!g) return;
        if (!touched) { f.catId.value = g.cat; fillSubs(g.sub); $('#ef-guess', root).textContent = `✨ ${catById[g.cat].name}${g.sub ? ' › ' + (catById[g.cat].subs.find((x) => x.id === g.sub) || {}).name : ''} seçildi`; left(); }
        else if (f.catId.value === g.cat && g.sub) f.subId.value = g.sub;
      };
      fillSubs(opts.subFilter); left();
      if (opts.focus) setTimeout(() => f.amount.focus(), 250);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount > 0)) return toast('Geçerli bir tutar gir');
        if (!f.catId.value) return toast('Kategori seç');
        const data = { desc: f.desc.value.trim(), amount, catId: f.catId.value, subId: f.subId.value || undefined, date: todayISO(), extra: f.extra.checked, note: f.note.value.trim() };
        const msg = addExpense(m, key, data);
        save(); toast(msg); opts.onDone && opts.onDone();
      };
    };
    draw();
  }

  // Yinelenen gider: repeat=0 → plana sabit gider; repeat=N → bu aydan başlayan N aylık taksit
  function addRecurring({ name, emoji, amount, repeat, paid }) {
    const now = monthKeyOf();
    if (!state.plan) state.plan = { incomes: [], fixed: [], categories: [], savingItems: [], reviewed: true, empty: true };
    let cat;
    if (repeat === 0) {
      const t = { id: uid(), name, emoji: emoji || '📌', amount };
      state.plan.fixed.push(t);
      if (!state.months[now]) buildMonth(now);
      syncFuture(new Set([t.id]));
      const m = state.months[now];
      cat = m.categories.find((c) => c.tplId === t.id);
      if (!cat) { cat = { id: uid(), tplId: t.id, kind: 'fixed', name, emoji: t.emoji, planned: amount, subs: [] }; m.categories.push(cat); }
    } else {
      const i = { id: uid(), name, emoji: emoji || '🔁', monthly: amount, count: repeat, start: now, from: now };
      state.installments.push(i);
      if (!state.months[now]) buildMonth(now);
      syncInstallment(i.id, now);
      cat = state.months[now].categories.find((c) => c.instId === i.id);
    }
    if (paid && cat) state.months[now].expenses.push({ id: uid(), catId: cat.id, desc: catLabel(cat), amount, date: todayISO(), extra: false });
    return repeat === 0 ? `${name}: her ay ${money(amount)} sabit gider eklendi${paid ? ' · bu ay ödendi' : ''}` : `${name}: ${repeat} ay × ${money(amount)} eklendi${paid ? ' · bu ay ödendi' : ''}`;
  }

  // ＋ düğmesi: hızlı gider / gelir
  function quickAdd() {
    const key = curMonthKey();
    let m = getMonth(key);
    if (!m) { if (state.plan) m = buildMonth(key); else m = ensureMonth(key); save(); }
    openSheet('Yeni işlem', `<div class="seg" id="qa-mode"><button type="button" data-m="gider" class="on">− Gider</button><button type="button" data-m="gelir">+ Gelir</button></div><div id="qa-body"></div>`, (root) => {
      const body = $('#qa-body', root);
      const show = (mode) => {
        $$('#qa-mode button', root).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
        if (mode === 'gider') {
          if (!m.categories.length) { body.innerHTML = '<p class="small muted">Önce bir kategori ekle ya da “Yinelenen” gider gir.</p><div id="qa-e"></div>'; entryForm($('#qa-e', root), m, key, { kind: 'rec', onDone: () => { closeSheet(); renderView(); } }); return; }
          entryForm(body, m, key, { focus: true, onDone: () => { closeSheet(); renderView(); } });
        } else {
          incomeEntry(body, m, { onDone: () => { closeSheet(); renderView(); } });
        }
      };
      $$('#qa-mode button', root).forEach((b) => (b.onclick = () => show(b.dataset.m)));
      show('gider');
    });
  }

  // Gelir girişi: Tek seferlik ya da Yinelenen (her ay / N ay). Tarih: bugün.
  function incomeEntry(root, m, opts = {}) {
    let kind = 'once';
    const names = [...new Set(monthKeys().flatMap((k) => state.months[k].incomes.map((i) => i.name)))];
    const draw = () => {
      root.innerHTML = `
        <div class="seg" id="ie-kind"><button type="button" data-k="once" class="${kind === 'once' ? 'on' : ''}">Tek seferlik</button><button type="button" data-k="rec" class="${kind === 'rec' ? 'on' : ''}">🔁 Yinelenen</button></div>
        <form id="ie" autocomplete="off">
          <div class="field">${kind === 'rec' ? '<label>Aylık tutar</label>' : ''}<input class="input big" name="amount" inputmode="decimal" placeholder="₺0" required></div>
          <div class="field"><label>Gelir adı</label><input class="input" name="name" list="ie-names" placeholder="${kind === 'rec' ? 'ör. Maaş, Kira geliri, Burs' : 'ör. Prim, Satış, Hediye'}" required>
            <datalist id="ie-names">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
          ${kind === 'rec' ? `<div class="field"><label>Kaç ay yinelenecek?</label>
            <select class="input" name="repeat">${REPEATS.map(([v, n]) => `<option value="${v}">${v === 0 ? 'Her ay (süresiz)' : n}</option>`).join('')}</select>
            <div class="hint" id="ie-rep"></div></div>` : `<div class="field"><label>Not</label><input class="input" name="note" placeholder="İsteğe bağlı"></div>`}
          <button class="btn" type="submit">Geliri ekle</button>
          <p class="hint">Tarih: bugün (${shortDate(todayISO())}).</p>
        </form>`;
      $$('#ie-kind button', root).forEach((b) => (b.onclick = () => { kind = b.dataset.k; draw(); }));
      const f = $('#ie', root);
      if (kind === 'rec') {
        const rep = () => {
          const n = +f.repeat.value, a = parseAmount(f.amount.value) || 0, now = monthKeyOf();
          $('#ie-rep', root).innerHTML = n === 0 ? `Her ay <b>+${money(a)}</b> gelir olarak eklenir.` : `${monthName(now, true)} → ${monthName(addMonth(now, n - 1), true)} arası <b>${n} ay</b> × ${money(a)}; sonra kendiliğinden biter.`;
        };
        f.repeat.onchange = rep; f.amount.oninput = rep; rep();
      }
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount > 0)) return toast('Geçerli bir tutar gir');
        const name = f.name.value.trim();
        if (!name) return toast('Gelir adını yaz');
        addIncome(m, { name, amount, note: f.note ? f.note.value.trim() : '', repeat: kind === 'rec' ? +f.repeat.value : null });
        save(); toast(kind === 'rec' ? `+${money(amount)} ${+f.repeat.value ? f.repeat.value + ' ay boyunca' : 'her ay'} eklendi` : `+${money(amount)} gelir eklendi`);
        opts.onDone && opts.onDone();
      };
    };
    draw();
  }
  // repeat: null → tek seferlik; 0 → her ay; N → bu aydan başlayarak N ay
  function addIncome(m, { name, amount, note, repeat }) {
    const now = monthKeyOf();
    const target = state.months[now] || ensureMonth(now);
    const inc = { id: uid(), name, amount, note: note || '', date: todayISO() };
    if (repeat != null) {
      if (!state.plan) state.plan = { incomes: [], fixed: [], categories: [], savingItems: [], reviewed: true, empty: true };
      const t = { id: uid(), name, amount, ...(repeat > 0 ? { start: now, count: repeat } : {}) };
      state.plan.incomes.push(t); inc.tplId = t.id;
      target.incomes.push(inc); syncFuture(new Set([t.id]));
    } else target.incomes.push(inc);
    void m;
  }
  // Gelirin türü: tek seferlik / her ay / N ay (x/N)
  function incLabel(i, key) {
    if (!i.tplId) return 'Tek seferlik';
    const t = state.plan && state.plan.incomes.find((x) => x.id === i.tplId);
    if (t && t.count) return `🔁 Yinelenen · ${monthDiff(t.start, key) + 1}/${t.count} ay`;
    return '🔁 Her ay';
  }

  function addExpense(m, key, data) {
    const targetKey = data.date.slice(0, 7);
    if (targetKey === key) { m.expenses.push({ id: uid(), ...data }); return warnAfterSave(m, data.catId, data.subId); }
    const src = m.categories.find((c) => c.id === data.catId);
    const tm = ensureMonth(targetKey);
    let tc = tm.categories.find((c) => lower(c.name) === lower(src.name));
    if (!tc) { tc = { ...clone(src), id: uid() }; tm.categories.push(tc); }
    const sname = data.subId && (src.subs || []).find((s) => s.id === data.subId)?.name;
    const ts = sname && (tc.subs || []).find((s) => lower(s.name) === lower(sname));
    tm.expenses.push({ id: uid(), ...data, catId: tc.id, subId: ts ? ts.id : undefined });
    return `${monthName(targetKey)} ayına kaydedildi · ${warnAfterSave(tm, tc.id, ts ? ts.id : null)}`;
  }

  function exportCSV(m, key) {
    const catById = Object.fromEntries(m.categories.map((c) => [c.id, c]));
    const rows = [['Tarih', 'Açıklama', 'Kategori', 'Alt başlık', 'Tutar', 'Ekstra', 'Not']].concat(
      [...m.expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
        const c = catById[e.catId];
        return [e.date, e.desc, c ? catLabel(c) : '', (c && e.subId && (c.subs || []).find((s) => s.id === e.subId)?.name) || '', String(e.amount).replace('.', ','), e.extra ? 'Evet' : 'Hayır', e.note || ''];
      }));
    download(`harcamalar-${key}.csv`, '﻿' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
  }

  function expenseForm(exp) {
    const key = curMonthKey();
    const m = getMonth(key);
    if (!m) { toast('Önce bu ay için planını uygula'); return; }
    if (!m.categories.length) { toast('Önce bir kategori ekle'); categoryForm(m, null); return; }
    const isNew = !exp;
    const e = exp || { desc: '', amount: '', catId: state.ui.cat || '', subId: '', date: monthKeyOf() === key ? todayISO() : `${key}-01`, extra: false, note: '' };
    const cats = [...m.categories.filter((c) => c.kind === 'var'), ...m.categories.filter(isCommit)];
    openSheet(isNew ? 'Gider ekle' : 'Gideri düzenle', `
      <form id="f" autocomplete="off">
        <div class="field"><input class="input big" name="amount" inputmode="decimal" placeholder="₺0" value="${amtStr(e.amount)}" required></div>
        <div class="field"><label>Ne aldın / nereye?</label>
          <input class="input" name="desc" list="desc-list2" placeholder="ör. Boston, BİM" value="${esc(e.desc)}">
          <datalist id="desc-list2">${knownDescriptions().map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
          <div class="hint" id="guess-hint"></div></div>
        <div class="field"><label>Hangi bütçeden düşsün?</label>
          <select class="input" name="catId" required><option value="">Kategori seç</option>
            ${cats.map((c) => `<option value="${c.id}" ${c.id === e.catId ? 'selected' : ''}>${esc(c.emoji || '')} ${esc(catLabel(c))}</option>`).join('')}</select>
          <div class="hint" id="cat-left"></div></div>
        <div class="field" id="sub-wrap"><label>Alt başlık</label><select class="input" name="subId"></select></div>
        <div class="field"><label>Not</label><input class="input" name="note" value="${esc(e.note || '')}" placeholder="İsteğe bağlı"></div>
        <p class="hint" style="margin-top:-4px">Tarih: ${shortDate(e.date)}</p>
        <label class="check"><input type="checkbox" name="extra" ${e.extra ? 'checked' : ''}> Plan dışı / ekstra harcama</label>
        <button class="btn" type="submit">${isNew ? 'Kaydet' : 'Güncelle'}</button>
        ${isNew ? '' : `<div class="btn-row"><button class="btn danger" type="button" id="del">Sil</button>${e.group ? '<button class="btn danger" type="button" id="del-all">Tüm taksitleri sil</button>' : ''}</div>`}
      </form>`, (root) => {
      const f = $('#f', root);
      let touched = !!e.catId;
      const fillSubs = (selSub) => { const c = m.categories.find((x) => x.id === f.catId.value); f.subId.innerHTML = subSelect(c, selSub); $('#sub-wrap', root).hidden = !(c && c.subs && c.subs.length); };
      const left = () => {
        const c = m.categories.find((x) => x.id === f.catId.value);
        const h = $('#cat-left', root);
        if (!c) { h.textContent = ''; return; }
        const spent = sum(m.expenses.filter((x) => x.catId === c.id && x.id !== e.id), 'amount');
        const rest = (+c.planned || 0) - spent - (parseAmount(f.amount.value) || 0);
        h.innerHTML = c.planned > 0 ? `Bundan sonra <b class="${rest < 0 ? 'bad' : 'good'}">${rest < 0 ? money(-rest) + ' aşım' : money(rest) + ' kalır'}</b>` : `<span class="warn">Bu kategoride bütçe yok — ekstra sayılır.</span>`;
      };
      f.catId.onchange = () => { touched = true; fillSubs(); left(); };
      f.amount.oninput = left;
      f.desc.oninput = () => {
        const g = guessCategory(f.desc.value, m);
        if (!g) return;
        if (!touched) { f.catId.value = g.cat; fillSubs(g.sub); $('#guess-hint', root).textContent = '✨ Kategori otomatik seçildi'; left(); }
        else if (f.catId.value === g.cat && g.sub) f.subId.value = g.sub;
      };
      fillSubs(e.subId); left();
      if (isNew) setTimeout(() => f.amount.focus(), 250);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount > 0)) return toast('Geçerli bir tutar gir');
        if (!f.catId.value) return toast('Kategori seç');
        const data = { desc: f.desc.value.trim(), amount, catId: f.catId.value, subId: f.subId.value || undefined, date: isNew ? todayISO() : e.date, extra: f.extra.checked, note: f.note.value.trim() };
        if (isNew) { const msg = addExpense(m, key, data); save(); closeSheet(); renderView(); toast(msg); return; }
        if (data.date.slice(0, 7) !== key) { m.expenses = m.expenses.filter((x) => x.id !== e.id); addExpense(m, key, data); }
        else Object.assign(e, data);
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
    const i = inc || { name: '', amount: '', note: '' };
    const inPlan = !!(inc && inc.tplId);
    openSheet(isNew ? 'Gelir ekle' : 'Geliri düzenle', `
      <form id="f">
        <div class="field"><label>Gelir adı</label><input class="input" name="name" value="${esc(i.name)}" placeholder="ör. Maaş, Ek iş" required></div>
        <div class="field"><label>Tutar</label><input class="input" name="amount" inputmode="decimal" value="${amtStr(i.amount)}" placeholder="₺0" required></div>
        <div class="field"><label>Not</label><input class="input" name="note" value="${esc(i.note || '')}" placeholder="İsteğe bağlı"></div>
        <label class="check"><input type="checkbox" name="plan" ${inPlan ? 'checked' : ''}> Her ay gelir (planıma kayıtlı)</label>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : `<div class="btn-row"><button class="btn danger" type="button" id="del">Bu aydan sil</button>${inPlan ? '<button class="btn danger" type="button" id="del-plan">Plandan da kaldır</button>' : ''}</div>
        <p class="hint">“Bu aydan sil”: örneğin bu ay ek gelir olmadıysa. “Plandan da kaldır”: bundan sonraki aylarda da olmasın.</p>`}
      </form>`, (root) => {
      const f = $('#f', root);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount >= 0)) return toast('Geçerli bir tutar gir');
        const data = { name: f.name.value.trim(), amount, note: f.note.value.trim() };
        let target = inc;
        if (isNew) { target = { id: uid(), ...data }; m.incomes.push(target); } else Object.assign(inc, data);
        if (f.plan.checked && state.plan) {
          let t = target.tplId && state.plan.incomes.find((x) => x.id === target.tplId);
          if (!t) { t = { id: uid() }; state.plan.incomes.push(t); target.tplId = t.id; }
          Object.assign(t, { name: data.name, amount: data.amount });
          syncFuture(new Set([t.id]));
        } else if (!f.plan.checked && target.tplId && state.plan) {
          state.plan.incomes = state.plan.incomes.filter((x) => x.id !== target.tplId);
          delete target.tplId; syncFuture(new Set());
        }
        save(); closeSheet(); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => {
        if (!confirm(`${inc.name} bu aydan silinsin mi?`)) return;
        m.incomes = m.incomes.filter((x) => x.id !== inc.id);
        if (inc.tplId) { m.skip = m.skip || []; m.skip.push(inc.tplId); }
        save(); closeSheet(); toast('Bu aydan silindi'); renderView();
      };
      const dp = $('#del-plan', root);
      if (dp) dp.onclick = () => {
        if (!confirm(`${inc.name} planından ve bu aydan kaldırılsın mı?`)) return;
        state.plan.incomes = state.plan.incomes.filter((x) => x.id !== inc.tplId);
        m.incomes = m.incomes.filter((x) => x.id !== inc.id);
        syncFuture(new Set());
        save(); closeSheet(); toast('Plandan kaldırıldı'); renderView();
      };
    });
  }

  // Değişken kategori: ad, simge, tutar, alt başlıklar, artanı birikime
  function categoryForm(m, cat) {
    const isNew = !cat;
    const c = cat ? clone(cat) : { name: '', planned: '', emoji: '', subs: [], toSavings: false };
    c.subs = c.subs || [];
    const used = cat ? m.expenses.filter((e) => e.catId === cat.id) : [];
    const others = cat ? m.categories.filter((x) => x.id !== cat.id) : [];
    const draw = () => openSheet(isNew ? 'Kategori ekle' : 'Kategoriyi düzenle', `
      <form id="f">
        <div class="row2" style="grid-template-columns:80px 1fr">
          <div class="field"><label>Simge</label><input class="input" name="emoji" value="${esc(c.emoji || '')}" maxlength="4" placeholder="🛍️" style="text-align:center"></div>
          <div class="field"><label>Ad</label><input class="input" name="name" value="${esc(c.name)}" placeholder="ör. İhtiyaçlarım" required></div>
        </div>
        <div class="field"><label>Ayrılan tutar ${c.subs.length ? '(üst limit)' : ''}</label><input class="input" name="planned" inputmode="decimal" value="${amtStr(c.planned)}" placeholder="₺0"></div>
        <div class="field"><label>Alt başlıklar ve bütçeleri</label>
          ${c.subs.map((s) => `<div class="subrow"><span class="tree">└</span><input class="input" data-sname="${s.id}" value="${esc(s.name)}">
            <input class="input amt-in" data-splan="${s.id}" inputmode="decimal" value="${amtStr(s.planned)}" placeholder="₺0"><button type="button" class="x" data-dsub="${s.id}">✕</button></div>`).join('')}
          <div class="subrow"><span class="tree">└</span><input class="input sub-in2" id="new-sub" placeholder="+ alt başlık ekle (ör. Ayakkabı)"></div>
          <div class="subsum" id="ss">${subSumText({ ...c, planned: parseAmount(c.planned) || 0 })}</div>
          <div class="hint">Alt başlık bütçeleri kategori limitinin içinden ayrılır; toplamları limiti aşamaz.</div></div>
        <label class="check"><input type="checkbox" name="toSavings" ${c.toSavings ? 'checked' : ''}> Ay sonunda artarsa birikime aktarılacak</label>
        <label class="check"><input type="checkbox" name="plan" ${isNew || cat.tplId ? 'checked' : ''}> Planıma kaydet (sonraki aylarda da böyle olsun)</label>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : `
          ${used.length && others.length ? `<div class="field" style="margin-top:14px"><label>Silerken ${used.length} harcamayı şuraya taşı</label>
            <select class="input" name="moveTo">${others.map((o) => `<option value="${o.id}">${esc(o.emoji || '')} ${esc(catLabel(o))}</option>`).join('')}</select></div>` : ''}
          <div class="btn-row"><button class="btn danger" type="button" id="del">Kategoriyi sil</button></div>
          <p class="hint">“Planıma kaydet” işaretliyse kategori sonraki aylardan da kalkar; değilse sadece bu aydan.</p>`}
      </form>`, (root) => {
      const f = $('#f', root);
      const keep = () => { c.name = f.name.value; c.emoji = f.emoji.value; c.planned = f.planned.value; c.toSavings = f.toSavings.checked; };
      const refreshSum = () => { $('#ss', root).innerHTML = subSumText({ ...c, planned: parseAmount(f.planned.value) || 0 }); };
      $$('[data-sname]', root).forEach((el) => (el.oninput = () => { c.subs.find((s) => s.id === el.dataset.sname).name = el.value; }));
      $$('[data-splan]', root).forEach((el) => (el.oninput = () => { c.subs.find((s) => s.id === el.dataset.splan).planned = amt0(el.value); refreshSum(); }));
      f.planned.oninput = refreshSum;
      $('#new-sub', root).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } });
      $('#new-sub', root).onchange = (ev) => {
        const n = ev.target.value.trim(); if (!n) return; keep();
        const free = Math.max(0, (parseAmount(c.planned) || 0) - sum(c.subs, 'planned'));
        c.subs.push({ id: uid(), name: n, planned: 0 }); draw(); setTimeout(() => $('#new-sub').focus(), 50);
      };
      $$('[data-dsub]', root).forEach((b) => (b.onclick = () => {
        const inUse = m.expenses.some((e) => e.subId === b.dataset.dsub);
        if (inUse && !confirm('Bu alt başlıkta harcama var; harcamalar alt başlıksız kalır. Silinsin mi?')) return;
        keep(); c.subs = c.subs.filter((s) => s.id !== b.dataset.dsub); draw();
      }));
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const planned = f.planned.value.trim() ? parseAmount(f.planned.value) : 0;
        if (!(planned >= 0)) return toast('Geçerli bir tutar gir');
        if (c.subs.length && sum(c.subs, 'planned') > planned) return toast('Alt bütçelerin toplamı kategori limitini aşamaz');
        const data = { name: f.name.value.trim(), planned, emoji: f.emoji.value.trim(), subs: clone(c.subs.filter((s) => s.name.trim())), toSavings: f.toSavings.checked };
        let target = cat;
        if (isNew) { target = { id: uid(), kind: 'var', ...data }; m.categories.push(target); } else Object.assign(cat, data);
        m.expenses.forEach((e) => { if (e.catId === target.id && e.subId && !data.subs.some((s) => s.id === e.subId)) delete e.subId; });
        if (f.plan.checked && state.plan) {
          let t = target.tplId && state.plan.categories.find((x) => x.id === target.tplId);
          if (!t) { t = { id: uid() }; state.plan.categories.push(t); target.tplId = t.id; }
          Object.assign(t, clone(data));
          syncFuture(new Set([t.id]));
        }
        save(); closeSheet(); toast('Kaydedildi'); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => {
        if (used.length && !others.length) return toast('Önce bu kategorideki harcamaları sil');
        if (!confirm(used.length ? `${cat.name} silinsin ve ${used.length} harcama taşınsın mı?` : `${cat.name} silinsin mi?`)) return;
        if (used.length) { const to = f.moveTo.value; used.forEach((e) => { e.catId = to; delete e.subId; }); }
        m.categories = m.categories.filter((x) => x.id !== cat.id);
        if (cat.tplId) {
          if (f.plan.checked && state.plan) { state.plan.categories = state.plan.categories.filter((x) => x.id !== cat.tplId); syncFuture(new Set()); }
          else { m.skip = m.skip || []; m.skip.push(cat.tplId); }
        }
        if (state.ui.cat === cat.id) state.ui.cat = null;
        save(); closeSheet(); toast('Silindi'); renderView();
      };
    });
    draw();
  }

  // ---------- Sayfa: Ödemeler (sabit giderler + taksitler) ----------
  function renderOdemeler() {
    if (!state.plan) { view.innerHTML = emptyMonth(curMonthKey()); bindEmptyMonth(curMonthKey()); return; }
    const key = curMonthKey(), m = getMonth(key);
    const stOf = (pred) => (m ? m.categories.find(pred) : null);
    const paidOf = (c) => (c ? sum(m.expenses.filter((e) => e.catId === c.id), 'amount') : 0);
    const active = state.installments.filter((i) => instActive(i, key));
    const upcoming = state.installments.filter((i) => instFrom(i) > key);
    const done = state.installments.filter((i) => !instActive(i, key) && instFrom(i) <= key);
    const fixedTotal = sum(state.plan.fixed, 'amount'), instTotal = sum(active, 'monthly');
    const next = Array.from({ length: 6 }, (_, n) => addMonth(monthKeyOf(), n)).map((k) => ({ k, f: fixedTotal, t: sum(state.installments.filter((i) => instActive(i, k)), 'monthly') }));
    const maxN = Math.max(1, ...next.map((x) => x.f + x.t));

    const statusBtn = (c, attr) => {
      if (!m) return '';
      if (!c) return '<span class="chip neutral">Bu ayda yok</span>';
      const paid = paidOf(c);
      return paid > 0 ? `<span class="chip good">✓ ${money(paid)}</span>` : `<button class="btn small" data-pay="${c.id}" ${attr || ''}>Öde</button>`;
    };
    view.innerHTML = `
      <div class="card hero">
        <div class="hero-label">${monthName(key)} düzenli ödemeler</div>
        <div class="hero-num">${money(fixedTotal + instTotal)}</div>
        <div class="hero-sub">Sabit ${money(fixedTotal)} · Taksit ${money(instTotal)}</div>
      </div>

      <div class="card">
        <div class="card-head"><h3>📌 Sabit giderlerim</h3><button class="btn small" id="add-fix">+ Ekle</button></div>
        <ul class="list">${state.plan.fixed.map((t) => {
          const c = stOf((x) => x.tplId === t.id);
          return `<li><div class="main tap" data-fix="${t.id}"><div class="title">${esc(t.emoji || '•')} ${esc(t.name)}</div><div class="sub">Her ay ${money(t.amount)} · düzenlemek için dokun</div></div>
            <div class="right">${statusBtn(c)}</div></li>`;
        }).join('') || '<li class="muted small">Kira, kredi kartı, fatura, abonelik gibi her ay ödediklerini ekle.</li>'}</ul>
      </div>

      <div class="card">
        <div class="card-head"><h3>🧾 Taksitlerim</h3><button class="btn small" id="add-inst">+ Taksit</button></div>
        ${active.length ? `<ul class="list">${active.map((i) => {
          const seq = monthDiff(i.start, key) + 1, leftN = i.count - seq;
          const c = stOf((x) => x.instId === i.id);
          return `<li><div class="main tap" data-inst="${i.id}">
              <div class="title">${esc(i.emoji || '🧾')} ${esc(i.name)} <span class="muted small">${seq}/${i.count}</span></div>
              <div class="sub">Ayda ${money(i.monthly)} · kalan borç ${money(i.monthly * (leftN + (paidOf(c) > 0 ? 0 : 1)))} · son taksit ${monthName(addMonth(i.start, i.count - 1), true)}</div>
              <div class="bar" style="margin-top:6px"><i style="width:${(seq / i.count) * 100}%"></i></div></div>
            <div class="right">${statusBtn(c)}</div></li>`;
        }).join('')}</ul>` : '<p class="muted small" style="margin:0">Bu ay aktif taksit yok.</p>'}
        ${upcoming.length ? `<div class="section-title" style="margin-top:14px">Başlayacak</div><ul class="list">${upcoming.map((i) => `<li class="tap" data-inst="${i.id}"><div class="main"><div class="title">${esc(i.name)}</div><div class="sub">${monthName(i.start)} başlar · ${i.count} × ${money(i.monthly)}</div></div></li>`).join('')}</ul>` : ''}
        ${done.length ? `<details style="margin-top:10px"><summary class="muted small">Biten taksitler (${done.length})</summary><ul class="list">${done.map((i) => `<li class="tap" data-inst="${i.id}"><div class="main"><div class="title">${esc(i.name)}</div><div class="sub">${i.count} × ${money(i.monthly)} · ${monthName(addMonth(i.start, i.count - 1), true)} bitti</div></div><span class="chip good">✓</span></li>`).join('')}</ul></details>` : ''}
      </div>

      <div class="card">
        <h3>Önümüzdeki 6 ay</h3>
        ${next.map((x) => `<div style="display:grid;grid-template-columns:62px 1fr 92px;gap:10px;align-items:center;padding:6px 0">
          <span class="small muted">${monthName(x.k, true)}</span>
          <div class="bar"><i style="width:${((x.f + x.t) / maxN) * 100}%"></i></div>
          <span class="small right"><b>${money(x.f + x.t)}</b>${x.t ? `<br><span class="muted tiny">taksit ${money(x.t)}</span>` : ''}</span></div>`).join('')}
        <p class="hint">Taksit bittiğinde o ay kendiliğinden düşer.</p>
      </div>`;

    $('#add-fix').onclick = () => fixedForm();
    $('#add-inst').onclick = () => installmentForm();
    $$('[data-fix]', view).forEach((el) => (el.onclick = () => fixedForm(state.plan.fixed.find((x) => x.id === el.dataset.fix))));
    $$('[data-inst]', view).forEach((el) => (el.onclick = () => installmentForm(state.installments.find((x) => x.id === el.dataset.inst))));
    $$('[data-pay]', view).forEach((b) => (b.onclick = () => payFixed(m, key, m.categories.find((x) => x.id === b.dataset.pay))));
  }

  function fixedForm(t) {
    const isNew = !t;
    const x = t || { name: '', emoji: '', amount: '' };
    openSheet(isNew ? 'Sabit gider ekle' : 'Sabit gideri düzenle', `
      <form id="f">
        <div class="row2" style="grid-template-columns:80px 1fr">
          <div class="field"><label>Simge</label><input class="input" name="emoji" value="${esc(x.emoji || '')}" maxlength="4" placeholder="💳" style="text-align:center"></div>
          <div class="field"><label>Ad</label><input class="input" name="name" value="${esc(x.name)}" list="fix-sug" placeholder="ör. Kira, Kredi kartı" required>
            <datalist id="fix-sug">${SUGGEST_FIXED.map(([n]) => `<option value="${n}">`).join('')}</datalist></div>
        </div>
        <div class="field"><label>Aylık tutar</label><input class="input big" name="amount" inputmode="decimal" value="${amtStr(x.amount)}" placeholder="₺0" required></div>
        <p class="hint" style="margin-top:-4px">Bu ay ve sonraki aylar güncellenir; geçmiş aylar olduğu gibi kalır. Tutarı sadece bu ay farklıysa “Öde” derken değiştir.</p>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : '<div class="btn-row"><button class="btn danger" type="button" id="del">Sil</button></div>'}
      </form>`, (root) => {
      const f = $('#f', root);
      f.name.onchange = () => { const s = SUGGEST_FIXED.find(([n]) => lower(n) === lower(f.name.value)); if (s && !f.emoji.value) f.emoji.value = s[1]; };
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount > 0)) return toast('Geçerli bir tutar gir');
        const data = { name: f.name.value.trim(), emoji: f.emoji.value.trim() || '📌', amount };
        let id;
        if (isNew) { id = uid(); state.plan.fixed.push({ id, ...data }); } else { Object.assign(t, data); id = t.id; }
        syncFuture(new Set([id]));
        save(); closeSheet(); toast('Kaydedildi'); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => {
        if (!confirm(`${t.name} sabit giderlerinden kaldırılsın mı? (Ödenmiş aylar korunur)`)) return;
        state.plan.fixed = state.plan.fixed.filter((y) => y.id !== t.id);
        syncFuture(new Set());
        save(); closeSheet(); toast('Kaldırıldı'); renderView();
      };
    });
  }

  // Yalnızca bu taksiti verilen aydan itibaren mevcut aylara uygular; diğer plan kalemlerine dokunmaz.
  // Ödenmiş (harcaması olan) taksit satırları hiçbir zaman silinmez.
  function syncInstallment(id, fromKey) {
    const inst = state.installments.find((i) => i.id === id);
    monthKeys().filter((k) => k >= fromKey).forEach((k) => {
      const m = state.months[k];
      const c = m.categories.find((x) => x.instId === id);
      const paid = c && m.expenses.some((e) => e.catId === c.id);
      if (inst && instActive(inst, k)) {
        const f = { kind: 'taksit', name: inst.name, emoji: inst.emoji || '🧾', planned: inst.monthly, seq: monthDiff(inst.start, k) + 1, count: inst.count, subs: [] };
        if (!c) m.categories.push({ id: uid(), instId: id, ...f }); else Object.assign(c, f);
      } else if (c && !paid) m.categories = m.categories.filter((x) => x !== c);
    });
  }

  function installmentForm(inst) {
    const isNew = !inst;
    const view0 = curMonthKey(); // ekranda bakılan ay (ör. Aralık)
    const x = inst || { name: '', emoji: '🧾', monthly: '', count: 3, start: view0 };
    const from0 = inst ? inst.from || (view0 > inst.start ? view0 : inst.start) : view0;
    const curSeq = inst ? clamp(monthDiff(inst.start, from0) + 1, 1, inst.count) : 1;
    openSheet(isNew ? 'Taksit ekle' : 'Taksiti düzenle', `
      <form id="f">
        <div class="row2" style="grid-template-columns:80px 1fr">
          <div class="field"><label>Simge</label><input class="input" name="emoji" value="${esc(x.emoji || '')}" maxlength="4" style="text-align:center"></div>
          <div class="field"><label>Ne aldın?</label><input class="input" name="name" value="${esc(x.name)}" placeholder="ör. Telefon, Zara, Buzdolabı" required></div>
        </div>
        <div class="seg" id="tmode"><button type="button" data-t="monthly" class="on">Aylık tutar</button><button type="button" data-t="total">Toplam tutar</button></div>
        <div class="field"><label id="amt-l">Aylık taksit tutarı</label><input class="input big" name="amount" inputmode="decimal" value="${amtStr(x.monthly)}" placeholder="₺0" required></div>
        <div class="field"><label>Hangi aydan itibaren eklensin?</label><input class="input" type="month" name="from" value="${from0}" required>
          <div class="hint">Bu aydan önceki aylara eklenmez.</div></div>
        <div class="row2">
          <div class="field"><label>Toplam taksit sayısı</label><input class="input" name="count" inputmode="numeric" value="${x.count}" required></div>
          <div class="field"><label id="seq-l">O ay kaçıncı taksit?</label><input class="input" name="seq" inputmode="numeric" value="${curSeq}"></div>
        </div>
        <div class="hint" id="calc" style="margin:-4px 0 12px"></div>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : '<div class="btn-row"><button class="btn danger" type="button" id="del">Taksiti sil</button></div>'}
      </form>`, (root) => {
      const f = $('#f', root);
      let mode = 'monthly';
      const vals = () => {
        const n = Math.max(1, parseInt(f.count.value, 10) || 1);
        const seq = clamp(parseInt(f.seq.value, 10) || 1, 1, n);
        const a = parseAmount(f.amount.value) || 0;
        const monthly = mode === 'monthly' ? a : Math.round((a / n) * 100) / 100;
        const from = /^\d{4}-\d{2}$/.test(f.from.value) ? f.from.value : view0;
        return { n, seq, monthly, from, start: addMonth(from, -(seq - 1)) };
      };
      const upd = () => {
        const v = vals();
        $('#seq-l', root).textContent = `${monthName(v.from)} kaçıncı taksit?`;
        const last = addMonth(v.start, v.n - 1), leftN = v.n - v.seq + 1;
        $('#calc', root).innerHTML = v.monthly > 0 ? `Ayda <b>${money2(v.monthly)}</b> · <b>${monthName(v.from, true)} → ${monthName(last, true)}</b> arası ${leftN} ay eklenecek (${money(v.monthly * leftN)}). ${monthName(addMonth(v.from, -1))} ve öncesine dokunulmaz.` : '';
      };
      $$('#tmode button', root).forEach((b) => (b.onclick = () => {
        mode = b.dataset.t; $$('#tmode button', root).forEach((y) => y.classList.toggle('on', y === b));
        $('#amt-l', root).textContent = mode === 'monthly' ? 'Aylık taksit tutarı' : 'Toplam tutar'; upd();
      }));
      f.amount.oninput = upd; f.count.oninput = upd; f.seq.oninput = upd; f.from.onchange = upd; upd();
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const v = vals();
        if (!(v.monthly > 0)) return toast('Geçerli bir tutar gir');
        const data = { name: f.name.value.trim(), emoji: f.emoji.value.trim() || '🧾', monthly: v.monthly, count: v.n, start: v.start, from: v.from };
        // Düzenlemede eski başlangıç ayı daha erkense, oradaki ödenmemiş satırlar da temizlenir
        const syncFrom = inst && instFrom(inst) < v.from ? instFrom(inst) : v.from;
        let id;
        if (isNew) { id = uid(); state.installments.push({ id, ...data }); } else { Object.assign(inst, data); id = inst.id; }
        if (!state.months[v.from] && state.plan) buildMonth(v.from);
        syncInstallment(id, syncFrom);
        save(); closeSheet(); toast(`${data.name}: ${monthName(v.from, true)} itibarıyla ${v.n - v.seq + 1} × ${money(data.monthly)}`); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => {
        if (!confirm(`${inst.name} taksiti silinsin mi? (Ödenmiş aylar korunur)`)) return;
        state.installments = state.installments.filter((y) => y.id !== inst.id);
        syncInstallment(inst.id, '0000-00');
        save(); closeSheet(); toast('Silindi'); renderView();
      };
    });
  }

  // ---------- Plan sihirbazı ----------
  // Sıra: gelir → sabit ödemeler (fatura, kredi kartı, kira, taksit) → birikim → kalanla ne yapacağın (kategori + alt bütçe) → özet
  const WSTEPS = ['Gelirlerin', 'Sabit ödemelerin', 'Birikim planın', 'Harcama bütçen', 'Özet'];
  const SUB_WEIGHTS = { 'Kıyafet': 35, 'Kozmetik': 20, 'Ev ihtiyaçları': 25, 'İstediğim bir şey': 20, 'BİM / A101 / Şok': 70, 'Gross / toptan': 30 };
  const newCat = (s) => ({ id: uid(), name: s.name, emoji: s.emoji, planned: 0, subs: (s.subs || []).map((n) => ({ id: uid(), name: n, planned: 0 })), toSavings: !!s.toSavings });
  // Kategori bütçesini alt başlıklara önerilen oranlarla böler (toplam = kategori limiti)
  function splitSubs(c) {
    if (!c.subs || !c.subs.length) return;
    const ws = c.subs.map((s) => SUB_WEIGHTS[s.name] || 1);
    const tot = sum(ws, (x) => x);
    let acc = 0;
    c.subs.forEach((s, i) => { s.planned = i === c.subs.length - 1 ? Math.max(0, c.planned - acc) : round50((c.planned * ws[i]) / tot); acc += s.planned; });
  }
  function subSumText(c) {
    if (!c.subs || !c.subs.length) return '';
    const s = sum(c.subs, 'planned'), d = (+c.planned || 0) - s;
    if (d < 0) return `<span class="bad">⚠︎ Alt bütçeler ${money(s)} — ${esc(c.name)} limitini ${money(-d)} aşıyor</span>`;
    return `Alt bütçeler ${money(s)} / ${money(c.planned)}${d > 0 ? ` · <span class="good">${money(d)} serbest</span>` : ' · tam dağıtıldı'}`;
  }
  function applySuggestion(w, withSaving) {
    const p = w.plan;
    if (withSaving) {
      const t = wTotals(w);
      const sug = suggestPlan(t.income, t.fixed + t.taksit, p.categories).saving;
      p.savingItems = sug > 0 ? [{ id: uid(), type: 'TRY', amount: sug, qty: 0, goalId: null }] : [];
    }
    const t2 = wTotals(w);
    const wsum = sum(p.categories, (c) => weightOf(c.name)) || 1;
    p.categories.forEach((c) => { c.planned = round50((Math.max(0, t2.kalan) * 0.95 * weightOf(c.name)) / wsum); splitSubs(c); });
  }
  function openWizard(mode, step) {
    const useOld = mode === 'edit' && state.plan && !state.plan.empty;
    const base = useOld ? clone(state.plan) : {
      incomes: state.plan && state.plan.incomes.length ? clone(state.plan.incomes) : [{ id: uid(), name: 'Maaş', amount: 0 }],
      fixed: [], savingItems: [], categories: SUGGEST_CATS.filter((s) => s.def).map(newCat),
    };
    if (!base.incomes.length) base.incomes.push({ id: uid(), name: 'Maaş', amount: 0 });
    base.savingItems = base.savingItems || [];
    base.categories.forEach((c) => { c.subs = (c.subs || []).map((s) => ({ ...s, planned: +s.planned || 0 })); });
    const w = { step: step || 0, mode, plan: base, inst: clone(state.installments || []), newInst: [], apply: true, suggested: false };
    drawWizard(w);
  }
  function wTotals(w) {
    const now = monthKeyOf();
    const income = sum(w.plan.incomes, 'amount');
    const fixed = sum(w.plan.fixed, 'amount');
    const taksit = sum(w.inst.filter((i) => instActive(i, now)), 'monthly') + sum(w.newInst, 'monthly');
    const afterFixed = income - fixed - taksit;
    const saving = planSavingTotal(w.plan);
    const kalan = afterFixed - saving;
    const alloc = sum(w.plan.categories, 'planned');
    return { income, fixed, taksit, afterFixed, saving, kalan, alloc, unalloc: kalan - alloc };
  }
  function drawWizard(w) {
    const t = wTotals(w);
    const p = w.plan;
    const now = monthKeyOf();
    const sugNote = w.mode === 'suggested' && w.suggested ? '<div class="banner" style="margin-bottom:12px"><div class="t">✨ <b>Önerilen değerler dolduruldu.</b> Hepsini dilediğin gibi değiştirebilirsin.</div></div>' : '';
    let body = '';
    if (w.step === 0) {
      body = `<p class="muted small" style="margin-top:0">Önce gelirlerin. Maaşın ve varsa ek gelirlerin — bir ay ek gelir olmazsa o ay ana sayfadan silebilirsin.</p>
        ${p.incomes.map((x, idx) => `<div class="wrow"><input class="input" data-f="inc-name" data-id="${x.id}" value="${esc(x.name)}" placeholder="${idx ? 'Ek gelir adı' : 'Maaş'}">
          <input class="input" data-f="inc-amt" data-id="${x.id}" inputmode="decimal" value="${amtStr(x.amount)}" placeholder="₺0">
          <button type="button" class="x" data-del="inc" data-id="${x.id}" aria-label="Sil">✕</button></div>`).join('')}
        <button type="button" class="link-btn" data-add="inc">+ Ek gelir ekle</button>
        <div class="wbox" style="margin-top:12px">Toplam gelir<div class="big" id="w-a">${money(t.income)}</div></div>`;
    } else if (w.step === 1) {
      const curInst = w.inst.filter((i) => instActive(i, now) || instFrom(i) > now);
      body = `<p class="muted small" style="margin-top:0">Her ay ödemek zorunda olduğun sabit giderler: fatura, kira, kredi kartı, abonelik, kurs… ve taksitlerin. Tutarlarını yaz.</p>
        <div class="chips">${SUGGEST_FIXED.filter(([n]) => !p.fixed.some((f) => lower(f.name) === lower(n))).map(([n, e]) => `<button type="button" data-addfix="${n}" data-e="${e}">${e} ${n}</button>`).join('')}</div>
        ${p.fixed.map((x) => `<div class="wrow emoji"><input class="input" data-f="fix-emoji" data-id="${x.id}" value="${esc(x.emoji || '')}" style="text-align:center">
          <input class="input" data-f="fix-name" data-id="${x.id}" value="${esc(x.name)}" placeholder="Ad">
          <input class="input" data-f="fix-amt" data-id="${x.id}" inputmode="decimal" value="${amtStr(x.amount)}" placeholder="₺0">
          <button type="button" class="x" data-del="fix" data-id="${x.id}">✕</button></div>`).join('')}
        <button type="button" class="link-btn" data-add="fix">+ Başka sabit gider ekle</button>
        <div class="section-title">Taksitlerin</div>
        ${curInst.map((i) => `<div class="wrow" style="grid-template-columns:1fr 36px"><div class="small"><b>${esc(i.name)}</b> · ayda ${money(i.monthly)} · ${clamp(monthDiff(i.start, now) + 1, 0, i.count)}/${i.count}</div><button type="button" class="x" data-del="inst" data-id="${i.id}">✕</button></div>`).join('')}
        ${w.newInst.length ? '<div class="small muted" style="margin-bottom:6px">Ne aldın · aylık tutar · kalan taksit sayısı</div>' : ''}
        ${w.newInst.map((i) => `<div class="wrow three"><input class="input" data-f="ni-name" data-id="${i.id}" value="${esc(i.name)}" placeholder="ör. Telefon">
          <input class="input" data-f="ni-amt" data-id="${i.id}" inputmode="decimal" value="${amtStr(i.monthly)}" placeholder="₺/ay">
          <input class="input" data-f="ni-cnt" data-id="${i.id}" inputmode="numeric" value="${i.count || ''}" placeholder="adet">
          <button type="button" class="x" data-del="ninst" data-id="${i.id}">✕</button></div>`).join('')}
        <button type="button" class="link-btn" data-add="ninst">+ Taksit ekle</button>
        <div class="wbox" style="margin-top:12px">Sabit ${money(t.fixed)} + taksit ${money(t.taksit)}<div class="big" id="w-a">${money(t.fixed + t.taksit)}</div><span class="small muted">Gelirden sonra kalan: <b id="w-b">${money(t.afterFixed)}</b></span></div>`;
    } else if (w.step === 2) {
      const sug = suggestPlan(t.income, t.fixed + t.taksit, p.categories).saving;
      const goals = state.savings.goals;
      const quick = [['CEYREK', 1, '🪙 Her ay 1 çeyrek'], ['GRAM', 1, '🟨 Her ay 1 gram'], ['USD', 100, '💵 Her ay 100 $'], ['TRY', 0, '🏦 TL birikim']];
      body = `${sugNote}<p class="muted small" style="margin-top:0">Sabit giderlerden sonra elinde <b>${money(t.afterFixed)}</b> kalıyor. Önce birikimini ayır; ay içinde “Aldım” dediğinde maaşından düşer ve hedefin ilerler.</p>
        <div class="chips">${quick.map(([ty, q, n]) => `<button type="button" data-addsi="${ty}" data-q="${q}">${n}</button>`).join('')}
          <button type="button" data-addsi="TRY" data-q="0" data-amt="${sug}">✨ Önerilen ${money(sug)}</button></div>
        ${p.savingItems.map((i) => `<div class="wcat">
          <div class="wrow" style="grid-template-columns:1fr 104px 36px;margin:0">
            <select class="input" data-f="si-type" data-id="${i.id}">${SAVING_TYPES.map((ty) => `<option value="${ty}" ${ty === i.type ? 'selected' : ''}>${ASSETS[ty].icon} ${ASSETS[ty].name}</option>`).join('')}</select>
            <input class="input" data-f="si-val" data-id="${i.id}" inputmode="decimal" value="${amtStr(i.type === 'TRY' ? i.amount : i.qty)}" placeholder="${i.type === 'TRY' ? '₺/ay' : ASSETS[i.type].unit === 'adet' ? 'adet' : ASSETS[i.type].unit === 'gram' ? 'gram' : 'miktar'}">
            <button type="button" class="x" data-del="si" data-id="${i.id}">✕</button></div>
          <div class="small muted" style="margin-top:6px">Ayda ≈ <b id="est-${i.id}">${money(estItem(i))}</b>${i.type !== 'TRY' ? ' (bugünkü satış fiyatıyla)' : ''}
          ${goals.length ? ` · Hedef: <select class="input" data-f="si-goal" data-id="${i.id}" style="display:inline-block;width:auto;padding:4px 28px 4px 8px;font-size:13px"><option value="">Genel</option>${goals.map((g) => `<option value="${g.id}" ${g.id === i.goalId ? 'selected' : ''}>${esc(g.emoji || '')} ${esc(g.name)}</option>`).join('')}</select>` : ''}</div>
        </div>`).join('') || '<p class="small muted">Şimdilik düzenli birikim yok. Yukarıdan ekleyebilir ya da bu adımı geçebilirsin.</p>'}
        <p class="hint">Önerilen: gelirinin %20'si, ama sabit giderlerden sonra kalanın en fazla %40'ı (${money(sug)}).</p>
        <div class="wbox">Aylık birikim ≈ <b id="w-b2">${money(t.saving)}</b> · sonrasında harcamalara kalan<div class="big ${t.kalan < 0 ? 'bad' : ''}" id="w-a">${money(t.kalan)}</div></div>`;
    } else if (w.step === 3) {
      const custom = p.categories.filter((c) => !SUGGEST_CATS.some((s) => lower(s.name) === lower(c.name)));
      const sp = suggestPlan(t.income, t.fixed + t.taksit, p.categories);
      body = `${sugNote}<div class="wbox">Harcamalarına kalan<div class="big ${t.kalan < 0 ? 'bad' : ''}">${money(t.kalan)}</div><span class="small muted">Gelir ${money(t.income)} − sabit ${money(t.fixed)} − taksit ${money(t.taksit)} − birikim ${money(t.saving)}</span></div>
        <p class="muted small">Kalan parayla ne yapmak istiyorsun? Kategorileri seç ve her birine bütçe yaz. <b>Alt başlık eklersen kategori bütçesi üst limit olur</b> — ör. Kıyafet ₺5.000 → Ayakkabı ₺1.000, Giyim ₺4.000.</p>
        <div class="chips">${SUGGEST_CATS.map((s) => `<button type="button" data-tog="${esc(s.name)}" class="${p.categories.some((c) => lower(c.name) === lower(s.name)) ? 'on' : ''}">${s.emoji} ${esc(s.name)}</button>`).join('')}
          ${custom.map((c) => `<button type="button" class="on" data-tog="${esc(c.name)}">${esc(c.emoji || '•')} ${esc(c.name)}</button>`).join('')}</div>
        <div class="wrow" style="grid-template-columns:1fr auto"><input class="input" id="w-newcat" placeholder="Kendi kategorin (ör. Kıyafet)"><button type="button" class="btn small" data-add="cat">Ekle</button></div>
        ${p.categories.map((c) => `<div class="wcat">
          <div class="wcat-h"><span style="font-size:20px">${esc(c.emoji || '•')}</span><input class="input" data-f="cat-name" data-id="${c.id}" value="${esc(c.name)}">
            <input class="input amt-in" data-f="cat-plan" data-id="${c.id}" inputmode="decimal" value="${amtStr(c.planned)}" placeholder="₺0"><button type="button" class="x" data-del="cat" data-id="${c.id}">✕</button></div>
          ${(c.subs || []).map((s) => `<div class="subrow"><span class="tree">└</span><input class="input" data-f="sub-name" data-cat="${c.id}" data-id="${s.id}" value="${esc(s.name)}">
            <input class="input amt-in" data-f="sub-plan" data-cat="${c.id}" data-id="${s.id}" inputmode="decimal" value="${amtStr(s.planned)}" placeholder="₺0"><button type="button" class="x" data-delsub="${c.id}" data-sid="${s.id}">✕</button></div>`).join('')}
          <div class="subrow"><span class="tree">└</span><input class="input sub-in2" data-addsub="${c.id}" placeholder="+ alt başlık ekle (ör. Ayakkabı)"></div>
          <div class="subsum" id="ss-${c.id}">${subSumText(c)}</div>
          <label class="check slim"><input type="checkbox" data-f="cat-sav" data-id="${c.id}" ${c.toSavings ? 'checked' : ''}> Ay sonunda artarsa birikime aktar</label>
        </div>`).join('') || '<p class="muted small">Henüz kategori seçmedin.</p>'}
        <div class="wbox" style="margin-top:12px"><span id="w-al">${t.unalloc < 0 ? 'Limitler kalanı aşıyor' : 'Boşta kalan (hiçbir kategoriye ayrılmamış)'}</span><div class="big" id="w-a">${money(t.unalloc)}</div><span class="small muted" id="w-ah">${t.unalloc < 0 ? 'Limitlerin toplamı harcamalarına kalan paradan fazla; bazılarını düşür.' : 'Ay sonunda harcanmazsa birikime aktarabilirsin.'}</span></div>
        <button type="button" class="btn secondary" data-act="suggest">✨ Önerilen dağılımı uygula</button>
        <details style="margin-top:10px"><summary class="small muted">Önerilen dağılım nasıl hesaplanıyor?</summary>
          <p class="small muted">Kalanın %95'i kategorilerin önemine göre bölünür, %5'i (${money(Math.max(0, t.kalan) * 0.05)}) beklenmedik giderler için serbest kalır. Alt başlıklar kategori bütçesinin içinden bölünür.</p>
          <ul class="list small">${p.categories.map((c) => `<li><div class="main"><div class="title">${esc(c.emoji || '')} ${esc(c.name)}</div><div class="sub">${esc(whyOf(c.name))}</div></div><div class="amt">${money(round50((Math.max(0, t.kalan) * 0.95 * weightOf(c.name)) / (sum(p.categories, (x) => weightOf(x.name)) || 1)))}</div></li>`).join('')}</ul></details>`;
      void sp;
    } else {
      const bad = p.categories.filter((c) => (c.subs || []).length && sum(c.subs, 'planned') > c.planned);
      body = `<ul class="wf">
          <li><span class="k">Toplam gelir</span><span class="v">${money(t.income)}</span></li>
          <li class="minus"><span class="k">− Sabit giderler (${p.fixed.length})</span><span class="v">${money(t.fixed)}</span></li>
          <li class="minus"><span class="k">− Taksitler</span><span class="v">${money(t.taksit)}</span></li>
          <li class="minus"><span class="k">− Birikim${p.savingItems.length ? ` <span class="muted tiny">(${p.savingItems.map((i) => esc(itemLabel(i))).join(', ')})</span>` : ''}</span><span class="v">${money(t.saving)}</span></li>
          <li class="total"><span class="k">= Harcamalarına kalan</span><span class="v ${t.kalan < 0 ? 'bad' : ''}">${money(t.kalan)}</span></li>
          ${p.categories.map((c) => `<li class="sub"><span class="k">${esc(c.emoji || '')} ${esc(c.name)}</span><span class="v">${money(c.planned)}</span></li>
            ${(c.subs || []).map((s) => `<li class="sub" style="padding-left:18px"><span class="k muted">└ ${esc(s.name)}</span><span class="v muted">${money(s.planned)}</span></li>`).join('')}`).join('')}
          <li class="sub"><span class="k">${t.unalloc < 0 ? "Limitler kalanı aşıyor" : "Boşta kalan"}</span><span class="v ${t.unalloc < 0 ? "bad" : "good"}">${money(Math.abs(t.unalloc))}</span></li>
        </ul>
        ${t.unalloc < 0 ? `<p class="small bad">⚠︎ Kategori limitlerinin toplamı (${money(t.alloc)}) harcamalarına kalan paradan (${money(t.kalan)}) ${money(-t.unalloc)} fazla. Bütün limitleri kullanırsan paran yetmez; bazılarını düşür.</p>` : ''}
        ${bad.map((c) => `<p class="small bad">⚠︎ ${esc(c.name)}: alt bütçeler limiti aşıyor.</p>`).join('')}
        <label class="check" style="margin-top:12px"><input type="checkbox" id="w-apply" ${w.apply ? 'checked' : ''}> Bu aya da uygula (${monthName(now)}) — harcamaların korunur</label>
        <p class="hint">Plan her yeni ayda otomatik kullanılır. Değiştirmediğin sürece aynı planla devam edersin; değiştirirsen yeni planla ilerlersin. Ayarlar → Planım.</p>`;
    }
    const html = `<div class="wstep">Adım ${w.step + 1} / ${WSTEPS.length}</div>
      <div class="wdots">${WSTEPS.map((_, i) => `<i class="${i <= w.step ? 'on' : ''}"></i>`).join('')}</div>
      ${body}
      <div class="wnav">${w.step > 0 ? '<button type="button" class="btn secondary" data-nav="-1">Geri</button>' : ''}<button type="button" class="btn" data-nav="1">${w.step === WSTEPS.length - 1 ? 'Planı kaydet' : 'İleri'}</button></div>`;
    openSheet(WSTEPS[w.step], html, (root) => bindWizard(w, root));
  }
  function bindWizard(w, root) {
    const p = w.plan;
    const find = (arr, id) => arr.find((x) => x.id === id);
    const live = () => {
      const t = wTotals(w), a = $('#w-a', root), b = $('#w-b', root);
      if (a) {
        const val = w.step === 0 ? t.income : w.step === 1 ? t.fixed + t.taksit : w.step === 2 ? t.kalan : t.unalloc;
        a.textContent = money(val); a.classList.toggle('bad', val < 0);
      }
      if (b) b.textContent = money(t.afterFixed);
      const b2 = $('#w-b2', root); if (b2) b2.textContent = money(t.saving);
      if (w.step === 2) p.savingItems.forEach((i) => { const e = $(`#est-${i.id}`, root); if (e) e.textContent = money(estItem(i)); });
      if (w.step === 3) {
        p.categories.forEach((c) => { const e = $(`#ss-${c.id}`, root); if (e) e.innerHTML = subSumText(c); });
        const al = $('#w-al', root), ah = $('#w-ah', root);
        if (al) al.textContent = t.unalloc < 0 ? 'Limitler kalanı aşıyor' : 'Boşta kalan (hiçbir kategoriye ayrılmamış)';
        if (ah) ah.textContent = t.unalloc < 0 ? 'Limitlerin toplamı harcamalarına kalan paradan fazla; bazılarını düşür.' : 'Ay sonunda harcanmazsa birikime aktarabilirsin.';
      }
    };
    $$('[data-f]', root).forEach((el) => {
      if (el.dataset.f === 'si-type') { el.onchange = () => { const i = find(p.savingItems, el.dataset.id); i.type = el.value; if (i.type !== 'TRY') i.qty = i.qty || 1; drawWizard(w); }; return; }
      if (el.dataset.f === 'si-goal') { el.onchange = () => { find(p.savingItems, el.dataset.id).goalId = el.value || null; }; return; }
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const id = el.dataset.id, v = el.value;
        const sub = () => find(find(p.categories, el.dataset.cat).subs, id);
        switch (el.dataset.f) {
          case 'inc-name': find(p.incomes, id).name = v; break;
          case 'inc-amt': find(p.incomes, id).amount = amt0(v); break;
          case 'cat-name': find(p.categories, id).name = v; break;
          case 'cat-sav': find(p.categories, id).toSavings = el.checked; break;
          case 'cat-plan': find(p.categories, id).planned = amt0(v); break;
          case 'sub-name': sub().name = v; break;
          case 'sub-plan': sub().planned = amt0(v); break;
          case 'fix-emoji': find(p.fixed, id).emoji = v; break;
          case 'fix-name': find(p.fixed, id).name = v; break;
          case 'fix-amt': find(p.fixed, id).amount = amt0(v); break;
          case 'ni-name': find(w.newInst, id).name = v; break;
          case 'ni-amt': find(w.newInst, id).monthly = amt0(v); break;
          case 'ni-cnt': find(w.newInst, id).count = parseInt(v, 10) || 0; break;
          case 'si-val': { const i = find(p.savingItems, id); if (i.type === 'TRY') i.amount = amt0(v); else i.qty = amt0(v); break; }
        }
        live();
      });
    });
    $$('[data-add]', root).forEach((b) => (b.onclick = () => {
      const k = b.dataset.add;
      if (k === 'inc') p.incomes.push({ id: uid(), name: '', amount: 0 });
      if (k === 'fix') p.fixed.push({ id: uid(), name: '', emoji: '📌', amount: 0 });
      if (k === 'ninst') w.newInst.push({ id: uid(), name: '', monthly: 0, count: 0 });
      if (k === 'cat') {
        const n = $('#w-newcat', root).value.trim();
        if (!n) return toast('Kategori adını yaz');
        if (!p.categories.some((c) => lower(c.name) === lower(n))) p.categories.push({ id: uid(), name: n, emoji: '•', planned: 0, subs: [], toSavings: false });
      }
      drawWizard(w);
    }));
    $$('[data-del]', root).forEach((b) => (b.onclick = () => {
      const id = b.dataset.id, k = b.dataset.del;
      if (k === 'inc') p.incomes = p.incomes.filter((x) => x.id !== id);
      if (k === 'fix') p.fixed = p.fixed.filter((x) => x.id !== id);
      if (k === 'cat') p.categories = p.categories.filter((x) => x.id !== id);
      if (k === 'inst') w.inst = w.inst.filter((x) => x.id !== id);
      if (k === 'ninst') w.newInst = w.newInst.filter((x) => x.id !== id);
      if (k === 'si') p.savingItems = p.savingItems.filter((x) => x.id !== id);
      drawWizard(w);
    }));
    $$('[data-addsi]', root).forEach((b) => (b.onclick = () => {
      const type = b.dataset.addsi, q = +b.dataset.q || 0, a = +b.dataset.amt || 0;
      const goal = state.savings.goals.length === 1 ? state.savings.goals[0].id : null;
      p.savingItems.push({ id: uid(), type, qty: type === 'TRY' ? 0 : q, amount: type === 'TRY' ? a : 0, goalId: goal });
      drawWizard(w);
    }));
    $$('[data-tog]', root).forEach((b) => (b.onclick = () => {
      const n = b.dataset.tog;
      const ex = p.categories.find((c) => lower(c.name) === lower(n));
      if (ex) p.categories = p.categories.filter((c) => c !== ex);
      else p.categories.push(newCat(SUGGEST_CATS.find((x) => x.name === n)));
      drawWizard(w);
    }));
    $$('[data-addsub]', root).forEach((inp) => {
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } });
      inp.onchange = () => {
        const n = inp.value.trim(); if (!n) return;
        const c = find(p.categories, inp.dataset.addsub); c.subs = c.subs || [];
        const free = Math.max(0, (+c.planned || 0) - sum(c.subs, 'planned'));
        c.subs.push({ id: uid(), name: n, planned: 0 });
        drawWizard(w);
      };
    });
    $$('[data-delsub]', root).forEach((b) => (b.onclick = () => { const c = find(p.categories, b.dataset.delsub); c.subs = c.subs.filter((s) => s.id !== b.dataset.sid); drawWizard(w); }));
    $$('[data-addfix]', root).forEach((b) => (b.onclick = () => { p.fixed.push({ id: uid(), name: b.dataset.addfix, emoji: b.dataset.e, amount: 0 }); drawWizard(w); setTimeout(() => { const ins = $$('[data-f="fix-amt"]'); ins.length && ins[ins.length - 1].focus(); }, 60); }));
    const sg = $('[data-act="suggest"]', root);
    if (sg) sg.onclick = () => { applySuggestion(w, false); drawWizard(w); toast('Önerilen dağılım uygulandı — istediğini değiştir'); };
    const ap = $('#w-apply', root); if (ap) ap.onchange = () => (w.apply = ap.checked);
    $$('[data-nav]', root).forEach((b) => (b.onclick = () => {
      const d = +b.dataset.nav;
      if (d > 0 && w.step === 0 && !(sum(p.incomes, 'amount') > 0)) return toast('Gelirini gir');
      if (d > 0 && w.step === 3) {
        const bad = p.categories.find((c) => (c.subs || []).length && sum(c.subs, 'planned') > c.planned);
        if (bad) return toast(`${bad.name}: alt bütçelerin toplamı kategori limitini aşamaz`);
      }
      if (d > 0 && w.step === WSTEPS.length - 1) return saveWizard(w);
      w.step = clamp(w.step + d, 0, WSTEPS.length - 1);
      if (w.mode === 'suggested' && !w.suggested && w.step === 2) { applySuggestion(w, true); w.suggested = true; }
      drawWizard(w);
    }));
  }
  function saveWizard(w) {
    const now = monthKeyOf();
    w.newInst.filter((x) => x.name && x.monthly > 0 && x.count > 0).forEach((x) => w.inst.push({ id: uid(), name: x.name.trim(), emoji: '🧾', monthly: x.monthly, count: x.count, start: now, from: now }));
    const p = w.plan;
    p.incomes = p.incomes.filter((i) => i.name.trim() && i.amount > 0).map((i) => ({ ...i, name: i.name.trim() }));
    p.fixed = p.fixed.filter((f) => f.name.trim() && f.amount > 0).map((f) => ({ ...f, name: f.name.trim() }));
    p.categories = p.categories.filter((c) => c.name.trim()).map((c) => ({ ...c, name: c.name.trim(), subs: (c.subs || []).filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim() })) }));
    p.savingItems = (p.savingItems || []).filter((i) => (i.type === 'TRY' ? i.amount > 0 : i.qty > 0)).map((i) => {
      const r = rateOf(i.type);
      return { ...i, lastPrice: r ? r.sell : i.lastPrice };
    });
    delete p.saving; delete p.empty;
    p.reviewed = true;
    state.plan = p;
    state.installments = w.inst;
    if (w.apply) {
      if (!state.months[now]) buildMonth(now);
      else { state.months[now].skip = []; delete state.months[now].detached; }
      state.ui.month = now;
    }
    monthKeys().filter((k) => (w.apply ? k >= now : k > now)).forEach((k) => syncMonth(k, null));
    save(); closeSheet(); toast('Planın kaydedildi'); location.hash = '#/ozet'; renderView();
  }

  function suggestionSheet() {
    const p = state.plan;
    if (!p) return openWizard('first');
    const income = sum(p.incomes, 'amount'), fixed = sum(p.fixed, 'amount');
    const taksit = sum(state.installments.filter((i) => instActive(i, monthKeyOf())), 'monthly');
    const sp = suggestPlan(income, fixed + taksit, p.categories);
    openSheet('Önerilen plan', `
      <p class="muted small" style="margin-top:0">Gelirine ve sabit giderlerine göre hesaplandı. Mevcut planınla yan yana:</p>
      <div class="table-wrap"><table class="t" style="min-width:0">
        <thead><tr><th>Kalem</th><th>Senin planın</th><th>Önerilen</th></tr></thead>
        <tbody>
          <tr><td>Gelir</td><td>${money(income)}</td><td>${money(income)}</td></tr>
          <tr><td>Sabit + taksit</td><td>${money(fixed + taksit)}</td><td>${money(fixed + taksit)}</td></tr>
          <tr><td><b>Birikim</b></td><td>${money(planSavingTotal(p))}</td><td><b>${money(sp.saving)}</b></td></tr>
          ${p.categories.map((c) => `<tr><td>${esc(c.emoji || '')} ${esc(c.name)}</td><td>${money(c.planned)}</td><td>${money(sp.alloc[c.id])}</td></tr>`).join('')}
          <tr><td>Serbest / beklenmedik</td><td>${money(income - fixed - taksit - planSavingTotal(p) - sum(p.categories, 'planned'))}</td><td>${money(sp.buffer)}</td></tr>
        </tbody></table></div>
      <ul class="list small" style="margin-top:10px">
        <li><div class="main"><div class="title">Birikim</div><div class="sub">Gelirin %20'si; sabitlerden sonra kalanın en fazla %40'ı (${money(sp.afterFixed)} × %40).</div></div></li>
        ${p.categories.map((c) => `<li><div class="main"><div class="title">${esc(c.name)}</div><div class="sub">${esc(whyOf(c.name))}</div></div></li>`).join('')}
        <li><div class="main"><div class="title">Serbest pay</div><div class="sub">Kalanın %5'i beklenmedik giderler için boşta bırakılır.</div></div></li>
      </ul>
      <button class="btn" id="apply-sug" style="margin-top:12px">Önerilen tutarları planıma uygula</button>
      <p class="hint">Uyguladıktan sonra Planım'dan istediğin tutarı değiştirebilirsin. Bu ay ve sonraki aylar güncellenir.</p>`, (root) => {
      $('#apply-sug', root).onclick = () => {
        if (!confirm('Birikim ve kategori tutarları önerilen değerlerle değişsin mi?')) return;
        // Altın/döviz kalemleri korunur; önerilen tutara kadar olan farkı TL birikim kalemi tamamlar
        p.savingItems = p.savingItems || [];
        const nonTL = sum(p.savingItems.filter((i) => i.type !== 'TRY'), estItem);
        const tl = p.savingItems.find((i) => i.type === 'TRY');
        const need = round50(Math.max(0, sp.saving - nonTL));
        if (tl) tl.amount = need; else if (need > 0) p.savingItems.push({ id: uid(), type: 'TRY', amount: need, qty: 0, goalId: null });
        p.savingItems = p.savingItems.filter((i) => (i.type === 'TRY' ? i.amount > 0 : true));
        p.categories.forEach((c) => (c.planned = sp.alloc[c.id]));
        p.reviewed = true;
        syncFuture(new Set([...p.savingItems.map((i) => i.id), ...p.categories.map((c) => c.id)]));
        save(); closeSheet(); toast('Önerilen plan uygulandı'); renderView();
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
    const totals = { income: sum(rows, 'income'), planned: sum(rows, 'planned'), spent: sum(rows, 'spent'), saved: sum(rows, 'savingDone') };
    const byName = {};
    rows.forEach((r) => r.cats.filter((c) => c.kind !== 'taksit').forEach((c) => {
      const k = lower(c.name);
      const o = (byName[k] = byName[k] || { name: c.name, emoji: c.emoji, planned: 0, spent: 0, over: 0, months: 0 });
      o.planned += c.planned; o.spent += c.spent; o.months++; if (c.spent > c.planned) o.over++;
    }));
    const catRows = Object.values(byName).sort((a, b) => (b.spent - b.planned) - (a.spent - a.planned));
    view.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Planlanan ve harcanan</h3><span class="muted tiny">Son ${last.length} ay</span></div>
        <div class="legend"><span><i style="background:var(--plan)"></i>Planlanan</span><span><i style="background:var(--spent)"></i>Harcanan</span><span><i style="background:var(--good);border-radius:50%"></i>Gelir</span></div>
        ${barChart(last)}
      </div>
      <div class="card">
        <div class="card-head"><h3>Finansal başarı</h3>${avgScore != null ? `<span class="chip ${scoreLabel(avgScore)[1]}">Ortalama ${avgScore}</span>` : ''}</div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Ay</th><th>Gelir</th><th>Planlanan</th><th>Harcanan</th><th>Plana göre</th><th>Birikime</th><th>Kalan</th><th>Tasarruf</th><th>Başarı</th></tr></thead>
          <tbody>${rows.slice().reverse().map((r) => `<tr class="${r.phase === 'current' ? 'cur' : ''}">
            <td>${monthName(r.key, true)}${r.phase === 'current' ? ' •' : r.phase === 'future' ? ' ◦' : ''}</td>
            <td>${money(r.income)}</td><td>${money(r.planned)}</td><td>${money(r.spent)}</td>
            <td class="${r.vsPlan < 0 ? 'bad' : 'good'}">${signed(r.vsPlan)}</td>
            <td>${money(r.savingDone)}</td>
            <td class="${r.cash < 0 ? 'bad' : ''}">${money(r.cash)}</td>
            <td>${pct(r.savingRate)}</td>
            <td><span class="chip ${scoreLabel(r.score)[1]}">${r.score}</span></td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Toplam</td><td>${money(totals.income)}</td><td>${money(totals.planned)}</td><td>${money(totals.spent)}</td>
            <td class="${totals.planned - totals.spent < 0 ? 'bad' : 'good'}">${signed(totals.planned - totals.spent)}</td>
            <td>${money(totals.saved)}</td><td>${money(totals.income - totals.spent - totals.saved)}</td><td>${totals.income ? pct(((totals.income - totals.spent) / totals.income) * 100) : '—'}</td><td></td></tr></tfoot>
        </table></div>
        <p class="hint">• devam eden ay, ◦ gelecek ay. Başarı puanı: %50 bütçe içinde kalan kalem oranı + %50 planlanan birikime ulaşma; ekstra harcama kadar puan düşer.</p>
      </div>
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
    const transfers = monthKeys().map((k) => ({ k, t: (state.months[k].saving && state.months[k].saving.done) || 0 })).filter((x) => x.t > 0);
    view.innerHTML = `
      <div class="card hero">
        <div class="hero-label">Toplam birikim (bugünkü değer)</div>
        <div class="hero-num">${money(P.value)}</div>
        <div class="hero-sub">Maliyet ${money(P.cost)} · <b class="${P.pl < 0 ? 'bad' : 'good'}">${signed(P.pl)} (${pct(P.plPct)})</b></div>
        ${r && r.data.USD ? `<div class="hero-sub" style="margin-top:4px">≈ $${nf0.format(P.value / r.data.USD.buy)} · ≈ ${num(P.value / (r.data.GRA?.buy || 1))} gr altın</div>` : ''}
      </div>
      <div class="section-title">Hedeflerim</div>
      ${goals.map((g) => {
        const F = goalForecast(g, P);
        const kind = GOAL_KINDS[g.kind] || GOAL_KINDS.other;
        return `<div class="card">
          <div class="card-head"><h3>${esc(g.emoji || kind[0])} ${esc(g.name)}</h3><button class="link-btn" data-goal="${g.id}">Düzenle</button></div>
          <div class="cat-bottom" style="margin:0 0 4px"><span class="muted small">${g.kind === 'debt' ? 'Borç' : 'Hedef'} ${money(g.target)}</span><span class="muted small">${g.mode === 'linked' ? 'Bu hedefe bağlı birikimler' : g.mode === 'manual' ? 'Elle girilen tutar' : 'Tüm birikimin'}</span></div>
          ${goalTrack(g, F)}
          ${goalText(g, F)}
        </div>`;
      }).join('') || '<div class="card empty small">Araba, ev, borç bitirme gibi bir hedef ekle; ilerlemeni yol haritasında gör.</div>'}
      <button class="btn secondary" id="add-goal">+ Hedef ekle</button>

      <div class="section-title">Düzenli birikim — planlanan / gerçekleşen</div>
      <div class="card">
        ${state.plan && (state.plan.savingItems || []).length ? `<ul class="list">${state.plan.savingItems.map((i) => `<li><div class="main"><div class="title">${(ASSETS[i.type] || {}).icon || ''} Her ay ${esc(itemLabel(i))}</div><div class="sub">≈ ${money(estItem(i))} / ay${i.goalId ? ' · ' + esc((goals.find((g) => g.id === i.goalId) || {}).name || '') : ''}</div></div></li>`).join('')}</ul>`
          : '<p class="small muted" style="margin:0">Henüz düzenli birikim planın yok.</p>'}
        ${(() => {
          const ks = monthKeys().filter((k) => k <= monthKeyOf()).slice(-6).reverse();
          const rows = ks.map((k) => { const mm = state.months[k]; const all = mm.saving.items || []; const it = all.filter((i) => !i.skipped); return { k, it, plan: sum(it, (i) => (i.done ? i.doneAmount : estItem(i))), done: sum(it.filter((i) => i.done), 'doneAmount'), n: it.length, nd: it.filter((i) => i.done).length, sk: all.length - it.length }; }).filter((x) => x.n || x.sk);
          if (!rows.length) return '';
          return `<div class="table-wrap" style="margin-top:10px"><table class="t" style="min-width:0">
            <thead><tr><th>Ay</th><th>Planlanan</th><th>Gerçekleşen</th><th>Durum</th></tr></thead>
            <tbody>${rows.map((x) => `<tr><td>${monthName(x.k, true)}</td><td>${money(x.plan)}</td><td>${money(x.done)}</td>
              <td>${!x.n ? '<span class="chip neutral">⏭ Atlandı</span>' : x.nd === x.n ? `<span class="chip good">✓ Tamam${x.sk ? ' · ⏭' + x.sk : ''}</span>` : x.k < monthKeyOf() ? `<span class="chip bad">✗ ${x.n - x.nd} alınmadı</span>` : `<span class="chip warn">○ Bekliyor</span>`}</td></tr>`).join('')}</tbody></table></div>`;
        })()}
        <button class="btn secondary" id="edit-si" style="margin-top:12px">Düzenli birikim planını değiştir</button>
      </div>
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
        <p class="hint">Kaynak öncelikle Harem Altın; ulaşılamazsa Kapalıçarşı verisi. Değerleme bozdurma (alış) fiyatıyla yapılır. Sayfa açıkken kurlar her dakika yenilenir. Bir kura dokunup manuel fiyat girebilirsin.</p>
      </div>`;
    $('#add-h').onclick = () => holdingForm();
    $$('[data-h]', view).forEach((li) => (li.onclick = () => holdingForm(state.savings.holdings.find((h) => h.id === li.dataset.h))));
    $('#add-goal').onclick = () => goalForm();
    $$('[data-goal]', view).forEach((c) => (c.onclick = () => goalForm(goals.find((g) => g.id === c.dataset.goal))));
    $('#edit-si').onclick = () => openWizard(state.plan ? 'edit' : 'first', 2);
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
        ${state.savings.goals.length ? `<div class="field"><label>Hangi hedef için?</label><select class="input" name="goal"><option value="">— Genel birikim —</option>${state.savings.goals.map((g) => `<option value="${g.id}" ${g.id === x.goalId ? 'selected' : ''}>${esc(g.emoji || '')} ${esc(g.name)}</option>`).join('')}</select></div>` : ''}
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : '<div class="btn-row"><button class="btn danger" type="button" id="del">Sil / Sattım</button></div>'}
      </form>`, (root) => {
      const f = $('#f', root);
      const upd = () => {
        const a = ASSETS[f.type.value];
        $('#qty-l', root).textContent = a.unit === 'adet' ? 'Adet' : a.unit === 'gram' ? 'Gram' : `Miktar (${a.unit})`;
        if (f.type.value === 'TRY') { f.buyPrice.value = '1'; f.buyPrice.readOnly = true; $('#now-p', root).textContent = ''; return; }
        f.buyPrice.readOnly = false;
        const r = rateOf(f.type.value);
        $('#now-p', root).innerHTML = r ? `Şu an satış ${money2(r.sell)} · bozdurma ${money2(r.buy)} <button type="button" class="link-btn" id="use-p">Satış fiyatını yaz</button>` : 'Güncel fiyat yok';
        const u = $('#use-p', root); if (u) u.onclick = () => { f.buyPrice.value = amtStr(Math.round(r.sell * 100) / 100); };
      };
      f.type.onchange = upd; upd();
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const qty = parseAmount(f.qty.value), buyPrice = parseAmount(f.buyPrice.value);
        if (!(qty > 0) || !(buyPrice > 0)) return toast('Miktar ve fiyatı kontrol et');
        const data = { type: f.type.value, qty, buyPrice, date: f.date.value, note: f.note.value.trim(), goalId: f.goal ? f.goal.value || null : x.goalId || null };
        if (isNew) state.savings.holdings.push({ id: uid(), ...data }); else Object.assign(h, data);
        save(); closeSheet(); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => { if (confirm('Bu varlık silinsin mi?')) { state.savings.holdings = state.savings.holdings.filter((y) => y.id !== h.id); save(); closeSheet(); renderView(); } };
    });
  }

  function goalForm(g) {
    const isNew = !g;
    const x = g || { name: '', emoji: '', kind: 'car', target: '', deadline: '', mode: 'all', manual: 0 };
    openSheet(isNew ? 'Hedef ekle' : 'Hedefi düzenle', `
      <form id="f">
        <div class="field"><label>Ne için biriktiriyorsun?</label>
          <div class="chips" id="kinds">${Object.entries(GOAL_KINDS).map(([k, [ic, n]]) => `<button type="button" data-k="${k}" class="${(x.kind || 'other') === k ? 'on' : ''}">${ic} ${n}</button>`).join('')}</div></div>
        <div class="row2" style="grid-template-columns:80px 1fr">
          <div class="field"><label>Simge</label><input class="input" name="emoji" value="${esc(x.emoji || GOAL_KINDS[x.kind || 'other'][0])}" maxlength="4" style="text-align:center"></div>
          <div class="field"><label>Hedef adı</label><input class="input" name="name" value="${esc(x.name)}" placeholder="ör. İlk arabam" required></div>
        </div>
        <div class="row2">
          <div class="field"><label id="tgt-l">${x.kind === 'debt' ? 'Borç tutarı (₺)' : 'Hedef tutar (₺)'}</label><input class="input" name="target" inputmode="decimal" value="${amtStr(x.target)}" required></div>
          <div class="field"><label>Hedef ay</label><input class="input" type="month" name="deadline" value="${x.deadline || ''}"></div>
        </div>
        <div class="field"><label>İlerleme neye göre hesaplansın?</label>
          <select class="input" name="mode">
            <option value="all" ${x.mode === 'all' ? 'selected' : ''}>Tüm birikimimin güncel değeri</option>
            <option value="linked" ${x.mode === 'linked' ? 'selected' : ''}>Sadece bu hedefe bağladığım birikimler</option>
            <option value="manual" ${x.mode === 'manual' ? 'selected' : ''}>Kendi girdiğim tutar</option></select>
          <div class="hint">Birden fazla hedefin varsa “bağladığım birikimler”i seç; “Aldım” derken ya da varlık eklerken hedefi seçersin.</div></div>
        <div class="field" id="man"><label>Bu hedef için biriken (₺)</label><input class="input" name="manual" inputmode="decimal" value="${amtStr(x.manual)}"></div>
        <button class="btn" type="submit">Kaydet</button>
        ${isNew ? '' : '<div class="btn-row"><button class="btn danger" type="button" id="del">Sil</button></div>'}
      </form>`, (root) => {
      const f = $('#f', root);
      let kind = x.kind || 'other';
      $$('#kinds button', root).forEach((b) => (b.onclick = () => {
        const prevIcon = GOAL_KINDS[kind][0], prevName = GOAL_KINDS[kind][1];
        kind = b.dataset.k;
        $$('#kinds button', root).forEach((y) => y.classList.toggle('on', y === b));
        if (!f.emoji.value || f.emoji.value === prevIcon) f.emoji.value = GOAL_KINDS[kind][0];
        if (!f.name.value || f.name.value === prevName) f.name.value = GOAL_KINDS[kind][1];
        $('#tgt-l', root).textContent = kind === 'debt' ? 'Borç tutarı (₺)' : 'Hedef tutar (₺)';
      }));
      const t = () => ($('#man', root).hidden = f.mode.value !== 'manual');
      f.mode.onchange = t; t();
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const target = parseAmount(f.target.value);
        if (!(target > 0)) return toast('Hedef tutarı gir');
        const data = { name: f.name.value.trim(), emoji: f.emoji.value.trim(), kind, target, deadline: f.deadline.value, mode: f.mode.value, manual: parseAmount(f.manual.value) || 0 };
        if (isNew) state.savings.goals.push({ id: uid(), ...data }); else Object.assign(g, data);
        save(); closeSheet(); renderView();
      };
      const del = $('#del', root);
      if (del) del.onclick = () => {
        if (!confirm('Hedef silinsin mi?')) return;
        state.savings.goals = state.savings.goals.filter((y) => y.id !== g.id);
        state.savings.holdings.forEach((h) => { if (h.goalId === g.id) h.goalId = null; });
        if (state.plan) (state.plan.savingItems || []).forEach((i) => { if (i.goalId === g.id) i.goalId = null; });
        save(); closeSheet(); renderView();
      };
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
    const p = state.plan;
    const pt = p ? { income: sum(p.incomes, 'amount'), fixed: sum(p.fixed, 'amount'), taksit: sum(state.installments.filter((i) => instActive(i, monthKeyOf())), 'monthly'), alloc: sum(p.categories, 'planned') } : null;
    view.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>🧭 Planım</h3>${p ? `<span class="chip ${p.reviewed ? 'good' : 'warn'}">${p.reviewed ? 'Hazır' : 'Gözden geçir'}</span>` : ''}</div>
        ${p ? `<ul class="wf">
          <li><span class="k">Gelir (${p.incomes.length})</span><span class="v">${money(pt.income)}</span></li>
          <li class="minus"><span class="k">− Sabit (${p.fixed.length}) + taksit</span><span class="v">${money(pt.fixed + pt.taksit)}</span></li>
          <li class="minus"><span class="k">− Birikim</span><span class="v">${money(planSavingTotal(p))}</span></li>
          <li class="total"><span class="k">= Kalan</span><span class="v">${money(pt.income - pt.fixed - pt.taksit - planSavingTotal(p))}</span></li>
          <li class="sub"><span class="k">${p.categories.length} kategoriye ayrılan</span><span class="v">${money(pt.alloc)}</span></li>
        </ul>
        ${p.empty ? '<p class="small muted">Şu an <b>boş plan</b> kullanıyorsun.</p>' : `<button class="btn" id="plan-edit" style="margin-top:10px">Planımı düzenle</button>`}
        <div class="btn-row"><button class="btn secondary" id="plan-new">Kendim oluşturayım</button><button class="btn secondary" id="plan-sugw">Önerilen plan</button></div>
        <div class="btn-row">${p.empty ? '' : '<button class="btn secondary" id="plan-sug">Önerilenle karşılaştır</button>'}<button class="btn secondary" id="plan-empty">Boş plan</button></div>
        <div class="btn-row"><button class="btn secondary" id="month-blank">Sadece ${monthName(curMonthKey())} boş olsun</button></div>
        <p class="hint">Plan her yeni ayda otomatik kullanılır; değiştirmediğin sürece aynı planla devam edersin. Değişiklikler bu ay ve sonraki aylara uygulanır, geçmiş aylar korunur. “Sadece bu ay boş” seçersen o ay plandan etkilenmez.</p>`
        : `<p class="small muted" style="margin-top:0">Henüz planın yok.</p>${planChoiceHTML()}`}
      </div>
      <div class="card">
        <h3>👤 Hesabım</h3>
        <ul class="list"><li><div class="main"><div class="title">${esc(state.user.name)}</div><div class="sub">Kullanıcı adın</div></div><b>@${esc(state.user.handle)}#${esc(state.user.tag)}</b></li></ul>
        <p class="small muted">Başka bir telefonda, tablette ya da bilgisayarda kullanmak için <b>taşıma linki</b> oluştur ve o cihazda aç. Tüm planın, harcamaların ve birikimlerin oraya kopyalanır.</p>
        <button class="btn" id="mk-link">Başka cihazda kullan — link oluştur</button>
        <div id="link-box" hidden style="margin-top:10px"><textarea class="input" id="link-ta" rows="3" readonly></textarea>
          <div class="btn-row"><button class="btn secondary" id="link-copy">Kopyala</button>${navigator.share ? '<button class="btn secondary" id="link-share">Paylaş</button>' : ''}</div>
          <p class="hint">⚠︎ Link tüm finansal verilerini içerir; sadece kendine gönder. Bu bir kopyadır: cihazlar birbirini otomatik güncellemez — hangi cihazda devam edeceksen ona taşı.</p></div>
      </div>
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
    const pe = $('#plan-edit'); if (pe) pe.onclick = () => openWizard('edit');
    const ps = $('#plan-sug'); if (ps) ps.onclick = suggestionSheet;
    if (!p) bindPlanChoice(view);
    const psw = $('#plan-sugw'); if (psw) psw.onclick = () => { if (confirm('Önerilen planla yeni bir plan oluşturulsun mu? (Geçmiş ayların korunur)')) openWizard('suggested'); };
    const pem = $('#plan-empty'); if (pem) pem.onclick = () => { if (confirm('Boş plana geçilsin mi? Bu ay ve sonraki aylarda plan kalemleri kalkar (harcaması olanlar korunur).')) { setEmptyPlan(); syncFuture(null); save(); renderView(); } };
    const mb = $('#month-blank'); if (mb) mb.onclick = () => {
      const k = curMonthKey(), m = getMonth(k);
      if (!confirm(`${monthName(k)} boş plana çevrilsin mi? Harcaması olmayan plan kalemleri bu aydan kalkar; sonraki aylar planınla devam eder.`)) return;
      if (!m) state.months[k] = { incomes: [], categories: [], expenses: [], saving: { done: 0, items: [] }, skip: [], detached: true };
      else {
        const used = new Set(m.expenses.map((e) => e.catId));
        m.categories = m.categories.filter((c) => used.has(c.id) || c.instId);
        m.incomes = m.incomes.filter((i) => !i.tplId);
        m.saving.items = m.saving.items.filter((i) => i.done);
        m.detached = true;
      }
      save(); toast(`${monthName(k)} boş plana çevrildi`); location.hash = '#/ozet';
    };
    $('#mk-link').onclick = async () => {
      const link = await encodeTransfer();
      $('#link-ta').value = link; $('#link-box').hidden = false;
      toast(`Link hazır (${Math.round(link.length / 1024)} KB)`);
    };
    $('#link-copy').onclick = async () => { const ta = $('#link-ta'); try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); } toast('Kopyalandı'); };
    const lsh = $('#link-share'); if (lsh) lsh.onclick = () => navigator.share({ title: 'Finansım taşıma linki', url: $('#link-ta').value }).catch(() => {});
    const pn = $('#plan-new'); if (pn) pn.onclick = () => { if (confirm('Kendi planını sıfırdan oluşturmak ister misin? (Geçmiş ayların ve harcamaların korunur)')) openWizard('new'); };
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
      <p class="hint">Koddaki plan ve o ayın harcamaları yüklenir; aynı ay varsa üzerine yazılır.</p>
      <button class="btn" type="submit">Yükle</button></form>`, (root) => {
      $('#f', root).onsubmit = (ev) => {
        ev.preventDefault();
        const d = decodeCode(ev.target.c.value);
        if (!d) return toast('Kod okunamadı');
        if (state.months[d.m] && !confirm(`${monthName(d.m)} zaten var; plan ve bu ayın harcamaları koddakiyle değişsin mi?`)) return;
        applyCode(d); save(); closeSheet(); toast(`${monthName(d.m)} verileri yüklendi`); location.hash = '#/ozet';
      };
    });
    $('#reset').onclick = () => {
      if (!confirm('Tüm bütçe, harcama ve birikim verilerin silinecek. Emin misin?')) return;
      if (!confirm('Son kez soruyorum: geri alınamaz. Silinsin mi?')) return;
      localStorage.removeItem(STORE_KEY); state = null; location.hash = ''; render();
    };
  }

  // Dosya indirme: iPhone/Android'de (özellikle ana ekran uygulamasında) <a download> güvenilir değil,
  // bu yüzden önce paylaşım ekranı (Dosyalar'a Kaydet, WhatsApp, Mail…) denenir; olmazsa klasik indirme.
  async function download(name, content, type) {
    const blob = new Blob([content], { type });
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (mobile && navigator.canShare) {
      try {
        const file = new File([blob], name, { type });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`${name} indirildi`);
  }

  // ---------- Sayfa: Ekstre ----------
  // Banka ekstresi gibi: o ayın tüm çıkışları (giderler, sabit ödemeler, taksitler, birikime yatırılanlar) tarih sırasıyla
  function ekstreRows(m, key) {
    const catById = Object.fromEntries(m.categories.map((c) => [c.id, c]));
    const rows = m.expenses.map((e) => {
      const c = catById[e.catId];
      return { date: e.date, icon: (c && c.emoji) || '💸', desc: e.desc || (c ? catLabel(c) : 'Gider'), amount: -(+e.amount || 0), kind: 'gider' };
    });
    m.incomes.forEach((i) => rows.push({ date: i.date && i.date.startsWith(key) ? i.date : `${key}-01`, icon: '💰', desc: i.name, amount: +i.amount || 0, kind: 'gelir' }));
    const items = (m.saving && m.saving.items) || [];
    items.filter((i) => i.done).forEach((i) => rows.push({ date: i.doneDate || `${key}-01`, icon: (ASSETS[i.type] || {}).icon || '🏦', desc: `Birikim — ${itemLabel(i)}`, amount: -(+i.doneAmount || 0), kind: 'birikim' }));
    const log = (m.saving && m.saving.log) || [];
    log.forEach((l) => rows.push({ date: l.date, icon: '🏦', desc: `Birikim — ${l.label}`, amount: -(+l.amount || 0), kind: 'birikim' }));
    // Kayıt tutulmadan önce yapılmış ekstra aktarımlar
    const known = sum(items.filter((i) => i.done), 'doneAmount') + sum(log, 'amount');
    const rest = Math.round(((m.saving && m.saving.done) || 0) - known);
    if (rest > 0) rows.push({ date: `${key}-${pad(daysInMonth(key))}`, icon: '🏦', desc: 'Birikime aktarım', amount: -rest, kind: 'birikim' });
    return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'gelir' ? -1 : 1));
  }
  function renderEkstre() {
    const key = curMonthKey(), m = getMonth(key);
    const rows = m ? ekstreRows(m, key) : [];
    const s = m ? calc(m, key) : null;
    const income = sum(rows.filter((r) => r.amount > 0), 'amount');
    const out = -sum(rows.filter((r) => r.amount < 0), 'amount');
    const cash = income - out;
    const P = portfolio();
    const todayNet = sum(rows.filter((r) => r.date === todayISO()), 'amount');
    const budgetPct = s && s.planned > 0 ? Math.round((s.spent / s.planned) * 100) : null;
    const amt = (n) => `${n > 0 ? '+' : '−'}${nf2.format(Math.abs(Math.round(n * 100) / 100))} ₺`;
    view.innerHTML = `
      <div class="ek-tiles">
        <div class="ek-tile"><div class="k">Toplam Gelir</div><div class="v good">${nf0.format(income)} ₺</div></div>
        <div class="ek-tile"><div class="k">Ödenecek</div><div class="v gold">${nf0.format(s ? s.pendingFixed : 0)} ₺</div></div>
        <div class="ek-tile"><div class="k">Harcanan bütçe</div><div class="v violet">${budgetPct == null ? '—' : '%' + budgetPct}</div></div>
      </div>
      <div class="card ek-card">
        <div class="ek-head">
          <div class="k">Toplam Varlık</div>
          <div class="big">${nf0.format(cash + P.value)} ₺</div>
          <div class="small ${todayNet < 0 ? 'bad' : 'good'}">${todayNet < 0 ? '↘' : '↗'} ${amt(todayNet)} bugün</div>
        </div>
        ${rows.length ? `<ul class="ek-list">${rows.map((r) => `<li>
            <span class="ek-ic">${esc(r.icon)}</span>
            <span class="ek-desc">${esc(r.desc)}<span class="ek-d">${shortDate(r.date)}</span></span>
            <span class="ek-amt ${r.amount < 0 ? 'bad' : 'good'}">${amt(r.amount)}</span></li>`).join('')}</ul>`
          : `<p class="muted small" style="margin:12px 0">${monthName(key)} için henüz hareket yok.</p>`}
        <ul class="ek-sum">
          <li><span>💸 Toplam harcanan</span><b>${nf2.format(out)} ₺</b></li>
          <li><span>💵 Güncel elde kalan</span><b class="${cash < 0 ? 'bad' : ''}">${nf2.format(cash)} ₺</b></li>
          <li><span>📈 Portföy</span><b>${nf0.format(P.value)} ₺</b></li>
        </ul>
      </div>
      <button class="btn" id="ek-dl" ${rows.length ? '' : 'disabled'}>⬇︎ Ekstreyi indir</button>`;
    $('#ek-dl').onclick = () => {
      const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
      const tl = (n) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
      const lines = [
        [`Finansım — ${monthName(key)} ekstresi`], [`${state.user.name} (@${state.user.handle}#${state.user.tag})`], [],
        ['Tarih', 'Açıklama', 'Tutar (TL)'],
        ...rows.map((r) => [r.date.split('-').reverse().join('.'), r.desc, (r.amount > 0 ? '' : '-') + tl(Math.abs(r.amount))]),
        [],
        ['', 'Toplam gelir', tl(income)],
        ['', 'Toplam harcanan', '-' + tl(out)],
        ['', 'Güncel elde kalan', tl(cash)],
        ['', 'Portföy', tl(P.value)],
      ];
      download(`ekstre-${key}.csv`, '﻿' + lines.map((l) => l.map(q).join(';')).join('\r\n'), 'text/csv');
    };
  }

  // ---------- Karşılama ----------
  function renderOnboarding() {
    $('#app').hidden = true;
    let ob = $('#onboard');
    if (!ob) { ob = document.createElement('div'); ob.id = 'onboard'; document.body.appendChild(ob); }
    ob.className = 'onboard';
    const enterApp = () => { save(); ob.remove(); $('#app').hidden = false; location.hash = '#/ozet'; render(); refreshRates(); };
    if (pendingTransfer) {
      ob.innerHTML = `<div class="card"><div style="font-size:42px">📲</div><h1>Verilerin taşınıyor</h1>
        <p class="muted" style="margin-top:0">Başka cihazdan gönderdiğin taşıma linkiyle açtın. Tüm planın, harcamaların ve birikimlerin bu cihaza yüklenecek.</p>
        <button class="btn" id="tr-ok">Verilerimi yükle</button><div class="btn-row"><button class="btn secondary" id="tr-no">Yeni başla</button></div></div>`;
      $('#tr-ok').onclick = async () => {
        const d = await decodeTransfer(pendingTransfer);
        pendingTransfer = null;
        if (!d) { toast('Taşıma linki okunamadı'); return renderOnboarding(); }
        state = d; unlocked = true; autoRollover(); toast(`Hoş geldin ${state.user.name} — verilerin yüklendi`); enterApp();
      };
      $('#tr-no').onclick = () => { pendingTransfer = null; renderOnboarding(); };
      return;
    }
    // 1. adım: ad + kullanıcı adı
    ob.innerHTML = `<div class="card">
      <div style="font-size:42px">💰</div>
      <h1>Finansım'a hoş geldin</h1>
      <p class="muted" style="margin-top:0">Şifre yok, e-posta yok. Verilerin bu cihazda saklanır.</p>
      <form id="ob-f">
        <div class="field"><label>Adın</label><input class="input" name="name" placeholder="ör. Eda" required autocomplete="given-name"></div>
        <div class="field"><label>Kullanıcı adın</label><input class="input" name="handle" placeholder="ör. edaatosun" required autocapitalize="none" autocomplete="username" pattern="[a-zA-Z0-9._]{3,20}">
          <div class="hint">3–20 karakter: harf, rakam, nokta, alt çizgi. Sonuna sana özel 4 haneli bir kod eklenir (ör. @eda#4821).</div></div>
        ${pendingCode ? `<label class="check"><input type="checkbox" name="usecode" checked> ${monthName(pendingCode.m)} planımı ve harcamalarımı yükle (linkten geldi)</label>`
          : `<details class="small" style="margin-bottom:12px"><summary class="muted">Başka cihazdan geliyorum / veri kodum var</summary><textarea class="input" name="code" rows="3" style="margin-top:8px" placeholder="Taşıma linki ya da veri kodu"></textarea></details>`}
        <button class="btn" type="submit">Devam</button>
      </form></div>`;
    const f0 = $('#ob-f');
    f0.name.oninput = () => { if (!f0.handle.dataset.touched) f0.handle.value = slugHandle(f0.name.value); };
    f0.handle.oninput = () => (f0.handle.dataset.touched = '1');
    f0.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const raw = f.code ? f.code.value.trim() : '';
      if (raw && /#tasi=|^[zj][A-Za-z0-9_-]{40,}$/.test(raw)) {
        const d = await decodeTransfer(raw);
        if (!d) return toast('Taşıma linki okunamadı');
        state = d; unlocked = true; autoRollover(); return enterApp();
      }
      const handle = slugHandle(f.handle.value);
      if (handle.length < 3) return toast('Kullanıcı adı en az 3 karakter olmalı');
      state = freshState(f.name.value.trim(), handle);
      const code = pendingCode && f.usecode && f.usecode.checked ? pendingCode : raw ? decodeCode(raw) : null;
      if (raw && !code) { state = null; return toast('Veri kodu okunamadı'); }
      if (code) applyCode(code);
      pendingCode = null; unlocked = true;
      autoRollover();
      if (state.plan) return enterApp();
      // 2. adım: plan seçimi — uygulamaya planla girilir
      ob.innerHTML = `<div class="card">
        <div style="font-size:42px">🧭</div>
        <h1>Merhaba ${esc(state.user.name)}!</h1>
        <p class="muted" style="margin-top:0">Kullanıcı adın <b>@${esc(state.user.handle)}#${esc(state.user.tag)}</b>. Şimdi planını seç; her ay bu planla devam edersin, istediğin zaman Ayarlar'dan değiştirirsin.</p>
        ${planChoiceHTML()}</div>`;
      bindPlanChoice(ob, () => { save(); ob.remove(); $('#app').hidden = false; location.hash = '#/ozet'; render(); refreshRates(); });
    };
  }

  // Yeni aya girilince ay kendiliğinden açılmaz; "Planımı uygula / Bu ay boş başlasın" seçimi gösterilir.
  function autoRollover() {
    const now = monthKeyOf();
    if (!state || state.months[now]) return;
    state.ui.month = now;
    save();
  }

  // Seçili ayın planını ve o aya ait tüm kayıtları kaldırır; ay hiç açılmamış gibi olur.
  function removeMonthPlan() {
    const key = curMonthKey(), m = getMonth(key);
    if (!m) { toast(`${monthName(key)} için uygulanmış bir plan yok`); return; }
    const nEx = m.expenses.length, nInc = m.incomes.length;
    const items = (m.saving && m.saving.items) || [];
    if (!confirm(`${monthName(key)} planını kaldırmak istediğine emin misin?`)) return;
    if (!confirm(`Dikkat: ${monthName(key)} ayına ait tüm girdiler ve çıktılar silinecek (${nEx} gider, ${nInc} gelir${items.some((i) => i.done) ? ', bu ay “Aldım” dediğin birikimler' : ''}). Bu ayın tüm verileri gidecek ve geri alınamaz. Emin misin?`)) return;
    // Bu ayın "Aldım" ile eklenen birikimlerini de birikimden çıkar
    const hIds = new Set(items.map((i) => i.holdingId).filter(Boolean));
    state.savings.holdings = state.savings.holdings.filter((h) => !hIds.has(h.id));
    delete state.months[key];
    openCats.clear(); state.ui.cat = null;
    save(); toast(`${monthName(key)} planı kaldırıldı`);
    location.hash = '#/ozet'; renderView();
  }

  // ---------- Yönlendirme ----------
  function updateHeader() {
    const r = route();
    const h = new Date().getHours();
    const greet = h < 6 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'Merhaba' : 'İyi akşamlar';
    const titles = { birikim: 'Birikimim', ayarlar: 'Ayarlar', rapor: 'Raporlar', islem: 'İşlemler', odemeler: 'Ödemeler', ekstre: 'Ekstre' };
    $('#hello').textContent = titles[r] || `${greet}, ${state.user.name}`;
    $('#month-switch').hidden = !(r === 'ozet' || r === 'islem' || r === 'odemeler' || r === 'ekstre');
    $('#m-label').textContent = monthName(curMonthKey());
    const inMenu = ['odemeler', 'ekstre', 'rapor', 'ayarlar'].includes(r);
    $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r || (inMenu && a.dataset.tab === 'menu')));
    $('#tab-plus').setAttribute('aria-label', r === 'birikim' ? 'Varlık ekle' : 'Yeni işlem');
  }
  // Menü: alt çubuğa sığmayan sayfalar
  function openMenu() {
    const items = [
      ['odemeler', '💳', 'Ödemeler', 'Sabit giderler ve taksitler'],
      ['ekstre', '🧾', 'Ekstre', 'Ayın tüm hareketleri, indir'],
      ['rapor', '📊', 'Rapor', 'Aylık başarı ve kategori karnesi'],
      ['ayarlar', '⚙️', 'Ayarlar', 'Planım, hesabım, yedek, tema'],
    ];
    const hasMonth = !!getMonth(curMonthKey());
    openSheet('Menü', `<div class="menu-grid">${items.map(([k, ic, n, d]) => `<button class="menu-item ${route() === k ? 'on' : ''}" data-go-page="${k}"><span class="ic">${ic}</span><span><b>${n}</b><br><span class="muted small">${d}</span></span></button>`).join('')}
      ${hasMonth ? `<button class="menu-item danger-item" id="rm-month"><span class="ic">🗑</span><span><b>${monthName(curMonthKey())} planını kaldır</b><br><span class="muted small">Sadece bu ay; tüm girdi ve çıktıları silinir, yeniden plan seçersin</span></span></button>` : ''}</div>`, (root) => {
      $$('[data-go-page]', root).forEach((b) => (b.onclick = () => { closeSheet(); location.hash = '#/' + b.dataset.goPage; }));
      const rm = $('#rm-month', root); if (rm) rm.onclick = () => { closeSheet(); removeMonthPlan(); };
    });
  }
  function renderView() {
    hideTip();
    updateHeader();
    ({ ozet: renderOzet, islem: renderIslem, odemeler: renderOdemeler, ekstre: renderEkstre, rapor: renderRapor, birikim: renderBirikim, ayarlar: renderAyarlar }[route()] || renderOzet)();
  }
  function render() {
    applyTheme();
    if (!state) return renderOnboarding();
    if (state.settings.pinHash && !unlocked) return renderLock();
    if (pendingTransfer) {
      const t = pendingTransfer; pendingTransfer = null;
      if (confirm('Taşıma linkiyle açtın. Bu cihazdaki veriler linkteki verilerle değiştirilsin mi?')) {
        decodeTransfer(t).then((d) => { if (!d) return toast('Taşıma linki okunamadı'); state = d; unlocked = true; save(); applyTheme(); toast('Veriler taşındı'); renderView(); });
      }
    }
    if (pendingCode) {
      const d = pendingCode; pendingCode = null;
      if (confirm(`Linkteki ${monthName(d.m)} planı ve verileri yüklensin mi?${state.months[d.m] ? ' (Bu ay zaten var, üzerine yazılır.)' : ''}`)) { applyCode(d); save(); toast('Veriler yüklendi'); }
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
      return `<li class="tap" data-k="${k}"><div class="main"><div class="title">${monthName(k)}${k === monthKeyOf() ? ' · bu ay' : ''}</div><div class="sub">${s ? `Harcanan ${money(s.spent)} / Gelir ${money(s.income)}` : 'Henüz açılmadı'}</div></div>${k === curMonthKey() ? '<span class="chip info">Seçili</span>' : ''}</li>`;
    }).join('')}</ul>`, (root) => $$('[data-k]', root).forEach((li) => (li.onclick = () => { state.ui.month = li.dataset.k; save(); closeSheet(); renderView(); })));
  };
  $('#btn-settings').onclick = () => (location.hash = '#/ayarlar');
  $('#tab-plus').onclick = () => (route() === 'birikim' ? holdingForm() : quickAdd());
  $('#tab-menu').onclick = (ev) => { ev.preventDefault(); openMenu(); };

  if (state) { state = migrate(state); state.ui.cat = null; save(); autoRollover(); }
  render();
  if (state) refreshRates();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state) refreshRates({ silent: true }); });
  setInterval(() => { if (state && !document.hidden && route() === 'birikim' && $('#sheet').hidden) refreshRates({ force: true, silent: true }); }, 60 * 1000);

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

const CHIP_API_BASE = 'https://gate.chip-in.asia/api/v1/';

const PRODUCTS = {
  '14-hari-bisnes-online': { name: '14 Hari Bisnes Online', amount: 9900, enabled: true },
  'bimbingan-bisnes': { name: 'Bimbingan Bersama Poknik', amount: 20000, enabled: true },
  'dropship-with-poknik': { name: 'Dropship With Poknik', amount: 25000, enabled: true },
  'eastelpoknik': { name: 'Bimbingan EastelPoknik', amount: 3900, enabled: true },
  'ppbm': { name: 'PPBM — Poknik Personal Brand Mentor', amount: 3900, enabled: true },
  'export-mudah': { name: 'Export Mudah V2', amount: 10000, enabled: true },
  'master-sales-cycle': { name: 'Master Sales Cycle', amount: 12900, enabled: true },
  'modul-bisnes-konsisten': { name: 'Bisnes Konsisten', amount: null, enabled: false },
  'membina-momentum-bisnes': { name: 'Membina Momentum Bisnes', amount: null, enabled: false }
};

let schemaPromise;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

function now() { return Math.floor(Date.now() / 1000); }
function money(amount) { return typeof amount === 'number' ? `RM${(amount / 100).toFixed(2).replace('.00','')}` : 'Belum ditetapkan'; }
function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function safeText(v, max = 160) { return String(v || '').trim().slice(0, max); }
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

async function ensureSchema(env) {
  if (!env.DB) throw new Error('D1 binding DB is not configured');
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        chip_purchase_id TEXT UNIQUE,
        product_slug TEXT NOT NULL,
        product_name TEXT NOT NULL,
        amount_sen INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'MYR',
        customer_name TEXT,
        customer_email TEXT NOT NULL,
        customer_phone TEXT,
        status TEXT NOT NULL DEFAULT 'initiated',
        chip_status TEXT,
        payment_method TEXT,
        checkout_url TEXT,
        reference TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        paid_at INTEGER,
        last_event_type TEXT,
        raw_json TEXT
      )`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email)'),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS callback_events (
        event_key TEXT PRIMARY KEY,
        chip_purchase_id TEXT,
        event_type TEXT,
        received_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      )`)
    ]).catch(err => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

function publicProducts() {
  return Object.entries(PRODUCTS).map(([slug, p]) => ({ slug, name: p.name, amount_sen: p.amount, price: money(p.amount), enabled: p.enabled }));
}

async function chipFetch(env, path, options = {}) {
  if (!env.CHIP_SECRET_KEY) throw new Error('CHIP_SECRET_KEY is not configured');
  const res = await fetch(`${env.CHIP_API_BASE || CHIP_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.CHIP_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const e = new Error(`CHIP request failed (${res.status})`);
    e.status = res.status;
    e.body = body;
    throw e;
  }
  return body;
}

async function createCheckout(request, env) {
  await ensureSchema(env);
  if (!env.CHIP_SECRET_KEY || !env.CHIP_BRAND_ID) {
    return json({ error: 'CHIP belum dikonfigurasi pada Worker.' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Permintaan tidak sah.' }, 400); }
  const slug = safeText(body.product, 80);
  const product = PRODUCTS[slug];
  if (!product || !product.enabled || !product.amount) return json({ error: 'Produk ini belum dibuka untuk checkout.' }, 400);

  const email = normalizeEmail(body.email);
  const fullName = safeText(body.full_name, 120);
  const phone = safeText(body.phone, 40);
  if (!isEmail(email)) return json({ error: 'Masukkan alamat emel yang sah.' }, 400);
  if (fullName.length < 2) return json({ error: 'Masukkan nama penuh.' }, 400);

  const orderId = crypto.randomUUID();
  const ts = now();
  const reference = `PK-${orderId.slice(0, 8).toUpperCase()}`;
  const origin = new URL(request.url).origin;

  await env.DB.prepare(`INSERT INTO orders
    (id, product_slug, product_name, amount_sen, customer_name, customer_email, customer_phone, status, reference, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?, ?)`)
    .bind(orderId, slug, product.name, product.amount, fullName, email, phone || null, reference, ts, ts).run();

  const payload = {
    client: { email, full_name: fullName, ...(phone ? { phone } : {}) },
    purchase: {
      currency: 'MYR',
      products: [{ name: product.name, price: product.amount }],
      metadata: { poknik_order_id: orderId, product_slug: slug }
    },
    brand_id: env.CHIP_BRAND_ID,
    reference,
    success_redirect: `${origin}/thank-you/?product=${encodeURIComponent(slug)}&order=${encodeURIComponent(orderId)}`,
    failure_redirect: `${origin}/checkout/?product=${encodeURIComponent(slug)}&status=failed`,
    cancel_redirect: `${origin}/checkout/?product=${encodeURIComponent(slug)}&status=cancelled`,
    success_callback: `${origin}/api/chip/callback`,
    send_receipt: true,
    creator_agent: 'poknik-hub',
    platform: 'web'
  };

  try {
    const purchase = await chipFetch(env, 'purchases/', { method: 'POST', body: JSON.stringify(payload) });
    await env.DB.prepare(`UPDATE orders SET chip_purchase_id=?, chip_status=?, status=?, checkout_url=?, updated_at=?, raw_json=? WHERE id=?`)
      .bind(purchase.id || null, purchase.status || 'created', purchase.status || 'created', purchase.checkout_url || null, now(), JSON.stringify(purchase), orderId).run();
    if (!purchase.checkout_url) return json({ error: 'CHIP tidak memulangkan checkout URL.' }, 502);
    return json({ order_id: orderId, checkout_url: purchase.checkout_url });
  } catch (err) {
    await env.DB.prepare(`UPDATE orders SET status='create_failed', updated_at=?, raw_json=? WHERE id=?`)
      .bind(now(), JSON.stringify(err.body || { message: err.message }), orderId).run();
    return json({ error: 'Tidak dapat membuka checkout CHIP sekarang.', detail: err.body || null }, 502);
  }
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyChipSignature(env, rawBody, signature) {
  if (!signature) return false;
  const pem = await chipFetch(env, 'public_key/', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
  const key = await crypto.subtle.importKey('spki', pemToArrayBuffer(String(pem)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64ToBytes(signature), new TextEncoder().encode(rawBody));
}

async function applyPurchaseUpdate(env, purchase, eventType = null) {
  if (!purchase || !purchase.id) return;
  await ensureSchema(env);
  const status = purchase.status || 'unknown';
  const method = purchase.transaction_data?.payment_method || purchase.payment?.payment_method || null;
  const ts = now();
  const paidAt = status === 'paid' ? ts : null;
  await env.DB.prepare(`UPDATE orders SET
      chip_status=?, status=?, payment_method=?, updated_at=?,
      paid_at=CASE WHEN ? IS NOT NULL AND paid_at IS NULL THEN ? ELSE paid_at END,
      last_event_type=COALESCE(?, last_event_type), raw_json=?
      WHERE chip_purchase_id=?`)
    .bind(status, status, method, ts, paidAt, paidAt, eventType, JSON.stringify(purchase), purchase.id).run();
}

async function chipCallback(request, env) {
  await ensureSchema(env);
  const raw = await request.text();
  const signature = request.headers.get('X-Signature');
  let verified = false;
  try { verified = await verifyChipSignature(env, raw, signature); } catch { verified = false; }
  if (!verified) return json({ error: 'Invalid callback signature' }, 401);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const eventType = payload.event_type || `purchase.${payload.status || 'updated'}`;
  const eventKey = `${payload.id || 'unknown'}:${eventType}:${payload.updated_on || payload.status || 'na'}`;
  await env.DB.prepare(`INSERT OR IGNORE INTO callback_events (event_key, chip_purchase_id, event_type, received_at, payload_json) VALUES (?, ?, ?, ?, ?)`)
    .bind(eventKey, payload.id || null, eventType, now(), raw).run();
  await applyPurchaseUpdate(env, payload, eventType);
  return json({ ok: true });
}

async function syncOrderWithChip(env, order) {
  if (!order?.chip_purchase_id || !env.CHIP_SECRET_KEY) return order;
  try {
    const purchase = await chipFetch(env, `purchases/${encodeURIComponent(order.chip_purchase_id)}/`, { method: 'GET' });
    await applyPurchaseUpdate(env, purchase, 'manual.sync');
    return { ...order, status: purchase.status || order.status, chip_status: purchase.status || order.chip_status, payment_method: purchase.transaction_data?.payment_method || order.payment_method };
  } catch { return order; }
}

async function orderStatus(request, env) {
  await ensureSchema(env);
  const id = new URL(request.url).searchParams.get('order');
  if (!id) return json({ error: 'Order ID diperlukan.' }, 400);
  let order = await env.DB.prepare(`SELECT id, product_slug, product_name, amount_sen, currency, status, chip_status, payment_method, created_at, paid_at FROM orders WHERE id=?`).bind(id).first();
  if (!order) return json({ error: 'Order tidak ditemui.' }, 404);
  if (!['paid','refunded','cancelled'].includes(order.status)) order = await syncOrderWithChip(env, order);
  return json({ order: { ...order, price: money(order.amount_sen) } });
}

function b64urlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecode(input) {
  const s = String(input).replace(/-/g,'+').replace(/_/g,'/');
  const padded = s + '='.repeat((4 - s.length % 4) % 4);
  return atob(padded);
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
async function makeSession(secret) {
  const payload = b64urlEncode(JSON.stringify({ exp: now() + 43200 }));
  const sig = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${sig}`;
}
async function validSession(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return false;
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)poknik_admin=([^;]+)/);
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return false;
  const expected = b64urlEncode(await hmac(env.ADMIN_SESSION_SECRET, payload));
  if (expected !== sig) return false;
  try { return JSON.parse(b64urlDecode(payload)).exp > now(); } catch { return false; }
}

async function adminLogin(request, env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({ error: 'Admin secrets belum dikonfigurasi.' }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: 'Permintaan tidak sah.' }, 400); }
  if (String(body.password || '') !== String(env.ADMIN_PASSWORD)) return json({ error: 'Kata laluan salah.' }, 401);
  const token = await makeSession(env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, { 'set-cookie': `poknik_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` });
}

function adminLogout() {
  return json({ ok: true }, 200, { 'set-cookie': 'poknik_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
}

async function adminSummary(env) {
  await ensureSchema(env);
  const row = await env.DB.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='paid' THEN amount_sen ELSE 0 END),0) AS revenue_sen,
    SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid_orders,
    SUM(CASE WHEN status IN ('initiated','created','viewed') THEN 1 ELSE 0 END) AS pending_orders,
    COUNT(*) AS total_orders,
    COUNT(DISTINCT CASE WHEN customer_email IS NOT NULL THEN lower(customer_email) END) AS customers
    FROM orders`).first();
  const top = await env.DB.prepare(`SELECT product_slug, product_name, COUNT(*) orders, COALESCE(SUM(amount_sen),0) revenue_sen FROM orders WHERE status='paid' GROUP BY product_slug, product_name ORDER BY revenue_sen DESC LIMIT 10`).all();
  return json({ summary: { ...row, revenue: money(Number(row?.revenue_sen || 0)) }, products: top.results || [] });
}

async function adminOrders(request, env) {
  await ensureSchema(env);
  const u = new URL(request.url);
  const status = safeText(u.searchParams.get('status'), 30);
  const q = safeText(u.searchParams.get('q'), 100);
  const args = [];
  const where = [];
  if (status && status !== 'all') { where.push('status=?'); args.push(status); }
  if (q) { where.push('(customer_email LIKE ? OR customer_name LIKE ? OR product_name LIKE ? OR id LIKE ?)'); const like=`%${q}%`; args.push(like,like,like,like); }
  const sql = `SELECT id, chip_purchase_id, product_slug, product_name, amount_sen, currency, customer_name, customer_email, customer_phone, status, chip_status, payment_method, reference, created_at, updated_at, paid_at FROM orders ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`;
  const res = await env.DB.prepare(sql).bind(...args).all();
  return json({ orders: (res.results || []).map(o => ({ ...o, price: money(o.amount_sen) })) });
}

async function adminRefreshOrder(id, env) {
  await ensureSchema(env);
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
  if (!order) return json({ error: 'Order tidak ditemui.' }, 404);
  const synced = await syncOrderWithChip(env, order);
  return json({ order: synced });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/health' && request.method === 'GET') {
        return json({ ok: true, db: !!env.DB, chip: !!(env.CHIP_SECRET_KEY && env.CHIP_BRAND_ID), admin: !!(env.ADMIN_PASSWORD && env.ADMIN_SESSION_SECRET) });
      }
      if (path === '/api/products' && request.method === 'GET') return json({ products: publicProducts() });
      if (path === '/api/checkout/create' && request.method === 'POST') return createCheckout(request, env);
      if (path === '/api/chip/callback' && request.method === 'POST') return chipCallback(request, env);
      if (path === '/api/order/status' && request.method === 'GET') return orderStatus(request, env);

      if (path === '/api/admin/login' && request.method === 'POST') return adminLogin(request, env);
      if (path === '/api/admin/logout' && request.method === 'POST') return adminLogout();
      if (path.startsWith('/api/admin/')) {
        if (!(await validSession(request, env))) return json({ error: 'Unauthorized' }, 401);
        if (path === '/api/admin/summary' && request.method === 'GET') return adminSummary(env);
        if (path === '/api/admin/orders' && request.method === 'GET') return adminOrders(request, env);
        const m = path.match(/^\/api\/admin\/orders\/([^/]+)\/refresh$/);
        if (m && request.method === 'POST') return adminRefreshOrder(decodeURIComponent(m[1]), env);
        if (path === '/api/admin/products' && request.method === 'GET') return json({ products: publicProducts() });
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error', message: String(err?.message || err) }, 500);
    }
  }
};

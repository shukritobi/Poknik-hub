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

const ADMIN_SESSION_COOKIE = '__Host-poknik_admin';
const MAX_JSON_BODY = 32 * 1024;
const MAX_CALLBACK_BODY = 512 * 1024;
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'cross-origin-opener-policy': 'same-origin'
};

let schemaPromise;
let publicKeyCache = { pem: null, expiresAt: 0 };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      ...headers
    }
  });
}

function now() { return Math.floor(Date.now() / 1000); }
function money(amount) { return typeof amount === 'number' ? `RM${(amount / 100).toFixed(2).replace('.00','')}` : 'Belum ditetapkan'; }
function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function safeText(v, max = 160) { return String(v || '').trim().slice(0, max); }
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function configuredEnvironment(env) { return String(env.PAYMENT_ENVIRONMENT || 'test').toLowerCase() === 'live' ? 'live' : 'test'; }
function purchaseEnvironment(purchase, env) {
  if (purchase && typeof purchase.is_test === 'boolean') return purchase.is_test ? 'test' : 'live';
  return configuredEnvironment(env);
}
function paymentMethod(purchase) {
  return purchase?.transaction_data?.payment_method || purchase?.payment?.payment_method || null;
}
function isSuccessfulStatus(status) { return ['paid','cleared','settled'].includes(String(status || '')); }
function sanitizePurchase(purchase) {
  if (!purchase || typeof purchase !== 'object') return null;
  return {
    id: purchase.id || null,
    status: purchase.status || null,
    is_test: typeof purchase.is_test === 'boolean' ? purchase.is_test : null,
    brand_id: purchase.brand_id || null,
    reference: purchase.transaction_data?.reference || purchase.reference || null,
    purchase: {
      currency: purchase.purchase?.currency || null,
      total: purchase.purchase?.total ?? null
    },
    payment: purchase.payment ? {
      amount: purchase.payment.amount ?? null,
      currency: purchase.payment.currency || null,
      paid_on: purchase.payment.paid_on || null
    } : null,
    payment_method: paymentMethod(purchase),
    updated_on: purchase.updated_on || null
  };
}

async function parseJsonBody(request, maxBytes = MAX_JSON_BODY) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

async function ensureColumn(env, table, column, definition) {
  const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  const names = new Set((info.results || []).map(r => r.name));
  if (!names.has(column)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

async function ensureSchema(env) {
  if (!env.DB) throw new Error('D1 binding DB is not configured');
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await env.DB.batch([
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
          raw_json TEXT,
          environment TEXT NOT NULL DEFAULT 'test'
        )`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS callback_events (
          event_key TEXT PRIMARY KEY,
          chip_purchase_id TEXT,
          event_type TEXT,
          received_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          environment TEXT NOT NULL DEFAULT 'test',
          signature_valid INTEGER NOT NULL DEFAULT 1
        )`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS security_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          fingerprint TEXT,
          detail TEXT,
          created_at INTEGER NOT NULL,
          environment TEXT NOT NULL DEFAULT 'test'
        )`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
          key TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (key, window_start)
        )`),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)'),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)'),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email)'),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_callback_received_at ON callback_events(received_at DESC)'),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_security_created_at ON security_events(created_at DESC)')
      ]);

      await ensureColumn(env, 'orders', 'environment', "TEXT NOT NULL DEFAULT 'test'");
      await ensureColumn(env, 'callback_events', 'environment', "TEXT NOT NULL DEFAULT 'test'");
      await ensureColumn(env, 'callback_events', 'signature_valid', 'INTEGER NOT NULL DEFAULT 1');
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_environment ON orders(environment)').run();

      await env.DB.prepare("UPDATE orders SET environment='test' WHERE environment IS NULL OR environment='' ").run();
      await env.DB.prepare("UPDATE callback_events SET environment='test' WHERE environment IS NULL OR environment='' ").run();
      await env.DB.prepare("UPDATE callback_events SET payload_json='{}' WHERE payload_json IS NOT NULL AND payload_json <> '{}' ").run();
      return true;
    })().catch(err => { schemaPromise = null; throw err; });
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
      'Accept': 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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

async function sha256Hex(input) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input))));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

async function requestFingerprint(request, env, scope) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';
  const salt = env.ADMIN_SESSION_SECRET || 'poknik';
  return (await sha256Hex(`${scope}|${ip}|${ua}|${salt}`)).slice(0, 32);
}

async function recordSecurityEvent(env, eventType, fingerprint, detail = null) {
  try {
    await ensureSchema(env);
    await env.DB.prepare(`INSERT INTO security_events (event_type, fingerprint, detail, created_at, environment) VALUES (?, ?, ?, ?, ?)`)
      .bind(eventType, fingerprint || null, safeText(detail, 400) || null, now(), configuredEnvironment(env)).run();
  } catch {}
}

async function allowRate(env, key, maxCount, windowSeconds) {
  await ensureSchema(env);
  const ts = now();
  const start = Math.floor(ts / windowSeconds) * windowSeconds;
  await env.DB.prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key, window_start) DO UPDATE SET count=count+1`).bind(key, start).run();
  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE key=? AND window_start=?').bind(key, start).first();
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(ts - 86400).run();
  return Number(row?.count || 0) <= maxCount;
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

async function createCheckout(request, env) {
  await ensureSchema(env);
  if (!env.CHIP_SECRET_KEY || !env.CHIP_BRAND_ID) return json({ error: 'CHIP belum dikonfigurasi pada Worker.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Origin tidak sah.' }, 403);

  const fp = await requestFingerprint(request, env, 'checkout');
  if (!(await allowRate(env, `checkout:${fp}`, 12, 600))) {
    await recordSecurityEvent(env, 'checkout.rate_limited', fp);
    return json({ error: 'Terlalu banyak cubaan checkout. Cuba semula sebentar lagi.' }, 429);
  }

  const cfgEnv = configuredEnvironment(env);
  if (cfgEnv === 'live' && String(env.LIVE_PAYMENTS_ENABLED || '').toLowerCase() !== 'true') {
    return json({ error: 'Live payments belum diaktifkan pada Worker.' }, 503);
  }

  let body;
  try { body = await parseJsonBody(request); }
  catch (e) { return json({ error: e.status === 413 ? 'Permintaan terlalu besar.' : 'Permintaan tidak sah.' }, e.status || 400); }

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
  const reference = `PK-${cfgEnv === 'test' ? 'T' : 'L'}-${orderId.slice(0, 8).toUpperCase()}`;
  const origin = new URL(request.url).origin;

  await env.DB.prepare(`INSERT INTO orders
    (id, product_slug, product_name, amount_sen, customer_name, customer_email, customer_phone, status, reference, created_at, updated_at, environment)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?, ?, ?)`)
    .bind(orderId, slug, product.name, product.amount, fullName, email, phone || null, reference, ts, ts, cfgEnv).run();

  const payload = {
    client: { email, full_name: fullName, ...(phone ? { phone } : {}) },
    purchase: {
      currency: 'MYR',
      products: [{ name: product.name, price: product.amount }]
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
    const detectedEnv = purchaseEnvironment(purchase, env);
    if (detectedEnv !== cfgEnv) {
      try { if (purchase?.id) await chipFetch(env, `purchases/${encodeURIComponent(purchase.id)}/cancel/`, { method: 'POST', body: '{}' }); } catch {}
      await env.DB.prepare(`UPDATE orders SET chip_purchase_id=?, chip_status=?, status='environment_mismatch', updated_at=?, raw_json=?, environment=? WHERE id=?`)
        .bind(purchase.id || null, purchase.status || 'created', now(), JSON.stringify(sanitizePurchase(purchase)), detectedEnv, orderId).run();
      await recordSecurityEvent(env, 'payment.environment_mismatch', fp, `configured=${cfgEnv}; provider=${detectedEnv}`);
      return json({ error: 'Konfigurasi test/live CHIP tidak sepadan. Checkout dihentikan.' }, 503);
    }

    await env.DB.prepare(`UPDATE orders SET chip_purchase_id=?, chip_status=?, status=?, checkout_url=?, updated_at=?, raw_json=?, environment=? WHERE id=?`)
      .bind(purchase.id || null, purchase.status || 'created', purchase.status || 'created', purchase.checkout_url || null, now(), JSON.stringify(sanitizePurchase(purchase)), detectedEnv, orderId).run();
    if (!purchase.checkout_url) return json({ error: 'CHIP tidak memulangkan checkout URL.' }, 502);
    return json({ order_id: orderId, checkout_url: purchase.checkout_url, environment: detectedEnv });
  } catch (err) {
    await env.DB.prepare(`UPDATE orders SET status='create_failed', updated_at=?, raw_json=? WHERE id=?`)
      .bind(now(), JSON.stringify({ provider_status: err.status || null }), orderId).run();
    return json({ error: 'Tidak dapat membuka checkout CHIP sekarang.' }, 502);
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
async function getChipPublicKey(env) {
  if (publicKeyCache.pem && publicKeyCache.expiresAt > now()) return publicKeyCache.pem;
  const pem = await chipFetch(env, 'public_key/', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
  publicKeyCache = { pem: String(pem), expiresAt: now() + 3600 };
  return publicKeyCache.pem;
}
async function verifyChipSignature(env, rawBody, signature) {
  if (!signature) return false;
  const pem = await getChipPublicKey(env);
  const key = await crypto.subtle.importKey('spki', pemToArrayBuffer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64ToBytes(signature), new TextEncoder().encode(rawBody));
}

async function validatePurchaseAgainstOrder(env, purchase, order) {
  if (!purchase || !order) return false;
  if (purchase.brand_id && env.CHIP_BRAND_ID && purchase.brand_id !== env.CHIP_BRAND_ID) return false;
  if (purchase.purchase?.currency && purchase.purchase.currency !== order.currency) return false;
  if (Number.isFinite(Number(purchase.purchase?.total)) && Number(purchase.purchase.total) !== Number(order.amount_sen)) return false;
  if (purchase.payment?.currency && purchase.payment.currency !== order.currency) return false;
  if (Number.isFinite(Number(purchase.payment?.amount)) && Number(purchase.payment.amount) !== Number(order.amount_sen)) return false;
  return true;
}

async function applyPurchaseUpdate(env, purchase, eventType = null) {
  if (!purchase || !purchase.id) return { updated: false, reason: 'missing_purchase' };
  await ensureSchema(env);
  const order = await env.DB.prepare(`SELECT id, amount_sen, currency, environment FROM orders WHERE chip_purchase_id=?`).bind(purchase.id).first();
  if (!order) return { updated: false, reason: 'unknown_purchase' };
  if (!(await validatePurchaseAgainstOrder(env, purchase, order))) {
    await recordSecurityEvent(env, 'payment.validation_failed', null, purchase.id);
    return { updated: false, reason: 'validation_failed' };
  }

  const status = purchase.status || 'unknown';
  const method = paymentMethod(purchase);
  const ts = now();
  const paidAt = isSuccessfulStatus(status) ? (purchase.payment?.paid_on || ts) : null;
  const detectedEnv = purchaseEnvironment(purchase, env);
  await env.DB.prepare(`UPDATE orders SET
      chip_status=?, status=?, payment_method=?, updated_at=?, environment=?,
      paid_at=CASE WHEN ? IS NOT NULL AND paid_at IS NULL THEN ? ELSE paid_at END,
      last_event_type=COALESCE(?, last_event_type), raw_json=?
      WHERE chip_purchase_id=?`)
    .bind(status, status, method, ts, detectedEnv, paidAt, paidAt, eventType, JSON.stringify(sanitizePurchase(purchase)), purchase.id).run();
  return { updated: true, environment: detectedEnv };
}

async function chipCallback(request, env) {
  await ensureSchema(env);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared && declared > MAX_CALLBACK_BODY) return json({ error: 'Payload too large' }, 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_CALLBACK_BODY) return json({ error: 'Payload too large' }, 413);

  const signature = request.headers.get('X-Signature');
  let verified = false;
  try { verified = await verifyChipSignature(env, raw, signature); } catch { verified = false; }
  if (!verified) {
    const fp = await requestFingerprint(request, env, 'chip-callback');
    await recordSecurityEvent(env, 'chip.callback.invalid_signature', fp);
    return json({ error: 'Invalid callback signature' }, 401);
  }

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const eventType = safeText(payload.event_type || `purchase.${payload.status || 'updated'}`, 120);
  const eventKey = `${payload.id || 'unknown'}:${eventType}:${payload.updated_on || payload.status || 'na'}`;
  const environment = purchaseEnvironment(payload, env);
  await env.DB.prepare(`INSERT OR IGNORE INTO callback_events
      (event_key, chip_purchase_id, event_type, received_at, payload_json, environment, signature_valid)
      VALUES (?, ?, ?, ?, '{}', ?, 1)`)
    .bind(eventKey, payload.id || null, eventType, now(), environment).run();

  const result = await applyPurchaseUpdate(env, payload, eventType);
  return json({ ok: true, applied: result.updated, environment });
}

async function syncOrderWithChip(env, order, source = 'manual.sync') {
  if (!order?.chip_purchase_id || !env.CHIP_SECRET_KEY) return order;
  try {
    const purchase = await chipFetch(env, `purchases/${encodeURIComponent(order.chip_purchase_id)}/`, { method: 'GET' });
    const result = await applyPurchaseUpdate(env, purchase, source);
    if (!result.updated) return order;
    return {
      ...order,
      status: purchase.status || order.status,
      chip_status: purchase.status || order.chip_status,
      payment_method: paymentMethod(purchase) || order.payment_method,
      environment: purchaseEnvironment(purchase, env),
      paid_at: isSuccessfulStatus(purchase.status) ? (purchase.payment?.paid_on || order.paid_at) : order.paid_at
    };
  } catch { return order; }
}

async function orderStatus(request, env) {
  await ensureSchema(env);
  const id = new URL(request.url).searchParams.get('order');
  if (!id || id.length > 64) return json({ error: 'Order ID diperlukan.' }, 400);
  let order = await env.DB.prepare(`SELECT id, chip_purchase_id, product_slug, product_name, amount_sen, currency, status, chip_status, payment_method, created_at, paid_at, environment FROM orders WHERE id=?`).bind(id).first();
  if (!order) return json({ error: 'Order tidak ditemui.' }, 404);
  if (!['paid','cleared','settled','refunded','cancelled','chargeback'].includes(order.status)) order = await syncOrderWithChip(env, order, 'return.verify');
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
async function constantTimeEqual(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(a))), crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(b)))]);
  const aa = new Uint8Array(ha), bb = new Uint8Array(hb);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function makeSession(secret) {
  const payload = b64urlEncode(JSON.stringify({ iat: now(), exp: now() + 14400, v: 2 }));
  const sig = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${sig}`;
}
async function validSession(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return false;
  const cookie = request.headers.get('Cookie') || '';
  const escaped = ADMIN_SESSION_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return false;
  const expected = b64urlEncode(await hmac(env.ADMIN_SESSION_SECRET, payload));
  if (!(await constantTimeEqual(expected, sig))) return false;
  try {
    const p = JSON.parse(b64urlDecode(payload));
    return p.v === 2 && p.exp > now() && p.iat <= now() + 60;
  } catch { return false; }
}

async function adminLogin(request, env) {
  await ensureSchema(env);
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({ error: 'Admin secrets belum dikonfigurasi.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Origin tidak sah.' }, 403);

  const fp = await requestFingerprint(request, env, 'admin-login');
  if (!(await allowRate(env, `admin-login:${fp}`, 8, 900))) {
    await recordSecurityEvent(env, 'admin.login.blocked', fp);
    return json({ error: 'Terlalu banyak cubaan. Cuba lagi kemudian.' }, 429);
  }

  let body;
  try { body = await parseJsonBody(request, 4096); } catch (e) { return json({ error: 'Permintaan tidak sah.' }, e.status || 400); }
  if (!(await constantTimeEqual(String(body.password || ''), String(env.ADMIN_PASSWORD)))) {
    await recordSecurityEvent(env, 'admin.login.failed', fp);
    return json({ error: 'Kata laluan salah.' }, 401);
  }

  await env.DB.prepare('DELETE FROM rate_limits WHERE key=?').bind(`admin-login:${fp}`).run();
  await recordSecurityEvent(env, 'admin.login.success', fp);
  const token = await makeSession(env.ADMIN_SESSION_SECRET);
  return json({ ok: true, environment: configuredEnvironment(env) }, 200, {
    'set-cookie': `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=14400`
  });
}

function adminLogout(request) {
  if (!sameOrigin(request)) return json({ error: 'Origin tidak sah.' }, 403);
  return json({ ok: true }, 200, {
    'set-cookie': `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  });
}

function environmentFilter(u, env) {
  const requested = safeText(u.searchParams.get('environment'), 10);
  if (requested === 'all') return null;
  if (requested === 'live' || requested === 'test') return requested;
  return configuredEnvironment(env);
}

async function adminSummary(request, env) {
  await ensureSchema(env);
  const u = new URL(request.url);
  const environment = environmentFilter(u, env);
  const where = environment ? 'WHERE environment=?' : '';
  const args = environment ? [environment] : [];
  const row = await env.DB.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status IN ('paid','cleared','settled') THEN amount_sen ELSE 0 END),0) AS revenue_sen,
    SUM(CASE WHEN status IN ('paid','cleared','settled') THEN 1 ELSE 0 END) AS paid_orders,
    SUM(CASE WHEN status IN ('initiated','created','viewed','pending_execute') THEN 1 ELSE 0 END) AS pending_orders,
    COUNT(*) AS total_orders,
    COUNT(DISTINCT CASE WHEN customer_email IS NOT NULL THEN lower(customer_email) END) AS customers
    FROM orders ${where}`).bind(...args).first();
  const top = await env.DB.prepare(`SELECT product_slug, product_name, COUNT(*) orders, COALESCE(SUM(amount_sen),0) revenue_sen
    FROM orders ${where ? where + ' AND' : 'WHERE'} status IN ('paid','cleared','settled')
    GROUP BY product_slug, product_name ORDER BY revenue_sen DESC LIMIT 10`).bind(...args).all();
  return json({ environment: environment || 'all', summary: { ...row, revenue: money(Number(row?.revenue_sen || 0)) }, products: top.results || [] });
}

async function adminOrders(request, env) {
  await ensureSchema(env);
  const u = new URL(request.url);
  const status = safeText(u.searchParams.get('status'), 30);
  const q = safeText(u.searchParams.get('q'), 100);
  const environment = environmentFilter(u, env);
  const args = [];
  const where = [];
  if (environment) { where.push('environment=?'); args.push(environment); }
  if (status && status !== 'all') { where.push('status=?'); args.push(status); }
  if (q) { where.push('(customer_email LIKE ? OR customer_name LIKE ? OR product_name LIKE ? OR id LIKE ? OR reference LIKE ?)'); const like=`%${q}%`; args.push(like,like,like,like,like); }
  const sql = `SELECT id, chip_purchase_id, product_slug, product_name, amount_sen, currency, customer_name, customer_email, customer_phone, status, chip_status, payment_method, reference, created_at, updated_at, paid_at, last_event_type, environment FROM orders ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`;
  const res = await env.DB.prepare(sql).bind(...args).all();
  return json({ environment: environment || 'all', orders: (res.results || []).map(o => ({ ...o, price: money(o.amount_sen) })) });
}

async function adminCustomers(request, env) {
  await ensureSchema(env);
  const u = new URL(request.url);
  const environment = environmentFilter(u, env);
  const q = safeText(u.searchParams.get('q'), 100);
  const args = [];
  const where = [];
  if (environment) { where.push('environment=?'); args.push(environment); }
  if (q) { where.push('(customer_email LIKE ? OR customer_name LIKE ?)'); const like=`%${q}%`; args.push(like, like); }
  const res = await env.DB.prepare(`SELECT lower(customer_email) AS email,
      MAX(customer_name) AS name,
      MAX(customer_phone) AS phone,
      COUNT(*) AS orders,
      SUM(CASE WHEN status IN ('paid','cleared','settled') THEN 1 ELSE 0 END) AS paid_orders,
      COALESCE(SUM(CASE WHEN status IN ('paid','cleared','settled') THEN amount_sen ELSE 0 END),0) AS revenue_sen,
      MAX(created_at) AS last_order_at,
      environment
    FROM orders ${where.length ? 'WHERE '+where.join(' AND ') : ''}
    GROUP BY lower(customer_email), environment
    ORDER BY last_order_at DESC LIMIT 200`).bind(...args).all();
  return json({ customers: (res.results || []).map(c => ({ ...c, revenue: money(Number(c.revenue_sen || 0)) })) });
}

async function adminWebhooks(request, env) {
  await ensureSchema(env);
  const u = new URL(request.url);
  const environment = environmentFilter(u, env);
  const where = environment ? 'WHERE environment=?' : '';
  const args = environment ? [environment] : [];
  const res = await env.DB.prepare(`SELECT event_key, chip_purchase_id, event_type, received_at, environment, signature_valid
    FROM callback_events ${where} ORDER BY received_at DESC LIMIT 100`).bind(...args).all();
  return json({ webhooks: res.results || [] });
}

async function adminSecurity(request, env) {
  await ensureSchema(env);
  const u = new URL(request.url);
  const environment = environmentFilter(u, env);
  const where = environment ? 'WHERE environment=?' : '';
  const args = environment ? [environment] : [];
  const res = await env.DB.prepare(`SELECT id, event_type, fingerprint, detail, created_at, environment
    FROM security_events ${where} ORDER BY created_at DESC LIMIT 100`).bind(...args).all();
  return json({ events: res.results || [] });
}

async function adminRefreshOrder(id, env) {
  await ensureSchema(env);
  const order = await env.DB.prepare(`SELECT id, chip_purchase_id, status, chip_status, payment_method, paid_at, environment, amount_sen, currency FROM orders WHERE id=?`).bind(id).first();
  if (!order) return json({ error: 'Order tidak ditemui.' }, 404);
  const synced = await syncOrderWithChip(env, order, 'admin.sync');
  return json({ order: synced });
}

async function serveAsset(request, env) {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  headers.set('content-security-policy', "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; upgrade-insecure-requests");
  const path = new URL(request.url).pathname;
  if (path.startsWith('/admin/')) {
    headers.set('cache-control', 'no-store');
    headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/health' && request.method === 'GET') {
        return json({
          ok: true,
          db: !!env.DB,
          chip: !!(env.CHIP_SECRET_KEY && env.CHIP_BRAND_ID),
          admin: !!(env.ADMIN_PASSWORD && env.ADMIN_SESSION_SECRET),
          environment: configuredEnvironment(env),
          live_payments_enabled: String(env.LIVE_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
        });
      }
      if (path === '/api/products' && request.method === 'GET') return json({ products: publicProducts(), environment: configuredEnvironment(env) });
      if (path === '/api/checkout/create' && request.method === 'POST') return createCheckout(request, env);
      if (path === '/api/chip/callback' && request.method === 'POST') return chipCallback(request, env);
      if (path === '/api/order/status' && request.method === 'GET') return orderStatus(request, env);

      if (path === '/api/admin/login' && request.method === 'POST') return adminLogin(request, env);
      if (path === '/api/admin/logout' && request.method === 'POST') return adminLogout(request);
      if (path.startsWith('/api/admin/')) {
        if (!(await validSession(request, env))) return json({ error: 'Unauthorized' }, 401);
        if (request.method === 'POST' && !sameOrigin(request)) return json({ error: 'Origin tidak sah.' }, 403);
        if (path === '/api/admin/summary' && request.method === 'GET') return adminSummary(request, env);
        if (path === '/api/admin/orders' && request.method === 'GET') return adminOrders(request, env);
        if (path === '/api/admin/customers' && request.method === 'GET') return adminCustomers(request, env);
        if (path === '/api/admin/webhooks' && request.method === 'GET') return adminWebhooks(request, env);
        if (path === '/api/admin/security' && request.method === 'GET') return adminSecurity(request, env);
        if (path === '/api/admin/products' && request.method === 'GET') return json({ products: publicProducts(), environment: configuredEnvironment(env) });
        const m = path.match(/^\/api\/admin\/orders\/([^/]+)\/refresh$/);
        if (m && request.method === 'POST') return adminRefreshOrder(decodeURIComponent(m[1]), env);
      }

      if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      return serveAsset(request, env);
    } catch (err) {
      console.error('poknik-worker-error', err?.message || err);
      return json({ error: 'Ralat backend. Cuba semula.' }, 500);
    }
  }
};

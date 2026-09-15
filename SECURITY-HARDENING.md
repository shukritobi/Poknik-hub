# Poknik Hub payment hardening

## Current mode

The default Worker configuration is deliberately locked to **test**:

- `PAYMENT_ENVIRONMENT = "test"`
- `LIVE_PAYMENTS_ENABLED = "false"`
- CHIP provider responses are checked using `Purchase.is_test`
- if the configured environment and CHIP environment do not match, the checkout is stopped and the Purchase is cancelled where possible
- existing orders created before environment tracking are treated as test orders
- the current RM78 / two PPBM payments are test records only

A separate named Wrangler environment now exists for production:

- environment: `production`
- Worker name: `poknik-hub-live`
- `PAYMENT_ENVIRONMENT = "live"`
- `LIVE_PAYMENTS_ENABLED = "false"` by default
- separate `DB` binding, intended to auto-provision a separate production D1 database on first production deployment

This means the existing test Worker and its test D1 do not need to be converted into the live system.

## Implemented controls

### Payment integrity

- Product prices are owned by the Worker, not the browser.
- CHIP secret and Brand ID remain server-side in Cloudflare secrets.
- CHIP success callbacks must pass RSA SHA-256 `X-Signature` verification before they are trusted.
- Callback Purchase data is checked against the local order for Brand ID, currency and amount.
- The return page re-checks the Purchase directly with CHIP when necessary.
- Duplicate callback events use idempotent event keys.
- Full CHIP callback payloads are not retained. Only operational event metadata is stored.
- Test and live orders are marked separately.
- Live payment activation has a second explicit gate using `LIVE_PAYMENTS_ENABLED`.
- A test/live mismatch detected from CHIP prevents checkout from continuing.

### Admin security

- Admin authentication uses a Cloudflare secret password.
- Session cookies use the `__Host-` prefix, `Secure`, `HttpOnly` and `SameSite=Strict`.
- Admin sessions expire after four hours.
- Session signatures use HMAC-SHA256 and constant-time comparison.
- Login attempts are rate-limited.
- Login failure/block events are recorded using a salted request fingerprint, not the raw IP address.
- State-changing admin requests must be same-origin.
- Admin pages are sent with `no-store` and `noindex` headers.
- The admin dashboard separates test/live reporting and exposes webhook/security logs.

### Public endpoint hardening

- Checkout creation is rate-limited.
- JSON and callback request sizes are capped.
- Cross-origin write requests are rejected.
- Provider error details are not exposed to the browser.
- Security headers are added to site/API responses, including HSTS, CSP, frame denial, nosniff, Referrer-Policy and Permissions-Policy.
- Public Worker preview URLs are disabled.

## Production separation

The production configuration is now defined in `wrangler.jsonc` as a named environment. Deploy it with:

```bash
npx wrangler deploy --env production
```

Do not use the default/test CHIP secrets for the production environment. Cloudflare/Wrangler environment secrets must be set separately.

See `PRODUCTION-LAUNCH.md` for the exact launch checklist.

## Before switching to live payments

1. Keep the current D1 database as test history.
2. Deploy `poknik-hub-live` with its own production D1 database.
3. Set production-only CHIP live Secret Key and live Brand ID.
4. Use a new long random `ADMIN_SESSION_SECRET` in production.
5. Put `/admin/*` and `/api/admin/*` behind Cloudflare Access.
6. Attach `poknik.my` to the live Worker.
7. Keep `LIVE_PAYMENTS_ENABLED=false` until the final review.
8. Confirm the production dashboard starts at RM0 / zero real orders.
9. Run the final controlled real payment only after all checks pass.
10. Once `poknik.my` is stable, disable the public `workers.dev` route for the live Worker if possible.

## Cloudflare Access

Protect `/admin/*` and `/api/admin/*` with an allow rule restricted to approved owner/admin email addresses. Keep the in-app password/session layer as defense in depth.

Do not place `/api/chip/callback` behind Cloudflare Access because CHIP must be able to reach it.

## Key handling

### Test Worker secrets

- `CHIP_SECRET_KEY`: CHIP test API key
- `CHIP_BRAND_ID`: CHIP test Brand ID
- `ADMIN_PASSWORD`: strong admin password
- `ADMIN_SESSION_SECRET`: randomly generated cryptographic value, preferably at least 32 random bytes

### Production Worker secrets

Create completely separate production values. In particular, generate a dedicated CHIP live API key specifically for Poknik Hub rather than reusing another integration key.

Never place secrets in:

- GitHub source
- `wrangler.jsonc` vars
- frontend JavaScript
- HTML
- screenshots
- chat/WhatsApp messages

The CHIP verification public key is not a secret and is fetched server-side from CHIP when needed.

# Poknik Hub payment hardening

## Current mode

The default Worker configuration is deliberately locked to **test**:

- `PAYMENT_ENVIRONMENT = "test"`
- `LIVE_PAYMENTS_ENABLED = "false"`
- CHIP provider responses are checked using `Purchase.is_test`
- if the configured environment and CHIP environment do not match, the checkout is stopped and the Purchase is cancelled where possible
- existing orders created before environment tracking are treated as test orders

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

### Admin security

- Admin authentication uses a Cloudflare secret password.
- Session cookies use the `__Host-` prefix, `Secure`, `HttpOnly` and `SameSite=Strict`.
- Admin sessions expire after four hours.
- Session signatures use HMAC-SHA256 and constant-time comparison.
- Login attempts are rate-limited.
- Login failure/block events are recorded using a salted request fingerprint, not the raw IP address.
- State-changing admin requests must be same-origin.
- Admin pages are sent with `no-store` and `noindex` headers.

### Public endpoint hardening

- Checkout creation is rate-limited.
- JSON and callback request sizes are capped.
- Cross-origin write requests are rejected.
- Provider error details are not exposed to the browser.
- Security headers are added to site/API responses, including HSTS, CSP, frame denial, nosniff, Referrer-Policy and Permissions-Policy.
- Public Worker preview URLs are disabled.

## Before switching to live payments

1. Keep the current D1 database as test history.
2. Create a separate production D1 database, recommended name: `poknik-hub-prod-db`.
3. Bind the production Worker to the production D1 database before taking real payments.
4. Replace CHIP test Secret Key and Brand ID with live credentials.
5. Change `PAYMENT_ENVIRONMENT` to `live`.
6. Change `LIVE_PAYMENTS_ENABLED` to `true` only after a final configuration review.
7. Run one low-value real transaction and confirm:
   - payment appears in CHIP
   - signed callback appears in Webhook Logs
   - order is marked live and paid in dashboard
   - customer and product totals are correct
8. Once `poknik.my` is attached and stable, consider disabling the public `workers.dev` route.

## Recommended additional perimeter protection

Put `/admin/*` and `/api/admin/*` behind **Cloudflare Access** with an allow rule restricted to the owner's Cloudflare account or approved email address. Keep the in-app password/session layer as defense in depth.

Do not place `/api/chip/callback` behind Cloudflare Access because CHIP must be able to reach it.

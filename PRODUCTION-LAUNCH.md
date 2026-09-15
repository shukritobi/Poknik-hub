# Poknik Hub production launch runbook

This repository now has two payment environments:

- default Worker: `poknik-hub` — TEST only
- named Wrangler environment: `production` — deploys as `poknik-hub-live`

The production environment is deliberately shipped with `LIVE_PAYMENTS_ENABLED = "false"` so deploying it cannot take real payments until the final switch is made.

## 1. Test environment

Keep the existing Worker and D1 database unchanged. Existing RM78 / two PPBM orders are test history.

Required test Worker secrets:

- `CHIP_SECRET_KEY` — CHIP test API key
- `CHIP_BRAND_ID` — CHIP test Brand ID
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET` — long random cryptographic value

Do not copy the test CHIP credentials into production.

## 2. Production Worker and D1

Production is defined in `wrangler.jsonc` under `env.production` with a separate `DB` binding. Cloudflare Wrangler automatic provisioning can create a separate D1 resource when the production environment is deployed for the first time.

Deploy command:

```bash
npx wrangler deploy --env production
```

Expected Worker name:

```text
poknik-hub-live
```

The production D1 must remain separate from the default/test D1.

## 3. Production secrets

Set these specifically on the production environment. Wrangler environment secrets are separate from the default Worker secrets.

```bash
npx wrangler secret put CHIP_SECRET_KEY --env production
npx wrangler secret put CHIP_BRAND_ID --env production
npx wrangler secret put ADMIN_PASSWORD --env production
npx wrangler secret put ADMIN_SESSION_SECRET --env production
```

Use a new CHIP live API key created specifically for Poknik Hub and the live Brand ID. Never put either value into GitHub, HTML, JavaScript, README files, screenshots or chat messages.

Keep `LIVE_PAYMENTS_ENABLED=false` during setup.

## 4. Cloudflare Access

Protect the admin perimeter before production use.

Create self-hosted Access applications for the actual admin hostname/path:

- `/admin/*`
- `/api/admin/*`

Allow only the approved owner/admin email account(s). Keep the existing in-app password as a second layer.

Do NOT protect:

- `/api/chip/callback`
- `/api/order/status`
- `/api/checkout/create`
- customer-facing checkout/thank-you routes

CHIP must be able to reach `/api/chip/callback` without an interactive Access login.

If both `poknik.my` and `www.poknik.my` are used, protect the admin routes on both hostnames or redirect one hostname permanently to the canonical host.

## 5. Domain and workers.dev

Attach the final custom domain to `poknik-hub-live` only after the production Worker is healthy.

Recommended canonical origin:

```text
https://poknik.my
```

After the custom domain is confirmed stable, disable the public `workers.dev` route for the live Worker if operationally possible.

## 6. Pre-live tests

Before using live credentials, finish all CHIP tests on the default/test Worker:

1. Successful payment
2. Failed payment
3. Cancelled payment
4. Signed CHIP callback visible in Admin > Webhook Logs
5. Invalid callback signature is rejected
6. Duplicate callback does not duplicate an order/event
7. Wrong amount / wrong Brand ID cannot mark an order paid
8. Admin login throttles repeated bad passwords
9. Test transactions remain labelled TEST and do not appear as live revenue

## 7. Final live activation

After the production Worker has its own D1, Cloudflare Access, live CHIP credentials and custom domain:

1. Confirm `/api/health` on production shows DB, CHIP and admin configured.
2. Confirm production dashboard starts at RM0 and zero real orders.
3. Confirm the live CHIP key and Brand ID belong to Poknik Hub.
4. Change the production environment only to `LIVE_PAYMENTS_ENABLED=true`.
5. Deploy production again.
6. Perform one controlled real transaction.
7. Verify it in CHIP, D1 dashboard and Webhook Logs.
8. Confirm the order is tagged LIVE and the test dashboard remains unchanged.

## Emergency rollback

If anything looks wrong:

1. Set `LIVE_PAYMENTS_ENABLED=false` in production.
2. Redeploy production.
3. Do not rotate/delete the D1 database.
4. Preserve the affected order and webhook logs for investigation.
5. Rotate the CHIP API key immediately if key exposure is suspected.

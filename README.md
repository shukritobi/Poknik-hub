# Poknik Hub

Concept prototype for a unified Poknik digital-business ecosystem.

Live concept: https://shukritobi.github.io/Poknik-hub/

## Purpose

Poknik currently has knowledge and products spread across social posts, WhatsApp/Telegram communities, older sales pages, course videos and affiliate offers. Poknik Hub is designed to become the central layer that organizes all of them without forcing Poknik to abandon channels that already work.

## Demo scope

The current GitHub Pages build demonstrates:

- Audience-first onboarding: side income, sales, selling skill, team/system
- Current flagship feature area for Bimbingan EastelPoknik
- Product catalogue with current/archive filters
- Searchable knowledge-library concept
- Member dashboard concept
- Affiliate dashboard concept
- Community funnel from Threads into WhatsApp/Telegram
- Mobile-responsive landing experience

All product status, prices, course names and availability must be confirmed by Poknik before any official launch.

## Recommended production architecture

### Frontend
- Next.js or Astro
- Cloudflare Pages
- Mobile-first PWA-friendly member experience

### API
- Cloudflare Workers
- Hono/TypeScript API layer
- Webhooks for payment providers

### Database
Cloudflare D1 as the central relational database.

Core entities:
- users
- products
- product_versions
- purchases
- entitlements
- courses
- modules
- lessons
- lesson_progress
- content
- content_tags
- communities
- affiliates
- referral_links
- referral_clicks
- commissions
- payouts
- payment_events

### File/video delivery
- Cloudflare R2 for PDFs, workbooks and downloadable assets
- Cloudflare Stream or another protected video service for paid videos
- Signed/private URLs for member-only assets

### Authentication
- Email magic link or OTP
- Optional Google login
- One account across every product

### Payments
Phase 1 should not break Poknik's existing checkout flow. Existing payment pages can continue while successful-payment events are imported into Poknik Hub.

Phase 2 can move to a unified checkout using whichever Malaysian gateway is selected, while preserving historical purchases.

### Entitlement flow

1. Customer buys a product
2. Payment provider sends webhook
3. Poknik Hub stores purchase
4. Appropriate entitlement is created
5. Member receives access automatically
6. Course/library appears in dashboard
7. Affiliate commission is created when applicable

### Affiliate engine

Each affiliate receives a stable referral ID. The system tracks attribution separately from checkout so Poknik can support multiple products and gateways.

Suggested features:
- Per-product commission rules
- Fixed or percentage commission
- Cookie/referral attribution window
- Click and conversion analytics
- Pending/approved/paid commission states
- Payout batches
- Anti-self-referral checks
- Affiliate creative library

## Knowledge engine

Poknik's long-term differentiator should be the accumulated knowledge archive, not only the course catalogue.

Content sources:
- Threads posts
- Telegram posts
- WhatsApp voice-note transcripts where approved
- Recorded classes
- YouTube/video archive
- Blog posts
- Existing modules
- PDFs/ebooks

Every content item should be tagged by topic, audience stage and format so users can search things like closing, agent, customer avatar, RM3k sales, affiliate, team, follow-up and sales cycle.

Later, semantic search can sit on top of the same library.

## Funnel

Threads / short content
→ Poknik Hub free knowledge
→ WhatsApp/community
→ targeted programme page
→ checkout
→ member dashboard
→ course completion
→ affiliate/referral
→ next relevant programme

## Rollout plan

### Phase 0 — concept
Current GitHub Pages prototype.

### Phase 1 — asset audit
Get Poknik to provide a rough list of every active/old product, checkout link, video folder, Telegram/WhatsApp group, ebook and recording. Categorize everything as Active / Archive / Free / Paid / Affiliate-enabled.

### Phase 2 — public hub
Launch a real domain with product pages, knowledge library, content import and lead capture. Existing checkout links can remain in place.

### Phase 3 — member account
Add login, purchase entitlements, lesson progress, downloads and community access.

### Phase 4 — unified payments
Connect webhooks and migrate checkout into one transaction layer where appropriate.

### Phase 5 — affiliate engine
Referral URLs, commissions, reporting, payout approval and affiliate content library.

### Phase 6 — automation
Auto-import selected public content, generate searchable summaries/tags, email/WhatsApp follow-up journeys, abandoned-checkout recovery and personalized next-product recommendations.

## What we need from Poknik after he approves the concept

No spreadsheet required. A WhatsApp dump is enough:

1. Name of every product/program
2. Current price
3. Active or no longer sold
4. Existing sales/checkout URL
5. Where the learning material is stored
6. Community/group link
7. Whether affiliate is available and commission rule
8. Any logos, photos, testimonials or brand assets he wants used

From there the catalogue and migration map can be built systematically.

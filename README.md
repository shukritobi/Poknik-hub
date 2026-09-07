# Poknik Hub

Concept prototype for a unified Poknik digital-product and knowledge ecosystem.

Live concept: https://shukritobi.github.io/Poknik-hub/

## Current prototype

The homepage is now a discovery layer that routes visitors into niche-specific product pages. The earlier member/affiliate dashboard preview has been removed from the public landing page so the homepage stays focused on product discovery and conversion.

### Dedicated funnels

- `/produk/eastelpoknik/` — Bimbingan EastelPoknik, current 3-year mentoring offer
- `/produk/14-hari-bisnes-online/` — 14 Days Dropship / 14 Hari Bisnes Online
- `/produk/modul-bisnes-konsisten/` — working-title page for the PoknikDigital module promoted in 2025; exact title/offer needs Poknik confirmation
- `/produk/bimbingan-bisnes/` — Program Bimbingan Bersama Poknik archive
- `/produk/dropship-with-poknik/` — Dropship With Poknik / Poknik Empire career-roadmap archive
- `/produk/membina-momentum-bisnes/` — Membina Momentum Bisnes ebook/content concept archive
- `/produk/100-video-bisnes/` — free 100+ business-video library / lead-magnet concept
- `/produk/export-mudah/` — Export Mudah V2 collaboration archive
- `/produk/master-sales-cycle/` — Master Sales Cycle by Tuan Azman, clearly labeled as a Poknik-recommended resource rather than an original Poknik product

All product status, prices, course names, bonuses, affiliate rates and availability must be confirmed by Poknik before any official launch.

## CRO principles used in the prototype

The pages were deliberately not cloned from one generic template at copy level. They share a design system for maintainability, while the promise, pain points, proof hierarchy, objections and visual tone are tailored to the audience of each product.

Common principles:

- Match the landing-page headline to the intent that brought the visitor there
- Lead with one primary problem and one primary next step
- Use simple, scannable copy instead of long jargon-heavy paragraphs
- Show the mechanism behind the offer, not only features such as number of videos
- Put important price/commitment information before checkout rather than surprising users later
- Keep CTA wording specific to what happens next
- Use historical claims only with context; do not turn old revenue examples into present-day guarantees
- Separate Poknik-owned products, collaborations and products he merely recommended
- Use FAQs to resolve high-friction questions before a WhatsApp conversation
- Mobile-first layout with a single sticky CTA on product pages
- Free content routes to the next most relevant lesson/product rather than immediately hard-selling every visitor

## Source-asset reuse

Where useful and publicly available, the prototype reuses or embeds assets from historical product pages, including:

- Program Bimbingan Poknik images from the original Blogspot/Imgur assets
- Export Mudah V2 ecover and team image from the original JV Warrior page
- The historical 14 Days Dropship YouTube promo

For production, assets should be migrated into Poknik-controlled storage after ownership/permission is confirmed, rather than relying on external hotlinks.

## Recommended production architecture

### Frontend
- Astro or Next.js
- Cloudflare Pages
- Mobile-first public funnels and member experience

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
Phase 1 should not break existing checkout flows. Current payment pages can continue while successful-payment events are imported into Poknik Hub.

Phase 2 can move to a unified checkout using the selected Malaysian gateway while preserving historical purchases.

### Entitlement flow

1. Customer buys a product
2. Payment provider sends webhook
3. Poknik Hub stores purchase
4. Appropriate entitlement is created
5. Member receives access automatically
6. Purchased material appears after login
7. Affiliate commission is created when applicable

The member system remains part of the production roadmap, but is intentionally not shown as a large fake dashboard on the public homepage.

## Affiliate engine

Each affiliate receives a stable referral ID. Attribution remains separate from checkout so Poknik can support multiple products and gateways.

Suggested features:
- Per-product commission rules
- Fixed or percentage commission
- Referral attribution window
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

Every content item should be tagged by topic, audience stage and format so users can search things like closing, agent, customer avatar, affiliate, team, follow-up and sales cycle.

## Funnel

Threads / short content
→ niche-matched Poknik Hub page or free knowledge
→ useful content / programme explanation
→ checkout or WhatsApp
→ member access
→ course completion
→ affiliate/referral
→ next relevant programme

## What we need from Poknik next

No spreadsheet required. A WhatsApp dump is enough:

1. Name of every product/program
2. Current price
3. Active or no longer sold
4. Existing sales/checkout URL
5. Where the learning material is stored
6. Community/group link
7. Whether affiliate is available and current commission rule
8. Logos, photos, sales videos, screenshots, testimonials and covers he has permission to use
9. Which old collaborations he is still allowed to promote

From there we can replace all historical/provisional information with the real 2026 catalogue and wire the actual conversion/payment flows.

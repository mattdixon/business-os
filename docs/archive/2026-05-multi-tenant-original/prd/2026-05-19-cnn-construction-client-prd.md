# PRD — CNN Construction (Client Implementation)

**Status:** Draft v1 (several open questions — see §11)
**Date:** 2026-05-19
**Author:** Matt Dixon (mattdixon)
**Platform:** Business OS — see [Framework PRD](./2026-05-19-business-os-framework-prd.md)

---

## 1. About the client

**CNN Construction** — concrete construction company. Bids on commercial and/or public concrete projects (the exact mix is an open question — see §11). Currently runs core file storage on **Dropbox**.

(More about CNN — company size, # of estimators, geography, current toolchain — to be captured during discovery.)

## 2. Problem CNN wants solved

CNN spends significant estimator time on two activities that are repetitive, slow, and have a long tail of low-value work:

1. **Finding projects to bid on** — searching plan rooms, bid sites, government RFPs, builder/GC announcements, etc., qualifying which are worth pursuing, and getting the relevant documents into Dropbox.
2. **Writing proposals** — researching the project and prospect, gathering CNN's past similar projects as references, and producing a written proposal under deadline.

Both tasks are bottlenecked on a small number of senior estimators who could otherwise be doing higher-leverage work (relationship-building, site visits, complex pricing).

## 3. Goal for v1

Ship two production modules on the Business OS platform that materially reduce the time estimators spend on prospecting and proposal-drafting, while keeping CNN's existing Dropbox workflow intact.

## 4. Target users at CNN

| Role | What they do | What they need from the system |
|---|---|---|
| Estimator | Finds and qualifies bid opportunities; writes proposals | Prospector daily digest; proposal-drafting assistant; everything stored in Dropbox where the rest of the team can see it |
| Estimator Lead / Owner | Reviews proposals; approves submissions | Visibility into pipeline; able to review/edit AI-drafted proposals before they go out |
| Admin (likely the owner or office manager) | Configures the system, invites people | Connect Dropbox + email; manage users; see audit log |

## 5. Modules

### 5.1 Prospector module

**Purpose:** Surface qualified bid opportunities daily, with enough context that an estimator can decide go/no-go in under 60 seconds per opportunity.

**Core capabilities (v1):**
- Configurable lead sources (which sites/RSS/RFP feeds to monitor — exact list TBD with CNN; e.g. SAM.gov, state/local procurement portals, ConstructConnect, Dodge, builder/GC announcement pages)
- Daily digest of new opportunities matched against CNN's criteria (geography, project size, project type)
- Per-opportunity record: source link, deadline, project description, location, estimated size, attached docs
- "Save to Dropbox" action: copies the opportunity's source docs into a structured Dropbox folder
- Status: New → Reviewing → Pursuing → Submitted → Won/Lost (the latter two come from the Proposal module)
- Email and/or in-app notification for high-fit matches

**Out of scope (v1):**
- Automated pricing or takeoff
- CRM relationship tracking (just opportunity tracking)
- Competitor analysis

**Open questions:** which specific sources, what geographic/size filters, who sets the criteria (one shared set or per-estimator).

### 5.2 Proposal Automation module

**Purpose:** Reduce time-to-draft for a proposal from hours to minutes by automating research and first-draft writing, while keeping the estimator in control.

**Core capabilities (v1):**
- Start from a Prospector opportunity OR from a manual "new proposal" action
- Research stage: gather public info about the prospect (their website, recent projects, news), assemble references from CNN's prior similar projects in Dropbox
- Draft stage: produce a first-draft proposal using CNN's template, prior winning proposals, and the gathered research
- Review stage: estimator/owner reviews and edits in-app
- Output: finished proposal written back to Dropbox in the project's folder, with a record of who approved when
- Audit trail of edits, prompts, and references used

**Out of scope (v1):**
- Pricing/numbers (estimator still enters dollars)
- Submission delivery (no auto-submit; estimator does the actual send)
- Multi-language

**Open questions:** what template format CNN currently uses (Word? Google Docs? something else?), how granular the "approve" step needs to be, whether redlining/track-changes is required.

### 5.3 Email integration (status: maybe v1, maybe later)

**If included:** uses the framework's email connector to (a) ingest bid announcements emailed to CNN's bid inbox into the Prospector, and (b) send proposals via the estimator's own email account.

**Decision needed:** is email plumbing required for v1 of CNN, or can v1 ship with manual upload + Dropbox-only output?

## 6. Integrations

| Integration | Purpose | Provider in v1 |
|---|---|---|
| File storage | All project artifacts; proposal output | **Dropbox** (already used by CNN — non-negotiable) |
| Email (optional v1) | Inbound bid notifications; outbound proposals | TBD (likely Microsoft 365 or Gmail depending on CNN's existing setup) |
| Lead sources | Prospector inputs | RSS feeds + targeted scrapers; specific list TBD |
| AI provider | Research and drafting | Anthropic Claude (per platform convention) |

## 7. Permissions

| Role | Permissions |
|---|---|
| Admin | All capabilities; connector config; user management; module config |
| Estimator | Use Prospector + Proposal modules; create/edit own proposals; read all opportunities |
| Estimator Lead | Estimator + approve proposals; reassign opportunities |
| Viewer (optional) | Read-only across opportunities + proposals |

## 8. Success Metrics (CNN-specific)

1. **Prospecting time:** Time per estimator per week spent on prospecting decreases by ≥ 50% within 8 weeks of launch (vs. self-reported baseline).
2. **Proposal time:** Median time from "decided to bid" to "first reviewable draft" drops to under 30 minutes.
3. **Coverage:** At least one estimator-validated qualified lead per business day surfaced by Prospector.
4. **Adoption:** ≥ 80% of new bids in the first 60 days flow through the platform (vs. side-channel).
5. **No regression:** Existing Dropbox workflow continues to work for non-platform users (PMs, field, accounting).

## 9. Non-goals
- Replacing CNN's accounting, scheduling, or PM systems.
- Becoming a CRM for general construction sales.
- Automating pricing — estimators still own the numbers.

## 10. Risks
| Risk | Mitigation |
|---|---|
| AI-drafted proposals embarrass CNN if sent without review | Hard "approve before output" gate; clear UI affordance that it's a draft until approved |
| Lead sources have ToS that prohibit scraping | Audit each source legally before adding; prefer RSS/official APIs |
| Estimators reject the tool if drafts are bad | Pilot with one estimator first; iterate template + prompts before broad rollout |
| Dropbox folder structure conflicts with CNN's current convention | Match CNN's existing structure; do not impose ours |
| CNN's prior proposals contain confidential numbers that shouldn't be in prompts | Redaction step before sending to AI |

## 11. Open Questions for CNN Discovery
- Company size, # of estimators, typical # of bids/month.
- Geographic markets and typical project size band.
- Current bid sources used (which to integrate first).
- Current proposal template/format and who owns it.
- Existing email provider (O365 vs Gmail vs other).
- Existing Dropbox folder convention.
- Who at CNN signs off on AI-drafted output.
- Compliance/legal constraints (CMR, public-bid disclosure rules, etc.).
- Budget for AI API spend / which Claude model tier is acceptable.
- Hard launch date or pilot timeline.

---

## 12. Related documents
- [Framework PRD](./2026-05-19-business-os-framework-prd.md)
- [Foundation Design (technical spec)](../superpowers/specs/2026-05-19-business-os-foundation-design.md)
- [CLAUDE.md](../../CLAUDE.md)

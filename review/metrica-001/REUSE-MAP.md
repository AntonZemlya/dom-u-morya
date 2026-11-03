# METRICA-001 R3 — reuse map, 02.11.2026

Assignment: owner-supplied `METRICA-001-master-prompt-R3.md` (01.11.2026), replacing R1/R2.
Destination base: `44bd83f87e5ff7c184c15f24ac300fc285842156`, `main`.
Donor: `AntonZemlya/rehab-profi`, **fixed ref** `ab3e365bab8308567e5d9f2dd5afbd9b2ae50e9d`.
The donor checkout/branch and unrelated reports were not changed. The donor master PHP
is not claimed byte-identical to its live runtime.

| Source at fixed donor ref | Destination | Preserved / adapted / fixed |
| --- | --- | --- |
| `web/source/privacy/core.js` | `privacy/core.js` | Preserved versioned choice, expiry, fail-closed, epoch/AbortController lifecycle. Added server receipt reuse and linked withdrawal. Adapted actual routes, neutral estate campaign slugs and site-authored anchors. |
| `web/source/privacy/metrica.js` | `privacy/metrica.js` | Preserved abortable CORS fetch with recheck before synchronous vendor execution; init/deferred single hit, fixed payload-free goals, destruct and targeted cleanup. Adapted endpoint response checks and actual documented first-party storage keys. |
| `web/source/privacy/privacy.js` | `privacy/privacy.js` | Preserved banner/settings/native dialog, keyboard/focus, storage/pageshow/visibility refresh. Adapted branding/text, five events, retry on foreground/online and withdrawal status. Removed clinic overlay integration. |
| `web/source/privacy/privacy.css` | `privacy/privacy.css` | Adapted only consent UI to site's ivory/green typography and four target widths; no clinic styles imported. |
| `web/server/metrica-receipt.php` | `api/analytics-core.php` | Preserved SQLite3/prepared statements/BEGIN IMMEDIATE/busy timeout, minimal data, bounded JSON, strict origin/host/HTTPS, no-store, permissions/symlink checks and global write cap. Fixed 24h repeat-visit defect with separate allow/validate/withdraw; hashed capability, immutable document SHA, original server date/expiry, idempotency and withdrawal tombstones. |
| `web/server/metrica-receipt-entry.php` | `api/analytics-consent.php` | Reused fixed private-path/isolation principle, adapted to current PHP API layout. No clinic rewrite, release ID, SetHandler, secret or database copied. Helpers return 404 on direct HTTP. |
| `web/qa/privacy/privacy.test.mjs` | `tests/analytics.test.mjs` | Reused memory storage/adapter fixtures and data-driven fail-closed, delayed response and raw URL/referrer test design; added explicit-action-only grant issuance and receipt reuse. |
| `web/qa/privacy/metrica-receipt.test.php` | `tests/analytics.test.php` | Adapted real SQLite/private fixture and actual standalone CLI test; added 25/48h/expiry, idempotency, concurrency, busy/corrupt/path failures and withdrawal races. |
| `web/qa/privacy/metrica-apache.test.mjs` | Existing security/release suites + `tests/analytics-browser.cjs` | Reused isolation invariant, not donor Apache rules. Existing exact `.htaccess` guard and release/rollback tests retained. |
| `web/local/verify-metrica-consent.mjs` | `tests/analytics-browser.cjs` | Adapted isolated Chromium/all-network interception, actual public tag.js fixture, neutral source/PII markers and nohit distinction. Actual destination PHP entry runs in a temporary hosting-shaped directory on loopback. |
| `reports/analytics/METRICA_ATTRIBUTION_2026-10-28.md`, `docs/analytics/TRAFFIC_TAGGING.md` | `PROTOCOL.md`, `VALIDATION.md` | Preserved attribution/race/network lessons; no clinic route/campaign vocabulary imported. |

No complete donor site, Symfony, callback/mail, actual consent rows, provider config,
OAuth/cookies or clinic counter was imported. Existing form API/SMTP implementation
and its consent version **2026-10-31** are byte-identical to base. Main application
changes are payload-free analytics event hooks and replacement of the old informational
banner. Historical banner storage is not read/migrated/deleted.

Context scan: target #4 (operator/legal), #18 (email retention stays separate), PR #17
(FORM-004), PR #20/#19 (accepted form success semantics); current README supersedes
historical unmerged/deployment notes. Target METRICA search found no execution Issue;
the explicit R3 owner assignment authorizes this single scoped Draft PR. No unrelated
open discussion was implemented. Durable findings are promoted here, `PROTOCOL.md`,
`COUNTER-SETUP.md`, `VALIDATION.md` and `ROLLOUT.md`; #18 remains unchanged.

Sites was explicitly selected. Its local-source workflow was used; native Sites hosting
runs Workers and does not replace this task's PHP/SQLite/Jino contract. No hosted Site,
new deployment target or production preview URL was created.

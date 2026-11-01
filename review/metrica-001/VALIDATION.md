# METRICA-001 — validation, 02.11.2026 (МСК)

Base: `44bd83f87e5ff7c184c15f24ac300fc285842156`. Final head is the Draft PR commit.

| Gate | Result |
| --- | --- |
| `npm run ci:fast` | **PASS**, 10 required checks, 5.38s |
| `PHP84_BIN=… PHP84_CGI_BIN=… npm run ci:full` | **PASS**, 30 required checks, 195.59s |
| `git diff --check` | **PASS** |
| Privacy unit/contracts | **8 tests PASS**, malformed/storage/expiry/version, no forged startup issuance, lifecycle/late response, URL/referrer, immutable text |
| Real PHP SQLite | **35 assertions PASS**, 25h/48h/expiry, original date, no renewal/duplicate allow, two concurrent grants, withdrawal/tombstone, invalid token/version/purpose, busy/corrupt/permissions/symlinks, actual CLI |
| Chromium | **320/390/768/1440 PASS**, initial deny/no server record, one init/hit, actual internal tagged legal navigation, reload/second page/tab, withdraw/failed-write retry, keyboard/dialog, five goals, genuine PDF issuance and mocked lead202/503 |
| Public PHP entry | Local hosting-shaped fixture; actual entry/derived private namespace; helpers404, GET405 no DB, foreign Origin/Host/HTTP403, no open CORS |
| Current vendor | **PASS**, real public tag.js, all network intercepted, one counted pageview excluding `nohit=1`; real UTM/yclid preserved, no form/title/contact/capability markers in captured payload |
| Existing form/SMTP | **90 assertions PASS**, fake TLS SMTP only; browser/MIME/replay/negative flows retained |
| Release manager | **48 tests PASS**, including analytics mutable-state byte preservation after rollback and absence from backup |
| Apache/TLS/security | **PASS**, 11 legacy unit checks + actual local Apache/PHP CGI/TLS guard/publication/rollback |
| Public build/SEO/catalog | **PASS**, explicit allowlist, reproducible build, local references, 28 lots, PDF, frozen hero, SEO and performance |

CLI: PHP **8.4.27**, OpenSSL/ctype/SQLite3. Existing CGI harness: PHP **8.4.14**.
Node 22.23.2, separate Playwright Chromium; personal Chrome used only for the authorized
Yandex account setup, never for tests. No production POST/SMTP/analytics events or
Jino writes, no DNS/cron/deploy/merge. Rehab Profi checkout remains unchanged.

Fresh public vendor: **223597 bytes**, SHA-256
`4f9e17b24d50336d535ff25a67196c174b60e394e715602c71b01c7956b772b3`;
Last-Modified 30.10.2026 12:13:39 UTC, fetched response Date 01.11.2026 22:06:49 UTC
(02.11 МСК), `Access-Control-Allow-Origin: *`. Current production **HEAD only** returned
200 without a CSP header; no JavaScript ran. The tracked `.htaccess` is unchanged and
no inline-script/TLS exception was introduced. Future vendor/CSP is not covered by
this historical check. [Sanitized network evidence](NETWORK-EVIDENCE.json) contains no
raw payload/visitor IDs, session/cookies or complete headers. Full CI now fails if the
required real-vendor fixture is absent; standalone mock-only mode is labelled honestly.

One initial full attempt found the old archived release allowlist lacked new paths.
Only the exact new public paths/endpoints were added; the protection suite passed and
the final full run above is green. Earlier intermediate runs are not the final floor.

Raw test logs, screenshots and vendor fixture remain in ignored `.test-output/`.
Counter/goals were actually created/read back; general settings are **not verified**
(SETTINGS_UI_UNAVAILABLE, see COUNTER-SETUP). That blocker, legal approval, provisioning,
real post-release visits and verified provider cleanup schedule remain open. No claim
of production readiness is made. `analyticsEnabled=false`, policy/vendor flags=false.

Context / knowledge preservation: #4/#18 and PR17/20 determined operator/form/SMTP
boundaries; the R3 assignment and donor attribution report determined reuse. Durable
results are promoted to REUSE-MAP, PROTOCOL, COUNTER-SETUP, NETWORK-EVIDENCE, this file
and ROLLOUT. No changes to source project strategy or email-retention implementation.

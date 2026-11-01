# METRICA-001 — receipt protocol and boundaries

## Server contract

`POST /api/analytics-consent.php`, strict same origin/host and trusted Jino HTTPS proxy
header, JSON <=512 bytes, no open CORS, no-store/nosniff. Direct helper requests return
404; GET endpoint returns 405 without creating directories/database. Filesystem location
is derived from the site's fixed hosting layout, never supplied in requests.

- `allow`: `{action, clientTime, token, consentVersion, purpose}`. Issuance is allowed
  only in memory after a new explicit choice; reconstructed/local fabricated `granted`
  records can only **validate**, never mint a new receipt. A freshly generated 256-bit
  capability makes network/double-click retries idempotent. `clientTime` has a 5-minute
  freshness window only for explicit issuance; server fixes original grant date/expiry.
- `validate`: `{action, token, consentVersion, purpose}`. Requires existing, current-version,
  matching-document, unexpired, non-withdrawn grant. No new grant/renewal/date substitution.
  Reload/pages/legal navigation/other tab reuse it, including 25h and 48h later.
- `withdraw`: same fields as validate. Client stops immediately, aborts pending work and
  clears known accessible Metrica stores. Server marks the **same** row, preserving
  original grant date. Idempotent retries cannot change withdrawal time. A withdrawal
  arriving before an in-flight allow creates a tombstone with `granted_at_ms=NULL`;
  late allow cannot turn it into a grant. A tombstone does not assert a grant occurred.

Only SHA-256 of the random capability is stored server-side. It is neither an account/
identity proof nor an identifier sent to Yandex. Same-origin JSON/Origin checks protect
server operations; possession of the unpredictable capability authorizes validation/
withdrawal. No raw IP, User-Agent, contacts, request body or lead ID in this database.
Initial denial has no capability, request or server row. Global bound: 1000 new rows/hour,
no per-visitor fingerprint. SQLite lock timeout: 1800ms, transaction: BEGIN IMMEDIATE.

DDL is canonical in `api/analytics-core.php`: a single `analytics_receipts` table with
`token_hash` PK, unique random `receipt_id`, first-operation time, nullable original
`granted_at_ms`, `expires_at_ms`, `consent_version`, `document_sha256`, `purpose`, nullable
`withdrawn_at_ms` and `purge_at_ms`; indices on creation and purge times. No historical
schema migration is needed: this is a new empty database. Duplicate validates create
no rows. Tombstones expire after 30 days; an old issuance replay then fails freshness.

## Choice, retention and retry

Independent key: `domUMorya_analyticsConsent_v1`. No old banner compatibility. The browser
stores choice/version/purpose/time/expiry, plus only capability/operation when needed.
Server replies supply original date and expiry. Choice/consent: 180 days maximum.
Proposed evidence retention: until expiry +30 days, or withdrawal +30 days. Those 30 days
are an operator policy proposal, **not a universal statutory rule**. Yandex cookie/data
and provider backup lifetimes are separate; operator approval is a release gate.

Immutable text: `ops/analytics/consent-analytics-2026-11-02-v1.txt`, version
`analytics-2026-11-02-v1`; SHA-256
`326b9cbfd650e78ff95fe4761e78e0790dd6af00e858b661471e5cbbddddbcbc`.
Server nowdoc is checked against these exact bytes. New purposes/text require a new
revision and approval. Form consent stays `2026-10-31` with its existing SMTP evidence.

A failed withdrawal stays withdrawn with its capability for retry on online/pageshow/
visibility and reopening settings. New allow is blocked until acknowledgment. In-flight
retry and online overlap is handled without reactivation. If browser storage refuses
writes, stop remains in effect in the current document and withdrawal is attempted from
memory; persistence across a closed browser cannot be guaranteed when both network and
storage are unavailable. Clear site data/use operator contact in that exceptional case.
Already sent data and inaccessible third-party cookies are not claimed deleted.

CLI: install the matching `ops/analytics/expire.php` and `api/` modules under the private
analytics runtime; run `php expire.php --expire` using a verified PHP with SQLite3.
It opens only an existing database, transactionally deletes `purge_at_ms <= now`, and
returns nonzero on failure. Request writes also purge due rows. A local real CLI PASS
does not prove a provider schedule exists; no production cron was created.

## Attribution and vendor boundary

Fixed real site routes and authored anchors replace clinic routes. Neutral lower-case
ASCII source/campaign slugs (including `dom_u_morya`, unknown estate partners and AI
sources) and supported provider click IDs are preserved byte-for-byte in the hit; no
fabricated referrer or query stripping. Duplicate/unknown query keys, escapes, apparent
contacts/tokens/private markers and unsafe raw referrers/fragments block vendor loading.
Safe internal campaign query is validated and preserved on real same-origin legal navigation.
Root external referrers are accepted, including unknown partners; external deep links/
queries are deliberately blocked because tag.js can read the real document.referrer.

Syntax cannot establish that an arbitrary lower-case campaign slug contains no person's
name. Free text, encoded/Cyrillic labels, some legitimate ad IDs and external deep-link
referrers are lost. Campaign authors must use neutral non-personal labels; this is not
an arbitrary raw passthrough guarantee. Actual source/campaign reporting needs a separately
authorized post-release visit. Fields/amounts/receipt and lead IDs never enter goals.

Abortable CORS fetch of tag.js with credentials omitted/no-referrer and eligibility recheck
before synchronous insertion is retained. Failure stays OFF. No CSP/TLS exception added.
The current public vendor's CORS/header/hash and intercepted wire checks are in VALIDATION.
A future vendor/CSP change needs another review. Source runs in the page, not a security
sandbox; do not claim it is unable to read the DOM/storage. Tests establish the observed
payload of the pinned vendor, not perpetual behavior of arbitrary future JavaScript.

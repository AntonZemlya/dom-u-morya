# FORM-002 / SMTP-001 — локальная приёмка 31.10.2026

Результат: **LOCAL PASS; Jino SMTP/DKIM E2E и публичное включение — PENDING отдельного GO.**
Реальные письма и visitor PII не использовались. Production, DNS, Jino-панель,
другие домены и mailbox credentials не читались и не менялись.
Основание: [Issue #7, SMTP-001](https://github.com/AntonZemlya/dom-u-morya/issues/7#issuecomment-6541887257).
База отдельного worktree/branch — `c1a32fa85c16d9e2c2b40588de8be5daa92d7801`.

## Среда и результаты

macOS arm64; Node v22.23.2, Python 3.13.14, **PHP 8.4.27** (с openssl/ctype/filter),
OpenSSL 3.6.4, Composer 2.10.3, Playwright 1.62.1 / изолированный Chromium.
PHP 8.5, доступный по обычному `php`, не использовался для PHP QA.
Рабочий PHP84_BIN в этой сессии: `/private/tmp/rehab-ci-php84/runtime/bin/php`.

| Проверка | Итог / проверенное поведение |
| --- | --- |
| `npm ci` | PASS, 19 packages, audit 0 vulnerabilities |
| Composer install/validate/audit | PASS, PHPMailer 7.1.1, точный lock + SHA исходников, advisory не найдено; validate `--strict --no-check-all` допускает намеренный exact pin |
| `npm run check:smtp` | PASS, закреплённые runtime hashes, license и производный серверный каталог |
| `npm run check` | PASS, syntax, generated content, source audit, все 28 неизменённых лотов |
| `npm run build` | PASS, 244 regular allowlisted files, приватные зависимости/config не входят в dist |
| PHP 8.4 `-l` | PASS: три endpoint/core, SMTP, catalog, manifest, config.example, contract |
| PHP contract | **68 assertions PASS**, validation/security/rate/replay/locks/TTL, thrown transport, пустая/повреждённая история fail closed, manual program:null |
| PHP HTTP → PHPMailer → TLS SMTP sink | PASS, настоящий обработчик из **dist**, без подмены mailer callback и без тестового PHP router |
| Received MIME | PASS: decoded Subject/From/To/Reply-To/Message-ID, envelope, text/plain UTF-8 + base64, все значения тела |
| SMTP failures | PASS: нет STARTTLS, неверное имя сертификата, недоверенный CA, AUTH/RCPT/DATA refusal, disconnect и timeout после приёма DATA |
| SMTP repeats | PASS: тот же key, другой key с тем же body, изменённое body, два одновременных HTTP-запроса, retry после потери HTTP-ответа, unknown delivery → 409 без второй отправки |
| SMTP policy | PASS: AUTH только после TLS; explicit SMTPS локально; To только серверный; новый MAIL_TO без привязанной приёмки выключает форму |
| HTTP/security | PASS: POST/Origin/Fetch-Site/JSON/size/consent/honeypot, Unicode/CRLF/HTML, price mismatch, unknown fields/lot, no-store, no CORS, missing/0644 config, missing/unsafe runtime |
| Логи/state | PASS: имён, телефона, email, SMTP fixture credentials и base64-пароля нет; state хранит HMAC/ID/metadata, 0600 |
| Browser SMTP E2E | PASS **1440/768/390/320**: выбранная квартира, consent, реальная отправка только в sink, replay, focus, отсутствие JS errors/overflow |
| Browser full calc | PASS: family 20/20/6, email/Telegram/12–15, потерянный HTTP-ответ; отдельная отправка manual 7.5% → custom без лота |
| Browser failures/no-JS | PASS: честные 4xx/5xx/invalid HTML response, missing config disables submit, no-JS 28 квартир и прямые контакты |
| `npm test` | PASS: release allowlist/reproducibility/rejections; UI и каталог на четырёх ширинах; настоящий PDF |
| `npm run test:dist` | PASS: те же UI/catalog проверки готовой сборки |
| `npm run test:eng-001` | PASS: оба ипотечных сценария/thresholds/manual/full payment, точные данные в PDF, кнопки/focus/busy/duplicate blocking, legal links, no-JS |
| `npm run test:seo` | PASS: canonical/robots/sitemap/immutable originals/previews, JS и no-JS на четырёх ширинах |
| `npm run test:previews` | PASS: 57 SVG/preview pairs, 1440 DPR1 + 390 DPR2, max pixel MAE 4.709 |
| `npm run test:security` | PASS: **11** локальных ops tests + настоящий Apache/PHP 8.4 HTTP/TLS; dotfile guard, ACME, publication order, 301, rollback; legacy SMTP probe/enable блокируются |
| `npm run test:smtp-package` | PASS: 10 exact members, SHA каждого, идентичные повторные архивы, private/public allowlists, tamper/symlink rejection |
| `git diff --check` | PASS |

Письмо проверялось после SMTP DATA стандартным Python email parser. Assertions включают:
лот **22825**, студия № **6**, этаж **2**, **29 м²**, **6978183 руб.** из серверного
снимка 27.10.2026; plan furnished; price/downPct/term/rate/program =
**6978183 / 20 / 20 / 6 / family**; optional `synthetic@example.invalid`, Telegram,
12–15; отдельное consent **true / 2026-10-30** со временем, ID и оператором.
Никакой автоматической отправки на этот Reply-To нет. Minimal payload также принят,
его письмо не содержит пустых optional строк и Reply-To.

SMTP sink слушал только 127.0.0.1; PHP `mail` отключён через `disable_functions`.
Тестовые CA/ключи, dummy credentials, private config/state и .eml удалены в finally;
оба процесса остановлены. Изображения формы без заполненных персональных полей
сохранены локально в `.test-output/form-002/`; визуально просмотрена форма на 320px.
Клиентские исходники не менялись.

## Performance (дополнительная регрессия)

Существующий `tests/performance.cjs` выполнялся из игнорируемой временной копии,
где **только URL** заменён с занятого 4183 на собственный 4184. Чужой preview не менялся.
Три прогона на каждый вариант, стандартные budgets LCP <2500 мс / CLS <0.1:

| Ширина / режим | Median LCP, мс | Median CLS | Результат |
| --- | ---: | ---: | --- |
| 1440 | 116 | 0 | PASS |
| 768 | 84 | 0.01396 | PASS |
| 390 | 72 | 0 | PASS |
| 320 | 72 | 0 | PASS |
| 390, network/CPU throttling | 1776 | 0.01276 | PASS |

Это локальные лабораторные значения, не показатели реальных пользователей.
Доказательства: `.test-output/performance/smtp-001/measurements.json`.

## Scope и границы результата

`git diff c1a32fa -- index.html script.js styles.css data assets privacy.html
consent-personal-data.html .htaccess HOSTING-SEO.md` пустой. Отдельно проверен
`favicon.png`: его blob тоже совпадает с базой.
Публичный update-пакет содержит **только четыре PHP-файла**, private часть — runtime
с лицензией. Персональные данные/production secrets отсутствуют в Git/пакете.
Точный финальный source commit, SHA-256 и размер архива — в созданном после коммита
`.release-output/form-002/package.json` и описании Draft PR.

SMTP sink не доказывает доставку на Jino, SPF, DKIM или Inbox. Это отдельные
неисполненные этапы **GO A/B/C** в [SMTP-GO.md](../../ops/SMTP-GO.md).
Правовые страницы с прежним sales/Jino намеренно сохранены до согласования;
их обновление/версия и приёмка конечного получателя обязательны перед включением.
Окна idempotency ограничены 24 ч / 7 суток / 10 минут и описаны в GO-плане;
очищать uncertain историю ради повтора запрещено. GitHub CI не запускался.

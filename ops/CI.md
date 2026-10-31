# Единый CI

`npm run ci:fast` — обязательный локальный контракт PR: Node 22, весь JS syntax,
актуальность генерируемого контента, source/security audit, локальные ссылки,
preview/production allowlist, повторная production сборка с одинаковым SHA,
28 лотов каталога и реальная функция калькулятора (аннуитет, 0%, 100% взнос),
SEO/legal и синтетические release/backup/restore/rollback/prune/CMS-export tests.
Внешняя сеть, PHP, Composer и браузер для fast не нужны.

`npm run ci:full` включает fast и обязательные PHP **8.4** (OpenSSL/ctype), Composer
validate/audit, PHPMailer 7.1.1 по lock/manifest, fake SMTP с TLS/ошибками/неопределённым
результатом, HTTP API, согласие, fallback, error/success и no-JS, Playwright Chromium
1440/768/390/320, каталог/PDF, SEO/performance, 57 пар SVG/preview и dotfile security.
Отдельный `manager-guard-http` запускает изолированный Apache с exact принятой
.htaccess: GET/HEAD 403/404, ACME 200 и чувствительность к permissive marker fixture.
Engine tests проверяют exact EXPORT GO на CLI/worker до archive read/SSH и STOP
inventory/rotation при утрате любого обязательного файла или расхождении metadata.
Исторические release/security тесты получают синтетические baselines, без серверных
receipts или секретов. Поднимаются только disposable loopback серверы, системный
`mail()` отключён. Реальные получатели не вызываются; SMTP sink — `127.0.0.1`.

```sh
npm ci
composer install --no-dev --no-plugins --no-scripts --no-interaction
npx playwright install chromium
npm run ci:fast
PHP84_BIN=/path/to/php84 PHP84_CGI_BIN=/path/to/php84-cgi npm run ci:full
```

Не использовать пользовательский Chrome. CI очищает внешние preview/config/browser
overrides и использует отдельный Playwright Chromium. Установщик браузера запускается
оператором отдельно; CI не скачивает его незаметно. Нужны Python 3, OpenSSL, для
архивных dotfile tests — локальный Apache с CGI/mod_ssl (`HTTPD_BIN`, по умолчанию
`/usr/sbin/httpd`). Composer audit требует сеть; её отказ означает FAIL.
Нельзя запускать fast/full одновременно в одной рабочей копии: они строят `dist/`.

Результаты: `.test-output/ci/{fast,full}/report.json`, `summary.md`, отдельные `.log`.
Каждый check: PASS/FAIL/SKIP с причиной, длительностью и командой. SKIP обязательного
check делает общий результат FAIL. Отсутствующий PHP/Composer/Chromium не даёт PASS.
Не публиковать каталоги captured fixture messages или `.release-output` как CI artifacts.

## GitHub Actions и бюджет

На 01.11.2026 GitHub API подтверждает `visibility=public` у
`AntonZemlya/dom-u-morya`. По [официальным условиям GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
стандартные hosted runners бесплатны для public repositories. Workflow запускает
только fast на PR к main: один `ubuntu-24.04`, timeout 6 минут, cancel superseded,
read-only token, без secrets, браузеров, cache, upload artifacts и deploy.
Actions закреплены полными upstream SHA. Полная история checkout нужна существующим
frozen-source контрактам. При переводе репозитория в private job автоматически
пропускается; включать его заново только после проверки бюджета.
Полный CI и production остаются локальными. Настройки branch protection не меняются.

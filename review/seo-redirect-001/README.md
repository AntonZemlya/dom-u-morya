# SEO-REDIRECT-001 — независимая приёмка Draft PR

Статус: подготовка к независимой приёмке в ChatGPT. По последнему указанию владельца
PR остаётся Draft; squash merge и production apply ожидают результата приёмки.
Production не изменён, production release ID и backup нового релиза ещё не созданы.

Рабочая ветка: `codex/seo-redirect-001`, отдельный worktree от актуального
`origin/main` (`a3f0a43`). Единственный изменяемый публичный файл — `.htaccess`.
Дизайн, контент, юридические тексты, Метрика, SMTP и SQLite-код не менялись.

## HTTP: исходное production и проверенный изолированный Apache

Замеры production сделаны 05.11.2026 до изменений; представительская выборка —
[http-before.json](http-before.json). Полная read-only матрица хранится локально
в `.release-output/seo-redirect-001/http-before.json` и не публикует тела ответов.
Колонка Apache — фактический результат нового файла на disposable runtime,
не утверждение о публикации на production.

| URL на основном HTTPS-домене | Production до | Новый Apache |
|---|---|---|
| `/` | 200 | 200 |
| `/index.html` | 200 | 301 → `https://zhk-dom-umorya.ru/` |
| `/index.html/` | 404 | 301 → `https://zhk-dom-umorya.ru/` |
| `/index`, `/index/` | 404 | 301 → `https://zhk-dom-umorya.ru/` |
| `/privacy.html` | 200 | 200 |
| `/consent-personal-data.html` | 200 | 200 |
| `/consent-analytics.html` | 200 | 200 |
| Три юридических `.html/` | 404 | 301 → тот же `.html` без слэша |
| `/privacy`, `/assets`, `/api` | 301 → HTTP-каталог | 301 → HTTPS-каталог |
| `/privacy/`, `/assets/`, `/api/`, `/assets/fonts/` | 403 | 403 |
| Несуществующий `.html`, `.html/`, лишний PATH_INFO | 404 | 404 |
| PHP lead / analytics-consent GET | 405 | 405 |
| Protected paths | 403/404 | 403/404 |

Все HTML-адреса проверяются GET/HEAD на HTTP/HTTPS с www/без www, без query и с
`utm_source`, `utm_campaign` (включая `%20`), `yclid`. На основном домене
неканонический HTML сразу получает окончательный абсолютный HTTPS Location.
Главная не зацикливается при внутреннем DirectoryIndex subrequest.

## Причина и границы исправления

Read-only SSH подтвердил exact старый `.htaccess` и реальный каталог `privacy`,
содержащий JS/CSS. Он не является URL документа `privacy.html`. Внешние ответы
Apache добавляют слэш через HTTP Location, хотя публичный запрос был HTTPS.
Это поведение воспроизведено с exact старой политикой на Apache: backend HTTP,
`X-Forwarded-Protocol: https`, Host основного домена, mod_dir включён.
[Документация Apache mod_dir](https://httpd.apache.org/docs/2.4/mod/mod_dir.html#directoryslash)
описывает автоматическое добавление слэша и риск раскрытия listing при отключении.

Новая политика формирует HTTPS Location для реальных каталогов до mod_dir,
сохраняет DirectorySlash и явно запрещает Indexes. Нет общего redirect неизвестных
страниц на главную, нет переноса `/privacy/` на документ. ACME guard сохранён
побайтно и действует раньше нормализации.

Владелец отдельно подтвердил исключение провайдера: существующий nginx Jino
перенаправляет `http://www.DOMAIN/path?query` → `http://DOMAIN/path?query`.
Эту настройку не меняем. Допустимы два 301 до окончательного canonical HTTPS;
содержимое сайта по промежуточному HTTP не выдаётся. Матрица допускает только
точное снятие www с сохранением пути/query на этом первом HTTP hop. HTTPS→HTTP,
потеря query, чужой host, циклы и тело страницы сайта в HTTP redirect запрещены.

## Миграция защищённой политики

- Исходный v1 SHA-256: `652ea884d02b2a73b7fa026823c4732fd1ccccba1ba11e1c43ee8c19be0e3ee5`.
- Целевой v2 SHA-256: `86a28fe3e086dc73b1e901277080e79df5fbe0e178fcf5644b5a2c7437f877c7`.
- Package verify/preflight/apply принимают только v2. План перехода с exact v1
  разрешает ровно один `replace .htaccess`, без других публичных изменений.
- Scope и оба SHA входят в plan SHA, связанный с прежним exact GO; повторное
  планирование под lock перед apply проверяет полный baseline и inventory.
- Backup и отдельная rehearsal-проверка сохраняют exact v1 bytes/metadata.
  Проверены штатный rollback и автоматическое восстановление после ошибки записи.
- Для чтения старых неизменяемых receipts/backup сохранён exact v1. Это исключение
  не вызывается новым package/apply. Любые третьи версии и permissive suffix
  отвергаются. Архивный Jino worker и его CLI-блокировка не ослаблены.
- CLI выполняет полную redirect matrix после SHA-проверки HTTP-ресурсов и перед
  `attest`. Ошибка оставляет `awaiting_http_verify`; повторного apply нет.

## Проверки

Финальный `ci:fast`: PASS, 10 обязательных checks, 4.9 с.
Финальный `ci:full`: PASS, 33 обязательных checks, 204.5 с.
Сводка: [ci-summary.json](ci-summary.json); пропусков и ошибок нет.
Full включает PHP 8.4/SQLite3, Composer audit, SMTP/TLS, изолированный Chromium,
security и новую Apache HTTP-матрицу.
Профильный runtime: реальный локальный Apache/PHP 8.4, только loopback, отдельные
процессы, `mail()` отключён; личный браузер владельца не используется.

- 236 GET/HEAD URL cases; 248 статических файлов с точными исходными SHA.
- ACME HTTP/HTTPS и отсутствие listing даже при унаследованном Indexes.
- Реальные PHP GET 405 и локальный POST 415 `json_required` без редиректа.
- 44 синтетических случая provider exception; три негативные мутации
  (downgrade, потеря query, страница по HTTP) обнаружены.
- 53 release-manager теста: exact SHA/scope, backup/rollback, old receipts,
  запрет старых новых пакетов, запрет attestation после провала матрицы.
- SEO: canonical/og:url трёх индексируемых страниц согласованы; sitemap содержит
  `/`, `/privacy.html`, `/consent-personal-data.html`. Analytics consent сохраняет
  `noindex,follow` и не добавляется в sitemap. Ссылки и JSON-LD прошли существующий CI.
- Отдельный повторный просмотр полного diff: изменения ограничены редиректами,
  миграцией и проверками; frozen content/API/analytics/SMTP исходники совпадают с main.
  Независимое человеческое/ChatGPT review этого diff остаётся этапом приёмки.

## После независимой приёмки

Один squash merge; синхронизация main; детерминированный пакет из полного merge SHA;
независимый rebuild (`release verify`); свежие read-only preflight и exact plan;
проверка единственного replace `.htaccess` и old/new SHA; штатные backup/rehearsal;
один apply; полный SSH/HTTPS SHA, form readiness, redirect matrix; `verified`.
Затем отдельный повтор матрицы и isolated Chromium до согласия, без production
POST, новых согласий, тестовых заявок и писем. При потере ответа — status,
затем finalize либо обоснованный rollback, без слепого повторения apply.

Квота прочитана штатно в панели Jino: 462 МБ занято, 9,55 ГБ свободно, 10 ГБ всего.
Локальное quota evidence округлено консервативно; если приёмка задержится более
24 часов, перед apply нужно заново прочитать квоту. Config/state/SQLite и cron
не входят в scope; начальные метаданные сохранены локально, без содержимого state.

# Подготовка к production

1. Получить у Бориса публичный домен, подтвердить HTTPS, www или apex, поддержку постоянных 301. Не использовать тестовые хосты.
2. Задать SITE_URL выбранным HTTPS origin и выполнить `npm run build:production`. Без параметра production-сборка завершается ошибкой, предыдущий dist сохраняется. `npm run build` без SITE_URL создаёт только локальный preview: robots открыт, sitemap/canonical/абсолютные OG URL отсутствуют.
3. Проверить три self-canonical, sitemap и robots на реальном домене, MIME JPEG/WebP/SVG/WOFF2, 404, TLS и ответы 200. Настроить HTTP→HTTPS, единственный вариант www/apex, `/index.html`→`/`, без циклов и цепочек. Хостинг пока не выбран, конфигурация Nginx/Apache не внедряется.
4. Включить Brotli (предпочтительно) и gzip для text/html, text/css, application/javascript, application/json, image/svg+xml. `Vary: Accept-Encoding`; не сжимать повторно JPEG/WebP/WOFF2. Проверить реальные `Content-Encoding` и размер передачи.
5. HTML: `Cache-Control: no-cache` с ETag/Last-Modified. Изображения с SHA в имени — `public, max-age=31536000, immutable`. CSS/JS/fonts, hero и OG имеют стабильные имена: revalidate (`no-cache`) до внедрения настоящих content hash URL. Не назначать immutable таким именам. При обновлении сбрасывать CDN. Preview 4183 намеренно использует no-store; его настройки не менять.
6. Подтвердить права на медиа/OG, актуальность цен/наличия и юридический запуск формы. Отправка формы остаётся отключена с честным уведомлением. Проверить старые копии сайта и дубли отдельно; не удалять их автоматически.
7. После размещения: Rich Results Test, Search Console/Яндекс Вебмастер, sitemap, Lighthouse/PSI и реальные CrUX. Локальная лаборатория не является замером полевого INP или гарантией ранжирования.

## Производные ассеты

`node scripts/generate-plan-previews.cjs`: Sharp из lockfile, lossless WebP 960 px по длинной стороне. Оригинальные SVG и источники данных immutable.
`python scripts/generate-fonts.py`: Python с fonttools/brotli, WOFF2 без subset. Все 9 TTF и OFL сохранены.
`node scripts/generate-seo-media.cjs`: JPEG 1200×630 из локальных неизменённых hero/logo. Для публичного использования нужны права.

Обычная сборка использует проверенные готовые производные; регенерация не нужна на хостинге. HTML сохраняет whitespace из-за утверждённой типографики и встроенного JSON; CSS/JS минимизируются без переименования и изменения синтаксиса. PDF-библиотеки остаются динамическими.

## Локальная приёмка

Перед браузерными тестами собрать dist и выбрать его через существующий `preview.py use /абсолютный/путь/dist`. Для существующих UI/catalog/ENG/REC проверок задать `QA_BASE_URL=http://127.0.0.1:4183/`, чтобы тесты использовали готовую сборку и не запускали свои временные серверы. Пример: `QA_BASE_URL=http://127.0.0.1:4183/ npm test`. Новые замеры используют только 4183. Поддержка прежних изолированных тестовых серверов в helper сохранена для других окружений, но в SEO-приёмке не используется.

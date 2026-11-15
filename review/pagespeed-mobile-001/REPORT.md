# PAGESPEED-MOBILE-001 + LOGO-NAV-001

Дата: 15.11.2026 (МСК). Режим: только Draft PR; merge, staging и production deploy не выполнялись.
Репозиторий: `AntonZemlya/dom-u-morya`, база `47854ca` (`origin/main`), отдельный worktree
`codex/pagespeed-mobile-001-logo-nav-001`. Основной checkout не менялся.

## Результат и границы

В сопоставимой локальной лаборатории mobile Performance **94 → 96**, LCP **3,083 → 2,808 с**,
первоначальная передача **936 226 → 466 991 байт** (−50,1%), HTTP-запросы **24 → 20**.
Desktop Performance **100 → 100**, LCP **0,769 → 0,747 с**. Accessibility **96 → 100**;
Best Practices и SEO — **100 → 100**. CLS сохранён: mobile 0,00314, desktop 0.

Это **не результат PSI production 73 → 96**. Исходные PSI 73/98, FCP 3,3 с и LCP 4,8 с
получены другой средой. В нашей лаборатории исходный mobile уже 94; серверный TTFB и
доступ к сторонним ресурсам отличаются от PSI. Цель LCP 2,5 с **не достигнута**.
Новый результат PSI можно подтвердить только после отдельного разрешённого выпуска.

## Методика baseline

1. `origin/main` проверен через GitHub; baseline checkout собран с
   `BUILD_TARGET=production`, `SITE_URL=https://zhk-dom-umorya.ru`.
2. Публичный HTML production прочитан GET без записи. Его SHA-256 и SHA baseline `dist/index.html`
   совпадают: `3f7f748d8bf614396a47c2170ecfc48d501f74e4a064fbd38f738049e761428c`.
3. Два loopback-сервера используют один `tests/performance/server.cjs`, одинаковые gzip,
   MIME, без искусственных задержек, с холодным браузерным профилем на каждый запуск.
   На production Apache gzip уже включён: `styles.css` — 17 202 байта сжатого тела.
4. Lighthouse **13.6.0**, Chrome **157**, Node **22.23.4**, macOS Apple Silicon.
   Mobile: 412×823, DPR 1,75, simulated slow 4G (RTT 150 мс, 1638,4 kbit/s, CPU×4).
   Desktop: настоящий `desktop-config` (1350×940, DPR 1, RTT 40 мс, CPU×1).
   Настройки и benchmarkIndex каждого запуска сохранены в JSON.
5. По три mobile и desktop до/после: **12 запусков**. Сторонняя карта в Lighthouse
   не заглушается. Перед измерениями завершены прочие браузерные проверки;
   mobile/desktop выполняются последовательно. Считаются реальные HTTP(S)-запросы,
   а не строки `data:`/`blob:` в диагностике Lighthouse.
6. Loopback-сервер воспроизводит сжатие, но не Apache `.htaccess` и кэш.
   Проверка HTTP-кэша выполнена отдельно на реальном Apache/PHP: холодный Lighthouse
   не доказывает поведение повторного визита или Jino proxy.

Полные отчёты, waterfall и выбранные медианные trace: [lighthouse-evidence.tar.gz](lighthouse-evidence.tar.gz).
Все замеры: [measurements.json](measurements.json). Настройки троттлинга:
[документация Lighthouse](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md).

## Медианы

| Устройство | Метрика | До | После |
| --- | --- | ---: | ---: |
| Mobile | Performance | 94 | 96 |
| Mobile | FCP, с | 1.204 | 1.052 |
| Mobile | LCP, с | 3.083 | 2.808 |
| Mobile | TBT, мс | 5 | 0 |
| Mobile | CLS | 0.00314 | 0.00314 |
| Mobile | Передача, байт | 936 226 | 466 991 |
| Mobile | HTTP-запросы | 24 | 20 |
| Desktop | Performance | 100 | 100 |
| Desktop | FCP, с | 0.324 | 0.283 |
| Desktop | LCP, с | 0.769 | 0.747 |
| Desktop | TBT, мс | 0 | 0 |
| Desktop | CLS | 0.00000 | 0.00000 |
| Desktop | Передача, байт | 1 095 926 | 665 270 |
| Desktop | HTTP-запросы | 26 | 22 |

## Все запуски

| Фаза | Профиль | № | Perf | FCP, с | LCP, с | CLS | Байт | HTTP |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| До | mobile | 1 | 94 | 1.205 | 3.085 | 0.00314 | 936226 | 24 |
| До | mobile | 2 | 94 | 1.204 | 3.083 | 0.00314 | 936225 | 24 |
| До | mobile | 3 | 94 | 1.204 | 3.083 | 0.00314 | 936249 | 24 |
| До | desktop | 1 | 100 | 0.324 | 0.770 | 0.00000 | 1095924 | 26 |
| До | desktop | 2 | 100 | 0.324 | 0.768 | 0.00000 | 1095926 | 26 |
| До | desktop | 3 | 100 | 0.324 | 0.769 | 0.00000 | 1095926 | 26 |
| После | mobile | 1 | 96 | 1.052 | 2.808 | 0.00314 | 466991 | 20 |
| После | mobile | 2 | 95 | 1.263 | 2.898 | 0.00314 | 466991 | 20 |
| После | mobile | 3 | 96 | 1.052 | 2.805 | 0.00314 | 466991 | 20 |
| После | desktop | 1 | 100 | 0.283 | 0.748 | 0.00000 | 665270 | 22 |
| После | desktop | 2 | 100 | 0.283 | 0.747 | 0.00000 | 665270 | 22 |
| После | desktop | 3 | 100 | 0.283 | 0.747 | 0.00000 | 665270 | 22 |

## Что показало исследование

**Критический путь.** В mobile LCP — `.privacy-banner-note`, текст существующего баннера,
который создаёт неизменённый локальный privacy-модуль. Главная картинка hero не является
финальным mobile LCP-элементом. Hero уже имеет отдельный небольшой `hero-mobile.webp`.
Поэтому его дополнительный высокий image-preload без подтверждённой пользы не добавлен.
Для маленького логотипа первого экрана назначен `fetchpriority=high`.

**CSS и шрифты.** Полный `styles.css` около 17 КиБ gzip; отдельный `fonts.css` создавал
ещё один блокирующий запрос/ступень обнаружения. Небольшие `@font-face` теперь встроены
из единственного источника `assets/fonts/fonts.css` через проверяемый `npm run content`.
Основной CSS оставлен обычным блокирующим stylesheet: не добавлены отложенное применение
стилей, дублированный вручную critical CSS и риск FOUC. Оригинальный CSS сохранён как
точный префикс; изменения — небольшие добавленные правила.

Newsreader/Sora в проекте не содержат кириллицы; реальный CDP font audit показывает системный
fallback для русских букв и исходные webfont-глифы для латиницы/пробелов/пунктуации.
Глифы, веса, метрики, `font-display:swap` и TTF для PDF не изменены. Новые WOFF2 — побайтные
копии исходных с хеш-URL. Все пять прежних desktop font-preload действительно используются.
Их удаление вызвало CLS около 0,0127, поэтому они **сохранены** для ≥1141 px с новыми URL.
Mobile не получает эти desktop-предзагрузки. Экспериментальные module-preload не включены
в итог: измеримой пользы для LCP не выявлено.

**Изображения.** Основные затраты — ранняя загрузка lazy-фотографий architecture/location
и слишком большой логотип, а не 23-КиБ hero. Подготовлены 208/416 px для логотипа,
480/768/1024 px для location и 768 px для architecture. Для экрана ≤450 px архитектура
имеет центральный crop с полной исходной высотой, варианты 432/864 px: обычный width-only
srcset размыл бы высокий блок 480 px. На остальных экранах сохранена исходная композиция.
`sizes` учитывает увеличение при `object-fit:cover`; DPR 2 не получает изображение,
рассчитанное только на ширину узкого контейнера. Исходные WebP оставлены.
При mobile Lighthouse изображение location сокращается примерно 161 → 65 КБ,
architecture 141 → 103 КБ, логотип 29 → 5 КБ. Нет одновременной загрузки исходника и
выбранного responsive-варианта одной фотографии. Запрос второго размера логотипа при
дальнейшей прокрутке к большому логотипу футера — ожидаемое повышение разрешения.

**Карта.** `loading=lazy` iframe в baseline всё равно загружает HTML/CSS/JS OpenStreetMap:
3 запроса, около **311 592 байт** до прокрутки; bundle использует MapLibre.
В JS-режиме iframe лежит в инертном `<template>` и создаётся один раз при приближении
карты на 200 px или при нажатии существующей кнопки. Высота 260–380 px зарезервирована
до загрузки. Прямой `#location`, переход из меню, клавиатура, unlock/blur/mouseleave
проверены. В no-JS оставлен iframe и нативная ссылка на ту же карту в новой вкладке
с прежней видимой подписью; она работает без обработчиков страницы. Внешние сервисы
не добавлены. При начальном JS-визите сторонних запросов карты нет; при прокрутке
сервис получает те же запросы, что раньше. Аналитическое согласие не изменено.

**Второстепенное.** Предупреждение об unused JS карты решено отсрочкой всей карты,
а не модификацией стороннего bundle. Большого TBT в исходной странице нет, поэтому
не менялись калькулятор, PDF, форма или её последовательность инициализации.
Рекомендация длительного кэша в основном помогает повторным посещениям, не холодному LCP.

## Кэш и release-engine

На Jino проверенные статические ответы имеют Apache, ETag и Last-Modified, но не Cache-Control.
В `.htaccess` **после неизменённого старого содержимого** добавлены ограниченные правила:

| Файлы | Cache-Control | Обновление |
| --- | --- | --- |
| HTML/CSS/JS, исходные WebP, изображения/шрифты по постоянному URL | `public, max-age=0, must-revalidate` | Проверка актуальности перед повторным использованием; новый релиз/rollback виден сразу |
| Только новые WebP/WOFF2 с SHA-256 содержимого в имени | `public, max-age=31536000, immutable` | Новые байты требуют нового имени; старые опубликованные URL сохраняются в `retained` |
| PHP/API/JSON, приватное состояние, ошибки | Не охвачены новым кэшем | API сохраняет `no-store`; защитные отказы не получают immutable |

`tests/performance/assets.mjs` включён в ci:fast: проверяет хеш каждого неизменяемого файла,
точный manifest и побайтное совпадение шрифтов. Dependency lockfiles не менялись.
Apache `[FilesMatch]`, mod_headers, HEAD/304, замена содержимого по прежнему URL,
API no-store и ошибки проверены на настоящем локальном Apache/PHP 8.4.
Результат: [apache-url-cache.json](apache-url-cache.json).
Справка: [Apache mod_headers](https://httpd.apache.org/docs/2.4/mod/mod_headers.html).

**Ограничение будущего релиза:** прежний release-engine намеренно разрешает `.htaccess`
только по точному SHA. Обновлён целевой SHA и добавлена прежняя v2 как точный исторический
baseline. Правила dotfile/security-guard и SEO-редиректы сохранены побайтно, произвольные
policy не разрешены. Миграция v2 → v3 по-прежнему допускает **только замену `.htaccess`**;
смешанный план останавливается. Для будущего выпуска потребуются отдельно подготовленный
точный пакет миграции и затем обычный пакет сайта, каждый с предусмотренным GO владельца.
Ни планы production, ни SSH-операции, ни эти применения сейчас не выполнялись.
Точные SHA и порядок описаны в [RELEASE-RUNBOOK](../../ops/RELEASE-RUNBOOK.md).

## Логотипы и контраст

Header/footer всех четырёх страниц имеют `href="/"`. На `/` обычный click/Enter с JS
удаляет только hash, сохраняет query и history.state, закрывает меню, переводит фокус
в main и прокручивает вверх; reduced motion учитывается. С внутренних страниц и без JS
срабатывает обычная навигация. Modifier/new-tab/target/download не перехватываются.
Соотношение сторон логотипов зафиксировано по оригиналу, исключая сдвиг от округления
размеров WebP. Макет и размеры первого экрана сохранены.

Исправлены только обнаруженные Lighthouse/axe нарушения:

| Элемент | До | После | Фон |
| --- | --- | --- | --- |
| Строительство, застройщик, FAQ `.plans-style-4` | `#c8a96a`, contrast 1,94–2,15 | `#806534`, проходит 4,5:1 | `#f2eee7` / `#fbfaf7` |
| `.construction-story` | `#677067`, 4,43:1 | `#626b62`, проходит 4,5:1 | `#f2eee7` |
| Неактивные construction `.tab-chip` | `#7a786f`, 3,82:1 | `#6b695f`, проходит 4,5:1 | `#f2eee7` |

## Приёмка и сохранённые инварианты

- `npm run ci:fast` — PASS; `npm run ci:full` — PASS (34 обязательные проверки).
- SEO source/browser, формы/SMTP, analytics/consent, UI, каталог/PDF/lightbox,
  security и URL matrix — PASS. Только синтетические данные; настоящие письма не отправлялись.
- Chromium 1440/768/390/320, JS ON/OFF — PASS. Keyboard/query/no-reload/main focus,
  внутренние страницы, map proximity/direct anchor/menu/unlock, no-JS link — PASS.
- Real OpenStreetMap smoke: см. `real-map.json` и `logs/real-map.log`; tiles и кнопка zoom
  проверены отдельно от заглушки в визуальных тестах.
- Геометрия hero и основных секций до/после совпадает на всех четырёх ширинах с JS ON/OFF.
  Различие первого экрана по порогу RGB >12 — около 0,13–0,15% пикселей (вариант логотипа),
  без изменения композиции/типографики. Gallery/plans/pricing/contact в JS-режиме совпадают.
  [Визуальные пары](README.md), [данные](visual-comparison.json).
- 28 квартир/Offer, цены, исходные изображения, API/SMTP, privacy-модули, canonical,
  Schema.org, OG/Twitter и содержимое legal-main совпадают побайтно с baseline:
  [invariants.json](invariants.json). Политика конфиденциальности и пользовательские данные не менялись.

Инструменты тестирования: имеющиеся Playwright/sharp/esbuild/pdf-lib; Lighthouse 13.6.0 и
совместимый PHP 8.4.27 использованы изолированно вне dependency lockfiles приложения.
Для analytics-проверки взят свежий публичный `tag.js` и исполнен только внутри изолированного
перехвата всех сетевых запросов; живой счётчик не вызывался.

## Воспроизведение

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run ci:fast
# PHP84_BIN и PHP84_CGI_BIN указывают на PHP 8.4; METRICA_VENDOR_FIXTURE — локальный tag.js.
npm run ci:full
node tests/performance/navigation.cjs
# Оба dist собраны production с тем же SITE_URL; серверы запускать в отдельных терминалах.
node tests/performance/server.cjs /absolute/baseline/dist 4188
node tests/performance/server.cjs /absolute/candidate/dist 4189
# Lighthouse 13.6.0 установлен отдельно, LIGHTHOUSE_PACKAGE указывает на пакет.
node tests/performance/lighthouse.mjs http://127.0.0.1:4188/ /absolute/qa/before
node tests/performance/lighthouse.mjs http://127.0.0.1:4189/ /absolute/qa/after
# Живая карта — явный необязательный smoke, с внешним OpenStreetMap после прокрутки.
CI_PREVIEW_URL=http://127.0.0.1:4189 node tests/performance/map-live.cjs
```

## Файлы, риски и rollback

Полный перечень: [changed-files.txt](changed-files.txt). Основные изменения:

| Группа | Файлы |
| --- | --- |
| Разметка, логотипы, responsive map | `index.html`, три legal HTML, `templates/footer.html`, `script.js`, `styles.css` |
| Декларации и content hash assets | `assets/fonts/fonts.css`, `assets/fonts/README.md`, `assets/performance/*`, `data/performance-assets.json`, `scripts/generate-performance-assets.mjs` |
| Детерминированная генерация/release allowlist | `scripts/generate-content.mjs`, `scripts/build-release.mjs`, `scripts/release-files.mjs`, `scripts/ci.mjs` |
| Кэш и точная миграция policy | `.htaccess`, `ops/release_core.py`, `ops/RELEASE-RUNBOOK.md`, два Apache/manager теста |
| Приёмка | `tests/performance/*`, точечные актуализации legal/SEO/footer тестов, `review/pagespeed-mobile-001/*` |

Остаются ограничения: локальные показатели не гарантируют PSI production; цель LCP ≤2,5 с
не достигнута; OSM зависит от доступности стороннего сервиса; mod_headers/Jino proxy нужно
проверить публичными GET/HEAD только после будущего разрешённого выпуска. Если модуль
mod_headers отсутствует, IfModule пропускает кэш без нарушения работы сайта.

Rollback сейчас: закрыть Draft PR или revert его изменений. После возможного будущего выпуска —
штатный rollback соответствующих release ID с точным GO: baseline и v2 policy остаются
проверяемыми, исходные картинки/TTF сохранены, API/SMTP/consent data не менялись. Immutable
файлы не переписывать по старым именам; предыдущие хеш-URL не удалять при обычном обновлении.

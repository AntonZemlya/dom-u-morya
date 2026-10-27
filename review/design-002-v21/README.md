# DESIGN-002 / REC-004 V2.1 — передача на независимую приёмку

27 октября 2026. Реализация и техническая проверка завершены. Визуальное решение владельца ожидается; публикация не выполнялась.

- Предпросмотр готового `dist/`: http://127.0.0.1:4183/
- Исходная V2 для сравнения: http://127.0.0.1:4180/
- Worktree: `/Users/azm1982/.codex/worktrees/dom-u-morya-design-v21/dom-u-morya`.
- Ветка: `codex/design-002-v21`.
- Основа: `220591ed97d1432f09a8d60b4503fab211974b7d`.
- Коммит реализации: `f942fb359e7da73c557bf8fb4cb2ca88b822c61d`.
- Итоговый HEAD: см. `git rev-parse codex/design-002-v21` и локальный файл `revision.txt` рядом со скриншотами.
- Issue: https://github.com/AntonZemlya/dom-u-morya/issues/11
- REC-003: https://github.com/AntonZemlya/dom-u-morya/pull/8, проверенный HEAD `0ba0fbf46977d797239fd54b4a40352f8ab2242f`.

## Дизайнерский аудит и изменения

1. **Завершение страницы — готово к визуальной приёмке.** Раньше фотография заявки, форма, FAQ и светлый футер образовывали длинный ряд близких по тону секций с пустой колонкой контактов. Теперь порядок: FAQ на светлом фоне → самостоятельная тёплая зона заявки → тёмный футер. В заявке фото и контакты слева, форма справа; на телефоне — фото, форма, прямые контакты. Сохранены одна форма, её поля, контекст квартиры/расчёта и якорь `#contact`.
2. **Футер — готово.** Угольно-морской фон `#21373c`, крупное название, главный контакт — телефон агентства, ниже почта и консультации. Реквизиты, роль агентства и правовые ссылки собраны в отдельный спокойный блок. Вместо ряда разделительных черт — типографическая и тональная иерархия. Copyright и неоферта остаются видимыми. Явно указано, что агентство не является застройщиком.
3. **Новости — готово, вариант A.** Удалены три повторяющиеся карточки внешних новостей и прямая ссылка на новость из статуса стройки. `data/news.json` сохранён без изменений: даты, аннотации и источники доступны в данных. Блок застройщика и необходимые ссылки на документы объекта сохранены.
4. **Строительство — готово.** Заголовок и краткий статус образуют две колонки на desktop и последовательный блок на mobile. Дата 16 октября 2026 относится к последней подтверждённой вехе, отдельно от фотоистории апреля–сентября. Подпись под альбомом объясняет, что точная дата съёмки не установлена. Все 29 снимков и шесть альбомов доступны; октябрьский альбом и проценты готовности не добавлялись.
5. **Планировки — готово.** Сохранена журнальная сетка V2. Подписи и действия увеличены до 12–14 px, переключатели и основные ссылки имеют высоту минимум 44 px; выбранный вид выделяется мягким фоном и золотистой линией. На 320 px стоимость вынесена на отдельную строку, действия расположены вертикально. На tablet действия также не конкурируют за узкую строку. Добавлены видимый focus, hover и переключение кнопок-ссылок пробелом; Enter работает штатно. Сноски и варианты в lightbox читаются крупнее.

На второй визуальной итерации усилен контраст текста на морской фотографии и исправлен запасной шрифт дополнительных полей формы. Перед передачей повторно просмотрены реальные снимки всех четырёх ширин и модальные состояния.

## Неприкосновенные части и данные

Hero и «Архитектура-маяк» не изменены. В контролируемых одинаковых снимках V2/V2.1 получено точное попиксельное совпадение на 1440, 768, 390 и 320 px; результаты — `protected-sections.json`. Анимации при сравнении остановлены; это сравнение стабильного состояния, а не всех моментов анимации.

`data/`, `assets/`, `content-model.js`, `privacy.html` и `consent-personal-data.html` не имеют изменений относительно V2. Сохранены 28 квартир, 19 групп, 84 связи с 57 исходными SVG, цены, схемы, фильтры и ипотечная формула. `main` остаётся на `b63b88e`, ветка V2 — на `220591e`. Независимая V2 не редактировалась. При начале работы 4180 был недоступен; сервер исходного существующего `dist/` запущен заново без изменения файлов. Оба сервера оставлены работающими.

## REC-003: фактическая локальная интеграция

- Блок отдельного согласия и самостоятельная ссылка на политику, уведомление о localStorage и отсутствии аналитики, пояснение о неработающей отправке взяты из PR #8 без редактирования текстов.
- Два юридических документа побайтово совпадают с PR #8. Функции формирования заголовка формы и обработки отправки также совпадают.
- Усиленная проверка обнаружила недостающие ИНН/ОГРНИП в реальном PDF V2. Контактный блок PDF заменён точным блоком REC-003. Формула, цены и содержание выбранной квартиры сохранены.
- Скрипт `scripts/check-rec003-integration.mjs` больше не заменяет контактную секцию, документы или поведение в тестовой копии. Он проверяет тождественность границ REC-003, собирает настоящие исходники V2.1 и запускает проверки PR #8 с адаптацией только чисел каталога REC-004.
- Проверены пустой чекбокс, запрет отправки без согласия, открытие документов мышью и клавиатурой в новых вкладках, сохранение введённых полей, отсутствие запросов с персональными данными и ложного успеха.
- Для дальнейшей интеграции юридические фрагменты уже согласованы и не требуют повторной замены всей секции контактов. Сохранять композицию V2.1; запускать этот скрипт после любых изменений. PR #8 не мержился. Полное автоматическое слияние веток Git не заявляется проверенным: проверена совместимость содержимого и поведения, а не будущая история слияния.

## Автоматические проверки

Все команды завершились успешно на итоговых исходниках (установка зависимостей выполнена в начале; lockfile не менялся):

| Проверка | Результат |
|---|---|
| `npm ci` | PASS, 0 vulnerabilities |
| `npm run check` | PASS |
| `npm test` | PASS, 1440 / 768 / 390 / 320 |
| `npm run build` | PASS, 169 файлов, 38 121 176 байт |
| `npm run test:dist` | PASS, 1440 / 768 / 390 / 320 |
| `node tests/design-v2.cjs` | PASS, 4 ширины |
| `node scripts/check-rec003-integration.mjs` | PASS, фактическая V2.1 + тесты REC-003 |
| `node tests/design-v21.cjs` | PASS, 4 ширины, клавиатура, focus и цели 44 px |
| `git diff --check` | PASS |

SHA-256 путей и содержимого сборки: `dc26f9eecb0f092e6fe0ad7868cce2ce5dcba8037399cf68cf0fde301e3adacc`.

Регрессии покрывают фильтры и все квартиры, три вида схем, lightbox, масштабирование/pinch, галерею, шесть альбомов, калькулятор, скачивание одностраничного PDF, форму, меню, якоря, reduced motion, no-JS-контент и отсутствие горизонтального переполнения/ошибок JavaScript. Юридические документы проверены с JavaScript и без него. В стандартных тестах внешний iframe карты подменён стабильной заглушкой. Отдельный живой запуск с настоящей OpenStreetMap: HTTP 200, 0 page errors, 0 failed requests.

## Снимки до/после

Снимки и сборка не закоммичены. Полный локальный пакет: `/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review`.

`before/` — исходная V2; `after/` — готовая V2.1; `compare/` — пары в одном изображении, слева V2, справа V2.1. Все пары имеют одинаковую ширину окна и состояние. Снимки секций отключают только перекрывающую фиксированную шапку, кнопку наверх и декоративные фиксированные слои на время съёмки: иначе длинный PNG получает шов на границе viewport. Сам сайт не меняется. В `*-contact-viewport.png` и `*-modal.png` сохранён настоящий экран без скрытия элементов. Фотографии дождались загрузки; карта не является предметом визуальной приёмки.

| Состояние | 1440 | 768 | 390 | 320 |
|---|---|---|---|---|
| Три последних блока | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-ending.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-ending.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-ending.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-ending.jpg) |
| Футер | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-footer.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-footer.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-footer.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-footer.jpg) |
| Строительство | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-construction.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-construction.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-construction.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-construction.jpg) |
| Область новостей | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-news.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-news.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-news.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-news.jpg) |
| Карточка квартиры | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-plans.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-plans.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-plans.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-plans.jpg) |
| Заявка | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-contact.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-contact.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-contact.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-contact.jpg) |
| FAQ | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-faq.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-faq.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-faq.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-faq.jpg) |
| План в lightbox | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-modal.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-modal.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-modal.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-modal.jpg) |
| Hero | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-hero.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-hero.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-hero.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-hero.jpg) |
| Архитектура | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/1440-about.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/768-about.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/390-about.jpg) | [До/после](/Users/azm1982/.codex/visualizations/2026/10/27/01a17eab-fa9e-7a33-8ff9-dc4054242f11/design-v21-review/compare/320-about.jpg) |

## Ограничения и независимая приёмка

Публичные права на медиа остаются `permission_not_verified`. Push изображений, публикация, production deploy, DNS и merge не выполнялись. Backend, хранение согласий и CRM не подключались; форма прямо объясняет, что данные не отправляются. Визуальная и техническая проверка проведена в изолированном Chromium; поведение физических устройств и других браузеров отдельно не сертифицируется. Скриншоты и проверки focus не являются полным аудитом WCAG.

Предлагаемый маршрут приёмки: FAQ → ссылка «Обсудить с агентством» → блок заявки → футер; затем строительство и карточка квартиры на 390/320 px. Окончательное дизайнерское принятие — за владельцем.

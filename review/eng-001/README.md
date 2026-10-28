# ENG-001 — локальная приёмка

28 октября 2026. Реализована только обновлённая постановка Issue #13. Визуальное решение по футеру ожидает владельца.

- Preview: [http://127.0.0.1:4183/](http://127.0.0.1:4183/). Единственный адрес просмотра.
- Ветка: `codex/eng-001-filters-mortgage-footer`.
- Worktree: `/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya`.
- База V2.2: `1d79ebcab1f5fcf60be30bb6d5dd6baf7e5a0fa0`.
- Фильтры и ипотека: `eca1e8d`.
- Пробный футер: `9405c14` — отдельный коммит; его можно отклонить независимо от функциональной части.
- Итоговый HEAD передачи указан в сообщении приёмки; также доступен через `git rev-parse HEAD` в этом worktree.

## Результат

Фильтры по умолчанию свёрнуты. Кнопка рядом с режимами «Категории» / «Квартиры» управляет существующей панелью, показывает состояние и число активных условий; сброс доступен и при закрытой панели. В режиме категорий кнопка скрыта. Выбор сохраняется при закрытии и переключении режимов. Enter/Space открывают панель, Escape закрывает и возвращает фокус. Само раскрытие не перерисовывает карточки. Без JavaScript доступны все 28 квартир через нативные группы.

Обе ипотечные карточки открывают калькулятор: 2% с минимальным взносом 10%, 6% с минимальным взносом 20%. Больший взнос, срок, цена, ID квартиры и вариант её схемы сохраняются. При ручной смене ставки режим становится «Индивидуальная ставка». Предупреждение при превышении лимита 6/12 млн ₽ совпадает в интерфейсе, PDF и контексте формы. Проверены оба перехода между программами, точные границы лимитов и выбранная квартира ID 23037. «100% оплата» по-прежнему запрашивает прайс. Серверной отправки нет; форма сообщает «Данные не отправлены».

В футере сохранены тёмный фон, верхняя композиция и контакты агентства. Крупный контейнер оператора удалён; реквизиты даны одной спокойной строкой. Исходный `assets/logo-cropped.webp` показан в светлом монохромном оформлении через CSS. Оба юридических документа и отдельное согласие в форме сохранены. На мой взгляд, нижний уровень стал легче; окончательное визуальное решение остаётся за владельцем.

## Проверки

PASS: `npm ci` (8 пакетов, 0 уязвимостей), `npm run build` (169 файлов). SHA-256 сборки: `fa8bf71f2f80e50ed6b00f15905386910a627feb1c8a97faacf3c84c78c8fa31`.

Все браузерные тесты выполнялись с `QA_BASE_URL=http://127.0.0.1:4183/`: никаких дополнительных портов. Для проверки источников и dist использована одна и та же актуальная сборка. Проверка `preview-verification.json` сопоставляет каждый из 169 файлов source/dist/HTTP; для HTML нормализуются только служебная мета-ревизия и хеши кеширования preview.

| Проверка | Результат | Журнал |
|---|---|---|
| `npm run check` | PASS | [check.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/check.log) |
| `npm test` | PASS | [test.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/test.log) |
| `npm run test:dist` | PASS | [test-dist.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/test-dist.log) |
| `node tests/design-v2.cjs` | PASS | [design-v2.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/design-v2.log) |
| `node tests/design-v21.cjs` | PASS | [design-v21.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/design-v21.log) |
| `node tests/design-v22.cjs` | PASS | [design-v22.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/design-v22.log) |
| `node scripts/check-rec003-integration.mjs` | PASS | [rec003.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/rec003.log) |
| `node tests/eng-001.cjs` | PASS | [eng-001.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/eng-001.log) |
| `node tests/eng-001-footer.cjs` | PASS | [footer.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer.log) |
| `git diff --check` | PASS | [diff-check.log](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/diff-check.log) |

Новые сценарии проверяют мышь, клавиатуру, сохранение фильтров, сброс, корректность чисел и состояний ипотек, сохранение выбранного лота, фактические скачивания двух одностраничных PDF, контекст заявки, отсутствие ложной отправки и горизонтальной прокрутки. Ширины: 1440/768/390/320 px; no-JS — 320 px.

В `tests/design-v22.cjs` снята только прежняя заморозка HTML футера, явно изменяемого ENG-001. Её заменяют отдельные проверки `tests/eng-001-footer.cjs`; заморозка Hero, архитектурного блока, юридических документов и данных сохранена. Проверка REC-003 прошла на фактических источниках.

## Футер до/после

До — точная сборка исходной V2.2, после — ENG-001. Оба состояния сняты через 4183. Только на время снимка скрыты плавающая шапка и кнопка «наверх», чтобы они не перекрывали сам футер. Исходники сайта при съёмке не менялись. После сравнения preview возвращён на ENG-001.

| Ширина | До | После |
|---|---|---|
| 1440 px | [V2.2](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer-before-1440.png) | [ENG-001](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer-after-1440.png) |
| 768 px | [V2.2](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer-before-768.png) | [ENG-001](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer-after-768.png) |
| 390 px | [V2.2](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer-before-390.png) | [ENG-001](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer-after-390.png) |
| 320 px | [V2.2](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer-before-320.png) | [ENG-001](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/footer-after-320.png) |

PDF для приёмки: [2%](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/mortgage-regional.pdf), [6%](/Users/azm1982/.codex/worktrees/dom-u-morya-eng-001/dom-u-morya/review/eng-001/mortgage-family.pdf). В них сохранены конкретный лот, ставка, взнос и предупреждение о лимите.

Повторная съёмка: `node scripts/capture-eng001-footer.cjs` (временно выбирает исходную V2.2 на том же 4183 и обязательно возвращает текущий dist). Функциональные тесты: `QA_BASE_URL=http://127.0.0.1:4183/ npm run test:eng-001`; футер: `QA_BASE_URL=http://127.0.0.1:4183/ node tests/eng-001-footer.cjs`.

## Сохранённые границы

Галерея, карта, Hero, три вкладки архитектуры/двора/сервиса, фотография архитектурного блока, шаблон карточек, застройщик и компоновка ипотечных предложений сохранены. HTML защищённых секций, данные и content-model побайтно совпадают с базой; код галереи/lightbox и карты также не менялся. Сохранены 28 лотов, 19 групп и 84 SVG-связи.

Другие worktree, `main` и Draft PR #8 не изменялись. GitHub push, merge, deployment, DNS и серверная отправка не выполнялись. Результат передан только на локальную приёмку.

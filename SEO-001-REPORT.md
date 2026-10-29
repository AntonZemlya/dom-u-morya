# SEO-001 — локальная приёмка 29.10.2026

Основа: ENG-001 `007d3818c14a5faa82884618579a7b04aa48b4d2`, чистая ветка.
Worktree: `/Users/azm1982/.codex/worktrees/dom-u-morya-seo-001/dom-u-morya`.
Ветка: `codex/seo-001-onpage-performance`.
Единственный preview: http://127.0.0.1:4183/ .

## Этап 0

`npm ci`, `check`, `test`, `build`, `test:dist`, `test:eng-001`, REC-003 выполняются перед правками. Baseline: 169 файлов, 38 131 043 байта, SHA релиза `4a4580242771212f35efe01c42929e479ab27dfa048421eee3685ed5b9760a2c`.
SHA-256 57 оригиналов зафиксированы в `tests/seo-originals.json`; 28 лотов, 19 групп, 84 связи. Источники аудита прочитаны; данные цен и оригинальные медиа не редактируются.

Независимый от продуктового кода измерительный сценарий: `/private/tmp/seo-001-qa/measure.cjs`. Скриншоты и сырые измерения вне Git: `/private/tmp/seo-001-qa/before/`, затем `after/`. Chromium 1243, reduced motion, DPR 1 desktop/tablet и 2 mobile, чистый кэш, карта заменена одинаковой нейтральной заглушкой только в тесте. Три повтора каждой ширины и 4G (150 мс, 210000 B/s, CPU×4). Сравниваются медианы; это локальная лаборатория, не PSI/CrUX или полевой INP.

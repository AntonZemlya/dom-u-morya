# PAGESPEED-MOBILE-001 + LOGO-NAV-001 — независимая приёмка

Результат: Draft PR, без merge, staging и production deploy. База: `47854ca`.

## Что проверять

- [QA-отчёт](REPORT.md): методика, результаты, ограничения, кэш, rollback.
- [Замеры](measurements.json): все 12 запусков, медианы, waterfall, LCP-element.
- [Визуальное сравнение](visual-comparison.json): геометрия и пиксельные различия.
- [Защищённые инварианты](invariants.json): неизменность цен/каталога, API, согласий и SEO.
- `lighthouse-evidence.tar.gz`: исходные Lighthouse JSON, trace и DevTools log.
- `logs/`: CI, формы/SMTP, интерфейс, навигация, Apache/SEO/кэш.

## Изображения

В каждой паре слева — baseline, справа — candidate. Сверху вниз: первый экран,
архитектура, локация, строительство, контакты, футер. Анимации фиксированы,
карта в визуальной проверке заменена одинаковой локальной заглушкой;
проверка реальной карты и сетевых запросов выполняется отдельно.

- [1440 px](visual-1440.jpg)
- [768 px](visual-768.jpg)
- [390 px](visual-390.jpg)
- [320 px](visual-320.jpg)

Полная матрица JS ON/OFF отражена в JSON и логах; контактные листы показывают JS ON.

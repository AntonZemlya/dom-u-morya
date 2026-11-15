# PAGESPEED-MOBILE-001 — изолированная миграция Apache v2 → v3

База: `47854ca16001868a4c9e7e8f637491cc87c21919`.
Принятый scope PR #30: `94414a6bb277959d3fd82b6a61848e983d3191f0`.

## Публичное изменение

Только `.htaccess`, точные байты из принятого PR #30:

- v2: `86a28fe3e086dc73b1e901277080e79df5fbe0e178fcf5644b5a2c7437f877c7`;
- v3: `1412dd94ca93a9942cb0f679472294925496ca12c3e4317484b09e3c5f98504a`.

В package/production diff первой операции требуется ровно `replace .htaccess`.
Остальной public allowlist и SMTP runtime берутся из базового main. Сайт,
типографика, каталог, форма, согласия и Метрика здесь не меняются.

`ops/release_core.py`, его тест и runbook взяты побайтно из принятого PR #30.
Менеджер продолжает требовать exact SHA, изолированную миграцию, backup/rehearsal
и точный GO. Новые файлы менеджера не входят в публичный production allowlist.

Отдельный `ops/test_apache_cache_http.py` проверяет реальные Apache/PHP заголовки
GET/HEAD/304, замену файла по постоянному URL, content-hash immutable, PHP no-store
и защитные отказы. Тестовые файлы создаются только в disposable loopback docroot.

## Git-последовательность и границы

1. Этот scoped PR создан от актуального main отдельно от PR #30; merge требует
   отдельного явного разрешения владельца.
2. План миграции можно воспроизводимо подготовить из точного commit этого PR,
   но production apply возможен только по точному GO release manager.
3. Предпочтительная последовательность: разрешённый merge migration PR в main,
   сборка и независимый verify из итогового merge commit, новый read-only plan,
   точный GO APPLY и один штатный migration apply.
4. Затем актуализировать PR #30 относительно main и доказать, что его app scope
   сохранён; повторить CI. Одобренный merge PR #30 → пакет из exact merge commit →
   read-only plan без повторной миграции `.htaccess` → отдельный GO APPLY.
5. Если commit пакета изменяется после merge, прежние package/plan/GO не применять:
   пакет и план пересобираются. Ветка не должна сбрасывать main или терять PR #30.

Не объединять cache policy migration и основной файловый релиз. Нет staging,
прямых SCP/FTP, новых реальных заявок или согласий, удаления backup/release history.
До разрешения все remote операции — read-only. Plan/package и текущий preflight
сохраняются локально в `.release-output/apache-v3-migration/`; не публиковать полный
snapshot с приватными metadata в GitHub. Несекретная сводка и CI — в описании PR.

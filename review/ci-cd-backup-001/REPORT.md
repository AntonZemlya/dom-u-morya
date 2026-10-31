# CI/CD-BACKUP-001 — публичная передача на review

Ветка `codex/ci-cd-backup-001`, один Draft PR. Main и production не менялись.
Код прошёл собственное review; полная приёмка **BLOCKED по C2** — официально не
подтверждён учёт встроенных Jino backups в shared-hosting quota. Подробный отчёт
A–G и серверный inventory переданы владельцу локально вне Git после auto-review
запрета публикации этих данных в публичном репозитории.

## Проверки

- `npm run ci:fast`: **PASS**, 9 checks, 4.43 s.
- `PHP84_BIN=... PHP84_CGI_BIN=... npm run ci:full`: **PASS**, 26 checks, 169.27 s.
- **0 FAIL / 0 SKIP**; **28** synthetic release/backup/restore/security/CMS tests.
- Playwright Chromium: 1440/768/390/320, UI/форма/fake SMTP, PDF/catalog, SEO/performance.
- Production build из exact commit повторён с одинаковым SHA; read-only preflight/plan проверены.
- Публичных изменений нет: план noop, демонстрационного production apply не было.

Машинные результаты: [fast JSON](ci-fast.json), [full JSON](ci-full.json).
[Fast summary](ci-fast.md), [full summary](ci-full.md), [engine tests](engine-tests.txt).
После CI публичная история пересоздана с тем же кодом; изменена только публикация
документации/evidence. Побайтное сравнение всех implementation/test/workflow файлов
с проверенным локальным commit подтвердило отсутствие различий.
Все public source bytes и принятые SMTP/legal/consent контракты сохранены.

## Release и backup

Stdlib Python manager: exact commit, deterministic manifest/SHA/allowlist, read-only
preflight/plan/verify, owner GO с domain/release/package/plan/action, quota evidence,
одна проверенная backup-точка с restore rehearsal перед публикацией, flock,
openat/O_NOFOLLOW, durable receipts, replay/ID/drift/rollback guards. Config/runtime,
.envrc, постоянный guard и mutable state сохраняются. Старые rollout CLI заблокированы.

Retention: минимум две verified точки, pinned baseline, 14 дней, rollback/config
зависимости; dry-run по умолчанию и отдельный exact GO для prune. Legacy archives
и другие домены исключены из удаления. CMS export протестирован на synthetic fixture;
внешнее хранилище и ключ владельца — READY_NOT_CONFIGURED.

## Ограничения и следующий шаг

Полная приёмка требует закрыть C2 договором/ответом Jino и независимого review
Control Plane. Provider restore, реальный production apply/rollback/prune/export
не выполнялись: для них нужны отдельные GO. Публикация по файлам допускает краткое
смешанное дерево; assets должны быть совместимы. SMTP runtime migration требует
отдельного scope. Владелец выбирает external storage/certificate/key handling.

После review — отдельный merge GO. Первый apply новой системой проводить на следующем
полезном небольшом изменении: fresh quota, full CI, exact diff/package/plan и owner GO;
не менять сайт ради демонстрации. Runbooks: [CI](../../ops/CI.md),
[release](../../ops/RELEASE-RUNBOOK.md), [recovery](../../ops/RECOVERY.md),
[inventory](../../ops/BACKUP-INVENTORY.md), [retention](../../ops/RETENTION.md).

Полный перечень публично изменённых файлов: [changed-files.txt](changed-files.txt).

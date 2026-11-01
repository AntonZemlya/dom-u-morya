# Эксплуатация «Дома у моря»

Актуальный интерфейс: `python3 -B ops/release_manager.py release|backup ...`
(или `npm run release -- ...`, `npm run backup -- ...`).

- [CI fast/full и зависимости](CI.md).
- [Релиз и точный owner GO](RELEASE-RUNBOOK.md).
- [Rollback и disaster recovery](RECOVERY.md).
- [Инвентаризация Jino на 01.11.2026](BACKUP-INVENTORY.md).
- [Политика хранения, dry-run и отдельный GO prune](RETENTION.md).

Production уже опубликован, форма включена. Ни один read-only этап не создаёт
приватные папки на Jino. `apply` впервые создаёт `.dom-u-morya/manager-v1/` только
после точного GO. Новая система не управляет другими доменами, state заявок,
панельными бэкапами, DNS, SSL или почтой.

Архивные процедуры: [FORM-001](ARCHIVE-FORM-001.md), [FORM-004](FORM-004.md),
[SMTP rollout](SMTP-GO.md). Их main CLI заблокирован для новых запусков;
функции сохранены для локальных регрессионных tests. Не обходить блокировку.

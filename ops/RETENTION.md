# Политика хранения и очистка

Единственный источник параметров — `ops/release-policy.json`:
`keep_verified=2`, `protect_days=14`, `reserve_bytes=67108864`,
`quota_max_age_hours=24`. Внешняя копия: `READY_NOT_CONFIGURED`.

Менеджер управляет исключительно `.dom-u-morya/manager-v1/RELEASE_ID/`.
Исторические `.dom-u-morya/{releases,backups,form-004,security}` и все Rehab Profi
каталоги не включаются в executable prune. Панельные копии остаются у провайдера.

Сохраняются как минимум две последние verified точки, current и его ближайшая
предыдущая точка, закреплённый первый рабочий baseline, минимум одна verified копия
каждой критической config/runtime fingerprint. Каждая сохраняемая основная точка
дополнительно защищает непосредственного предшественника для корректного rollback
указателя. Пока есть unfinished/problem release, очистка всех точек блокируется.
Неизвестные файлы/receipt, повреждённый backup, symlink или несоответствие inventory
останавливают ротацию целиком.
`verified` требует шесть файлов: receipt.json, package.tar.gz, manifest.json,
plan.json, backup.tar.gz и backup.json. Проверяются точный состав/0600, package SHA,
совпадение встроенного/stored manifest, plan SHA/commit/baseline и receipt GO/package/
backup SHA, архивные bytes/modes и evidence after/HTTP. Нельзя считать отсутствующий
backup.json «необязательным» и пропускать проверку. Нарушение даёт STOP в list,
prune-plan и под lock перед первым удалением. Для завершённых фаз после backup
действует тот же обязательный набор; reserved не становится verified автоматически. Backup до 14 дней защищён даже при наличии альтернатив.

```sh
npm run backup -- list
npm run backup -- verify --release-id RELEASE_ID
npm run backup -- prune --dry-run --output .release-output/prune.json
```

Без `--go` prune всегда dry-run. План содержит точные пути/ID, возраст, объём,
причину, verified alternatives, rollback dependency, общий reclaim и SHA inventory/policy.
Отдельный GO владельца: `GO PRUNE zhk-dom-umorya.ru PLAN PLAN_SHA256`.
После проверки **точного** файла плана:

```sh
npm run backup -- prune --plan .release-output/prune.json --go 'EXACT_PRUNE_GO'
```

Внутри lock повторно проверяется весь inventory до первого удаления. Любое изменение
требует нового плана и GO. Удаляется целиком связанный набор package/manifest/backup;
небольшие receipt/tombstone остаются, запрещая повторное использование release ID.
Reclaim — верхняя оценка освобождения payload: размеры в байтах не равны allocated
blocks, tombstone занимает небольшой объём. При прерывании удаления неполный inventory
требует ручного разбора; повторный prune не продолжит удаление незаметно.

Автоматического cron/удаления нет. Для historical archives сначала отдельно подтвердить
работающее восстановление и проверенную альтернативу, срок защиты и зависимости,
подготовить новый scoped cleanup plan и получить отдельный GO. Этот менеджер никогда
не удалит их; для Rehab Profi в этой задаче разрешён только read-only аудит.
State заявок и персональные данные не входят в release backup: их регламент — Issue #18.

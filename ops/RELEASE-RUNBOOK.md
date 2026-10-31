# Релиз: универсальный менеджер

Только `zhk-dom-umorya.ru`, SSH alias `rehab-profi-jino`, фиксированный home из существующей конфигурации проекта. Код: `release_manager.py` (локальная CLI/HTTPS),
`release_core.py` (stdlib Python 3.6 на Jino), `release-policy.json`.
Привязок к историческим FORM commit/package/baseline в новом менеджере нет.

## До GO: только чтение сервера

1. Из актуального main создайте одну ветку/worktree, внесите изменения, выполните
   `ci:fast` и `ci:full`, проведите review, закоммитьте. Main не менять без owner merge GO.
2. Постройте пакет из полного SHA commit. Используется чистый `git archive`,
   production origin, явный allowlist, зафиксированный Composer runtime; ignored dist
   и незакоммиченные файлы не входят. Необходимы установленные npm/vendor dependencies.
3. Проверьте архив независимой повторной сборкой. Формат содержит manifest,
   public и несекретный private SMTP runtime; config/state в пакет не входят.
4. В панели Jino прочтите текущую квоту и использование. Сохраните локально
   `.release-output/quota.json` с `source: "Jino panel"`, `observed_unix` (UTC epoch),
   `limit_bytes`, `used_bytes`. При округлённых значениях используйте меньший limit
   и больший used. Измерение старше 24 часов блокирует apply. `df` используется
   лишь как дополнительный ограничитель свободного места файловой системы.

```sh
npm run release -- build --commit FULL_COMMIT
npm run release -- verify --archive ARCHIVE --sha PACKAGE_SHA256
npm run release -- preflight --archive ARCHIVE --sha PACKAGE_SHA256 --quota-evidence .release-output/quota.json --output .release-output/preflight.json
npm run release -- plan --release-id release-YYYYMMDD-N --archive ARCHIVE --sha PACKAGE_SHA256 --quota-evidence .release-output/quota.json --output .release-output/plan.json
npm run backup -- list
npm run backup -- prune --dry-run --output .release-output/prune.json
```

JSON-файлы, используемые как `--plan`, создавайте прямым `python3 ... --output ...`;
не перенаправляйте stdout `npm run` в JSON: npm добавляет свои служебные строки.
Все output в примерах — локальные файлы. SSH worker исполняется из памяти с `-B`;
не загружает скрипты, не создаёт lock/каталоги на read-only этапах.
Preflight сверяет SSH inventory, modes/owners, `.envrc`, config и SMTP runtime,
HTTPS/TLS/DNS, enabled/ready, API GET 405 и dotfile 403/404. Никаких POST.
Plan содержит полный baseline, точный add/replace/delete diff, commit, package SHA,
policy/inventory SHA. При отсутствии diff он возвращает `action=noop`, `go=null`:
такой план нельзя применить, резервная копия не создаётся.

## Точный GO и применение

Владелец рассматривает полный план, CI, scope и риски и отдельно пишет строку
`go` из JSON, например:

`GO APPLY zhk-dom-umorya.ru RELEASE_ID PACKAGE_SHA256 PLAN PLAN_SHA256`

Запрос разработки, SHA сам по себе и старые GO не разрешают запись. CLI проверяет
полное совпадение; подставлять эту строку без реально полученного GO нельзя.
После разрешения оператор запускает:

```sh
npm run release -- apply --archive ARCHIVE --sha PACKAGE_SHA256 --plan .release-output/plan.json --quota-evidence .release-output/quota.json --go 'EXACT_OWNER_GO'
```

Apply получает общий flock, перепроверяет snapshot, inventory, policy, quota и
каждый изменяемый файл. Создаёт один приватный release ID 0700, пакет/plan/receipt
0600, один backup публичного baseline, config и активного SMTP runtime. Backup
связан с исходным production и новым package SHA; архив проверяется по SHA,
составу и permissions, затем разворачивается в отдельную rehearsal-папку внутри
авторизованной подготовки и сравнивается. Только после этого начинается публикация.
State заявок не читается и не резервируется. Неизвестные файлы, symlink/hardlink,
повреждённые tar, traversal, чужие владельцы и незавершённые релизы блокируют запись.

`.htaccess` (если меняется) публикуется первым, index — последним, каждый файл
через fsync + atomic replace. `.envrc`, config, установленный runtime, DNS/SSL
не изменяются. SMTP dependency migration намеренно требует отдельного review:
при смене публичного runtime descriptor или установленных runtime bytes STOP.
Такая миграция не может быть замаскирована обычным website release.

Запись по файлам не обеспечивает атомарный switch всего сайта: краткий смешанный
набор возможен; меняйте совместимые ресурсы, для переименований используйте двухфазный
релиз (сначала добавить новые assets, затем удалить старые отдельным релизом).
Все операторы должны пользоваться этим lock; изменения через панель/FTP во время
релиза запрещены процедурой, внешние процессы не обязаны уважать flock.

## Verify, статус, потеря ответа

После записи сверяются все SSH public SHA и защищённые metadata, затем все
публичные статические файлы по HTTPS, готовность формы и security GET. Только
подтверждённый результат переводит receipt из `awaiting_http_verify` в `verified`.

```sh
npm run release -- status --release-id RELEASE_ID
```

При потере SSH/HTTPS ответа STOP. Не повторять apply: release ID навсегда занят,
включая rolled_back/pruned. Для `awaiting_http_verify` после восстановления доступа
можно тем же разрешением завершить только проверку/attestation:

```sh
npm run release -- finalize --archive ARCHIVE --sha PACKAGE_SHA256 --plan .release-output/plan.json --quota-evidence .release-output/quota.json --go 'EXACT_ORIGINAL_OWNER_GO'
```

Если файл скопирован частично или случилась ошибка записи при живом worker, движок
пытается восстановить только scoped public files из проверенного backup. Любой
drift либо ошибка восстановления оставляет `recovery_required`; слепой retry запрещён.
При жёстком завершении worker receipt остаётся `publishing`/`rolling_back`; используйте
[RECOVERY.md](RECOVERY.md). Mutable state не откатывается.

## Первый релиз новой системой

Сначала независимая приёмка Control Plane: проверить diff, отчёты и негативные
fixtures, воспроизводимость пакета, прочитать preflight/план. Текущий PR не меняет
публичных файлов, поэтому честный план для него — noop. Не изменять сайт только
ради демонстрации deploy. Первый реальный apply выполните на следующем полезном
небольшом совместимом изменении, после merge GO, полного CI и отдельного package/plan GO.
Production apply/rollback/prune в CI/CD-BACKUP-001 на Jino не выполнялись.

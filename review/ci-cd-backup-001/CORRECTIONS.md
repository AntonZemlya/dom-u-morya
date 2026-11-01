# Correction pass — три P1, PR #21

Основание: [Control Plane REQUEST_CHANGES](https://github.com/AntonZemlya/dom-u-morya/pull/21#issuecomment-6549954208).
Та же ветка/worktree и Draft PR; архитектура, public bytes и настройки production сохранены.

1. **Apache policy.** Package verify, production snapshot/preflight и backup verification
   принимают только exact SHA-256 ранее принятого `.htaccess`. Обычный release сохраняет
   его bytes/metadata; любые новые директивы требуют отдельного security scope/review.
   Regression сохраняет marker/`Require all denied`, добавляет разрешение/обход и
   проверяет отказ. Новый изолированный loopback Apache демонстрирует реальное 200 у
   слабого fixture, затем 403/404 у принятой policy (GET/HEAD), ACME 200 и cleanup.
2. **Export GO.** Read-only `backup export-plan` читает только metadata. Отдельный
   `GO EXPORT` связан с domain, backup ID (= release ID одной точки), backup SHA,
   SHA-256 DER-сертификата получателя, точным абсолютным destination и SHA всего плана.
   CLI проверяет всё до SSH, worker — до archive read/extraction/encryption. Нет GO —
   нет export. Подмена каждого параметра и GO другого действия отклоняются; bundle
   сертификата с private key не передаётся на сервер. Positive synthetic CMS roundtrip
   проходит, ciphertext записывается только в согласованный новый файл 0600.
3. **Inventory integrity.** Для завершённых точек обязательны все шесть файлов:
   receipt.json, package.tar.gz, manifest.json, plan.json, backup.tar.gz, backup.json.
   Проверяются 0700/0600, archive/member SHA/modes, embedded/stored manifest,
   plan/receipt/commit/package/backup/after/HTTP consistency. `verified` не заменяет
   проверку данных. Потеря любого файла, corrupt archive или разногласие metadata
   даёт STOP в list, prune-plan и под lock в prune до удаления. Reserved и pruned
   tombstones не интерпретируются как verified restore points.

CI results находятся рядом в REPORT.md и JSON. Финальные HEAD/package/Actions и
read-only noop-plan передаются correction-комментарием в том же PR. Полный серверный
inventory и quota metadata остаются в приватной локальной передаче владельцу.

**C2 остаётся UNCONFIRMED** до официального письменного ответа Jino. Ни synthetic
проверки, ни свежие panel quota evidence его не закрывают. External copy остаётся
READY_NOT_CONFIGURED. Production apply/rollback, реальный export, merge и удаление
серверных архивов в correction pass не выполняются.

# GO A harness — повторная локальная приёмка, 31.10.2026

**LOCAL PASS, READY FOR RE-REVIEW.** Jino SSH/HTTP не вызывались, production не менялся,
публичная форма не включалась, реальные SMTP-письма не отправлялись. LOCAL PASS
прежнего кода не считается owner GO: [Control Plane](https://github.com/AntonZemlya/dom-u-morya/pull/17#issuecomment-6542206436).

Исходники для просмотра: [контроллер](../../ops/smtp_e2e.py),
[Jino worker](../../ops/smtp_e2e_remote.py), [PHP wrapper](../../ops/smtp_e2e_wrapper.php),
[тесты](../../ops/test_smtp_e2e.py). Точные команды, разрешения и recovery:
[GO A](../../ops/SMTP-GO.md). В production-allowlist wrapper не добавлен.

## Проверки

`npm run test:smtp-e2e` — **9/9 PASS**, 0 failures/errors. Реальный Apache 2.4/TLS,
PHP **8.4.14 FastCGI** с openssl/ctype/filter для no-send web runtime; PHP **8.4.27
cli-server** за тем же Apache/TLS и loopback TLS SMTP sink для transport fault tests.
Производственный профиль требует web SAPI и фиксированный Jino HOME/Origin;
локальный профиль ограничен `/private/tmp/dom-smtp-e2e-test-*` и 127.0.0.1.
Флаги и реализация SMTP endpoint не менялись ради этих тестов.

| Сценарий | Подтверждённый результат |
| --- | --- |
| FastCGI no-send | Authenticated preflight 200, PHP 8.4, runtime/trust store checked; attempt=dry_run, callback invocation=1, SMTP DATA=0; повтор 409; после cleanup 404/false/503 |
| Один SMTP в sink | DATA=1, callback=1, attempt и invocation markers видны уже при AUTH/MAIL/RCPT/DATA, AUTH только внутри TLS; получен полный MIME, один экземпляр; повтор HTTP=409 |
| Invalid auth/method/body/action/Origin, expiry | 404 до invocation, SMTP=0; проверена истёкшая граница TTL 120 сек без ожидания реальных двух минут |
| Forced client timeout после DATA | DATA=1, response uncertain; finally удаляет wrapper, read-only verification подтверждает прежние SHA/mtime/mode/uid/gid/size и config; HTTP 404/false/503; pending marker/state остаются, resend=0 |
| Drift и install failure | Раздельные hash/mtime/mode изменения останавливают install; принудительная ошибка atomic link вызывает cleanup без SMTP; неизвестный ранний исход install также проверяет отсутствие пути |
| GO/архив | Старый/неточный GO останавливается до HTTP/SSH; неверный SHA и unsafe tar отвергаются |
| Повтор всей команды | Новый URL/token/run ID с **тем же owner GO** не даёт второго transport; долговечный approval tombstone сохранён, суммарный DATA=1 |
| Изменённый wrapper | Cleanup отказывается удалять чужое содержимое; после восстановления собственного файла удаление подтверждено |
| Lost install ACK / failed cleanup recovery | finally очищает успешно установленный wrapper при потерянном ACK; отдельный сбой cleanup явно возвращает cleanup_required; recovery удаляет только свой путь, подтверждает HTTP, retains markers, SMTP=0 |

В каждой из девяти изолированных сред: **0 оставшихся public wrapper**, все процессы
остановлены; исходный fixture production state сохранил SHA/mtime/mode/uid/gid/size;
в технических логах нет имени, телефона, email, fixture username/password или base64
пароля. TLS keys/config/captured MIME удалены с временными каталогами. Другие preview
и порт 4183 не затрагивались. JSON с точными счётчиками и SHA исполненных исходников:
[harness-results.json](harness-results.json). Rendered no-send wrapper оставлен только
локально: `.test-output/e2e/wrapper.no-send.rendered.php`; сырого token/credentials там нет.

Регрессии: `npm run check`, `npm run test:smtp-package` — PASS. Повторно `npm run test:form`
на PHP 8.4.27: **68 contracts PASS**, HTTP → PHPMailer → TLS sink, полученное MIME,
TLS/auth/errors/replays/timeout, full family/manual calc и browser 1440/768/390/320 — PASS.
Существующий `npm run test:security` и синтаксис PHP/Python проверены отдельно.

## Повторяемая упаковка и условия следующего этапа

После коммита: `ops/smtp_package.py`, затем `ops/smtp_e2e.py package` создают **два**
связанных неизменяемых архива: прежний SMTP format (10 members) и отдельный harness
(5 members: controller, worker, wrapper, deployed public SHA allowlist, manifest).
Новый commit меняет SMTP archive SHA даже при неизменных payload files.
Точные commit/SHA/размеры, AUTH identity и буквальные GO A строки находятся в
`.release-output/form-002/package.json`, `go-a.json` и обновлённом описании PR.
Строки GO являются запросом будущего разрешения, а не подтверждением его получения.

После повторной приёмки владелец отдельно разрешает send-once на Яндекс. Настройка
секретов — пользователем непосредственно в private config. Read-only baseline snapshot
должен предшествовать run; любой дальнейший drift останавливает процедуру. В режиме
no-send production install тоже требует отдельного GO на filesystem writes.
При timeout/неизвестном исходе нельзя создавать новый AUTH identity без нового
разрешения. Approval/attempt tombstones не удаляются cleanup. Они намеренно не имеют
автоматического TTL: истечение 120 сек закрывает wrapper, но не возобновляет право отправки.

SMTP sink не доказывает SPF/DKIM/Inbox Jino. Получение одного письма и заголовки
проверяет владелец Яндекса после отдельного GO. Финальный получатель и включение
по-прежнему требуют GO B/C и правовой редакции. Старые favicon/design/catalog/SEO/legal
и все production PHP исходники совпадают с уже принятым `edbd496`.

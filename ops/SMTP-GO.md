> АРХИВ: историческая процедура FORM-001/004. Для новых релизов используйте [универсальный runbook](RELEASE-RUNBOOK.md). Старые rollout CLI заблокированы; приведённые ниже GO и команды не применять.

> FORM-004, 31.10.2026: действующий единый релиз описан в [FORM-004.md](FORM-004.md).
> Исторические GO A ниже выполнены и повторно не разрешены. Отдельный GO B и
> старые флаги DELIVERY_VERIFIED_TO для info@anyara.ru отменены решением владельца.
> Не применять прежние команды enable или отправки. Для текущего кода используйте
> только пакет FORM-004 и новый точный GO PROD FORM.

# FORM-002 / SMTP-001: независимая приёмка и отдельные GO

Статус: **LOCAL PASS принят Control Plane; исполняемый GO A harness подготовлен для повторной приёмки.**
Production не изменён, реальные письма не отправлялись; owner GO A ещё не получен.
Основание дополнения: [Control Plane в PR #17](https://github.com/AntonZemlya/dom-u-morya/pull/17#issuecomment-6542206436).
Основание — [последний комментарий Issue #7](https://github.com/AntonZemlya/dom-u-morya/issues/7#issuecomment-6541887257), заменяющий PHP `mail()`.
База — опубликованный `c1a32fa85c16d9e2c2b40588de8be5daa92d7801`, прежний пакет
`045fc7e11ffc55b4b19f10e895c50ce82f409608f6dd798dbd37d1d8b0059e7d`.
Draft PR сравнивается с отдельной веткой этой базы: main ещё не содержит FORM-001.
Merge Draft PR в main сейчас не предусмотрен. GitHub CI не запускался.

## Что принимает независимый проверяющий

1. Diff от точной базы ограничен SMTP, письмом, тестами, упаковкой и этим протоколом.
   `index.html`, `script.js`, `styles.css`, favicon, исходный каталог, SEO и legal документы
   побайтно прежние. Согласие пустое, телефон/email доступны, form-status без конфига false.
2. PHP 8.4 + PHPMailer **7.1.1**, lock reference
   `1bc1716a507a65e039d4ac9d9adebbbd0d346e15`, лицензия LGPL-2.1-only сохранена.
   Runtime identity: `2cbd3e288b8a83ef3aea7fc1400e4ce32854f17bc75372b362ae283f7c343dc5`.
   Все четыре upstream SHA-256 закреплены в `api/smtp-manifest.php` и проверяются
   до загрузки кода. Новый runtime: только приватная папка вне webroot, 0700/0600.
3. Нет `mail()` fallback, debug-транскриптов, автописем посетителю или внешнего хранилища.
   From/envelope=`sales@zhk-dom-umorya.ru`; единственный To задаёт серверный allowlist
   (`azm1982@yandex.ru`, позднее `info@anyara.ru`). JSON-поля получателя отклоняются.
   Валидный optional email используется в Reply-To, отсутствующий заголовок опускается.
4. `smtp.jino.ru:587` + обязательный STARTTLS/AUTH LOGIN; сертификат и peer name
   проверяются системным CA. 465+smtps — только явная смена приватного конфига после
   отдельного решения, автоматического перебора серверов/портов нет.
   [Официальные параметры Jino](https://o.jino.ru/help/faq/email-clients/common-settings/),
   [пояснение SMTP](https://o.jino.ru/help/faq/email-general/what-is-smtp/).
5. Полное текстовое MIME-письмо: тема с ID, время UTC, оператор, контакты посетителя,
   источник/вид обращения, способ/время связи, категория/лот/номер/этаж/площадь/цена
   из серверного снимка каталога, вид плана, пользовательские параметры расчёта,
   подтверждение/редакция/время согласия. Пустые optional поля опущены.
   `api/lead-catalog.php` — производная копия только нужных полей исходного каталога;
   исправляет обращение к отсутствующему в release JSON. Ни один лот/цена не менялся.
   Manual-rate `program:null` существующего UI нормализуется в `custom` на сервере.
6. POST/Origin/JSON/8 KiB, Unicode/CRLF, honeypot, consent, rate limits остаются.
   Файловый lock, HMAC IP/тела/ключа, pending сохраняется **до** SMTP. Только успешный
   финальный DATA ACK даёт 202. Disconnect/timeout/exception → отказ или неопределённость;
   автоматической повторной отправки нет. UI сохраняет key в памяти вкладки.
   Accepted ключи живут 24 ч, uncertain/failed — 7 суток; одинаковый payload с другим
   ключом дедуплицируется 10 минут. Это ограниченные окна, не гарантия exactly-once
   навсегда; после истечения окна или изменения полей нужна осторожность оператора.
   Потерянные uncertain-маркеры не удалять ради повтора. Состояние не содержит ПДн.
7. FORM_ENABLED + DELIVERY_VERIFIED + LEGAL_APPROVED — совместные флаги.
   DELIVERY_VERIFIED_TO и LEGAL_MAIL_TO должны совпадать с текущим MAIL_TO.
   Смена получателя требует новой проверки. Конфиг 0600 и его папка 0700 проверяются;
   missing/unsafe runtime, конфиг или зависимость → fail closed.
   Локальный SMTP override работает только при CLI/cli-server + явном env-флаге,
   host=127.0.0.1; в веб PHP Jino он недоступен.

## Воспроизведение локального QA

Нужны Node 20+, Python 3, OpenSSL CLI, Composer, PHP **8.4** с openssl/ctype/filter,
Playwright Chromium. Никаких Jino credentials для локальных проверок не требуется.

```sh
composer install --no-dev --prefer-dist --no-plugins --no-scripts
npm ci
npm run check:smtp
npm run check
npm run build
PHP84_BIN=/path/to/php84 npm run test:form
npm run test:smtp-package
npm test
npm run test:dist
npm run test:eng-001
npm run test:seo
npm run test:previews
npm run test:security
git diff --check
```

`test:form` использует **dist**, настоящий PHP HTTP endpoint и PHPMailer → локальный
TLS SMTP sink, декодирует фактически принятый MIME стандартным Python email parser.
Тестовый CA и фиктивные credentials создаются только для loopback. Проверяются и
ошибки CA/имени/STARTTLS/AUTH/RCPT/DATA, потерянный ACK/тайм-аут, повторы, полный
лот 22825 + family 20/20/6 + optional email/Telegram/12–15, no-JS и четыре ширины.
Секреты, .eml, конфиг и state удаляются в finally. Скриншоты без заполненных полей:
`.test-output/form-002/`. Отчёт: `review/form-002/QA.md`.

## Неизменяемый scoped пакет

После коммита проверенного дерева: `python3 -B ops/smtp_package.py`.
Результат `.release-output/form-002/smtp-update.tar.gz` + `package.json` с точными
commit/SHA-256/размером. Повторная упаковка побайтно совпадает; утилита не использует SSH.
Общий `dist` остаётся локальным и не является командой публикации.

Архив содержит ровно **10 regular members**: manifest, четыре public PHP-файла
(`lead-core`, `lead-smtp`, `lead-catalog`, `smtp-manifest`) и пять private members
(три исходника PHPMailer, LICENSE, upstream manifest). Никаких credentials/config,
всего vendor, favicon, HTML, JS, CSS или других сайтов в update-архиве нет.
Manifest задаёт base, reviewed commit, runtime identity и SHA каждого файла.
Публичный allowlist полной сборки тоже расширен только этими PHP-файлами.

Старая `ops/release.py` — скрипт первоначального FORM-001 rollout; package/prepare/
deploy/probe/enable намеренно останавливаются для SMTP-ветки до любых remote вызовов.
Она не умеет миграцию текущего сайта и приватного SMTP runtime. Не обходить блокировку.
Постоянного тестового маршрута и автоматического включения формы нет.

## GO A: один SMTP E2E на Jino при выключенной форме

Механизм представлен исходниками **до GO**, локально проверен; на Jino не исполнялся.
Контроллер `ops/smtp_e2e.py`, worker `ops/smtp_e2e_remote.py` (Python 3.6 совместим с Jino),
шаблон `ops/smtp_e2e_wrapper.php`, тесты `ops/test_smtp_e2e.py`. В `RELEASE_FILES`
wrapper не входит. Источники PHP формы остаются как в принятом `edbd496`.

До любых Jino writes/отправки владелец отдельно разрешает точные **commit + SMTP SHA +
harness SHA + mode + recipient + AUTH identity**. Старый принятый SMTP SHA
`3ec66fa93ade03694c3fc98313c9e39c6fbec0c3277080b54d1158845d5e27c4` не является GO для
нового механизма. Актуальные полные идентификаторы и буквальные строки разрешения
формируются после коммита в `.release-output/form-002/go-a.json` и приводятся в PR.

### Воспроизводимая подготовка и точные команды

Следующие команды выполняются **локально**, не обращаются к Jino:

```sh
PHP84_BIN=/path/to/php84 PHP84_CGI_BIN=/path/to/php84-cgi npm run test:smtp-e2e
python3 -B ops/smtp_package.py
python3 -B ops/smtp_e2e.py package
python3 -B ops/smtp_e2e.py plan --harness-sha <harness_sha256>
```

CLI и CGI должны быть PHP 8.4 с openssl/ctype/filter; HTTPD_BIN задаёт Apache.
Тесты используют отдельные случайные loopback-порты и не трогают 4183.
Результаты и хеши исходников: `.test-output/e2e/results.json`; фактически исполненный
no-send wrapper: `.test-output/e2e/wrapper.no-send.rendered.php` (только token hash,
тестовые пути/публичные метаданные, без credentials). Оба файла локальные и игнорируются Git.

Новый **отдельный** `smtp-e2e-harness.tar.gz` содержит пять regular members: три
reviewable исходника, `published.json`, manifest. Контрольный manifest связывает его
с commit и точным SMTP SHA; SHA всех members проверяются. `published.json` получен
офлайн-сборкой именно deployed `c1a32fa`, с production origin; это allowlist всех
прежних public SHA. SMTP update остаётся отдельным 10-member архивом без секретов.
Оба архива воспроизводимы. `plan` выводит только план и требуемую строку GO, remote calls=0.

**Ни одна из следующих Jino-команд сейчас не выполнялась.** После повторной приёмки:

1. Пользователь непосредственно в защищённом Jino config настраивает SMTP, сохраняя
   HMAC/state и все флаги выключенными. Пароля/username нет в CLI, SSH argv, stdout,
   `go-a.json` или пакете; инструмент не редактирует config и не сбрасывает пароль.
2. Read-only snapshot (должен предшествовать утверждённому запуску):

   ```sh
   python3 -B ops/smtp_e2e.py snapshot --harness-sha <harness_sha256> --baseline /private/tmp/dom-e2e-baseline.json
   ```

   Сверяет весь public file set/SHA с c1a32fa, public modes 0644 и config 0600/
   private dir 0700. Сохраняет baseline 0600 с SHA/mtime_ns/mode/uid/gid/size,
   включая .envrc и fingerprint config, без содержимого config. Не пишет на Jino.
   После snapshot config/файлы не менять: drift блокирует install и verification.
3. **Только после точного owner GO** передать его буквальную строку в `--go`:

   ```sh
   python3 -B ops/smtp_e2e.py run --harness-sha <harness_sha256> --baseline /private/tmp/dom-e2e-baseline.json --mode send-once --go '<go_send_once из go-a.json>'
   ```

   `go_send_once` имеет формат `GO A <commit> <smtp_sha> <harness_sha> send-once
   azm1982@yandex.ru AUTH <128-bit identity>`. AUTH — публичная идентичность разрешения,
   **не** HTTP-token или mailbox secret. Разрешение включает приватный install, wrapper
   на 120 секунд, no-send web preflight, одну синтетическую SMTP-попытку и cleanup.
   Неизвестный/старый GO отклоняется до SSH/HTTP. CLI проверяет собственные три исходника
   против harness archive, а SMTP archive — против разрешённого SHA.
   Для Jino **no-send** есть отдельный `--mode no-send` + `go_no_send`; даже он требует
   отдельного GO, поскольку установка временного wrapper меняет production filesystem.
4. Run ID возвращается даже при ошибке/неопределённом результате. Если `cleanup_required`
   true, до любых дальнейших действий выполнить **только восстановление очистки**:

   ```sh
   python3 -B ops/smtp_e2e.py cleanup --harness-sha <harness_sha256> --baseline /private/tmp/dom-e2e-baseline.json --run-id <run_id>
   ```

   Это удаление уже установленного собственного wrapper, без отправки, отдельного
   разрешения на новое письмо не создаёт. Изменённый/чужой wrapper не удаляется автоматически:
   STOP и ручная проверка владельцем. SIGINT/SIGTERM и HTTP/SSH exception ведут в finally;
   kill -9/потеря связи могут потребовать эту recovery-команду. TTL запрещает SMTP,
   но не заменяет физическое удаление файла.

### Инварианты исполняемого механизма

- Фиксированы SSH alias и единственный HOME/docroot Jino; нет параметров другого сайта.
  Проверка baseline выполняется до install, непосредственно перед единственной public
  записью и после удаления. Любой hash/mtime/mode drift → STOP. Сверяются также uid/gid/size.
- Только allowlisted regular tar members с проверенными SHA; запрет symlink/hardlink/
  duplicate/../absolute/unlisted. Приватные каталоги 0700, candidate/runtime/state/receipt
  0600. Public файл появляется атомарно через exclusive hardlink приватного non-secret
  rendered source (0644 внутри 0700 run dir); требуется та же файловая система.
  Ни public handler, ни config, ни .envrc не перезаписываются. При неизвестном исходе
  install finally также проверяет отсутствие wrapper и исходные метаданные.
- Header-only 256-bit token живёт в памяти контроллера; PHP получает только hash(token)
  в коде, constant-time comparison. HTTPS/Origin/Host, POST-only, пустое тело, no-store/
  noindex. Разрешены только preflight/attempt, fixture нельзя заменить входящим JSON.
- Runtime preflight не открывает SMTP: web PHP 8.4, openssl/ctype/filter, trust-store
  presence, file hashes/permissions, точный MAIL_TO и false/empty approval flags.
  Наличие trust store не доказывает пригодность сертификата Jino; это проверяет реальный TLS.
- Общая цепочка `validate → accept → message → smtpTransport`; config загружается по
  фиксированному абсолютному пути. В persisted config/state нет изменений: E2E state
  изолирован в private run dir. В no-send callback возвращает dry_run **без вызова SMTP**.
- Два долговечных барьера: private approval reservation блокирует повтор **целой команды**
  с тем же GO, attempt marker через exclusive create + fsync блокирует повтор HTTP.
  Оба создаются до SMTP. Callback invocation также фиксируется до transport, без payload.
  Даже неизвестный исход/провал preflight не разрешает повторное использование GO.
  Новый AUTH identity допускается только отдельным явным разрешением владельца;
  агент не должен придумывать новое разрешение после timeout. Cleanup барьеры не удаляет.
- Finally удаляет только публичный wrapper с ожидаемым SHA, сохраняет receipt/markers/
  candidate/runtime для аудита, проверяет filesystem/config и fresh HTTP 404 + status false
  + lead POST 503. Нет retries SMTP, downgrade, альтернативного порта или попытки включить форму.

### Последовательность GO A

1. Только read-only preflight целевого домена: baseline inventory/hashes/modes,
   form-status enabled:false, наличие защищённой .envrc и постоянного dotfile guard,
   HTTPS, MX/SPF/DKIM, свободное место, отсутствие неожиданных изменений. Другие сайты,
   PHP CLI 8.1, DNS, .envrc, панель SMTP и пароль существующего ящика не изменять.
   При расхождении baseline остановиться и пересмотреть diff, не перезаписывать.
2. Зафиксировать неизменяемый baseline public/config метаданных в приватном receipt.
   GO A сохраняет существующие файлы и config; дополнительные копии credentials
   не создаёт. Полный backup перед их заменой относится к GO C.
   Содержимое config не печатать и не переносить в Git, чат или общие логи.
   Проверенный worker распаковывает tar по allowlist: запрет absolute/../symlink/
   duplicate/unlisted members, проверка всех SHA перед копированием, umask 077.
   Сначала **весь кандидат**, включая public PHP, положить в приватный
   `.dom-u-morya/candidates/<smtp-archive-sha>/api/`; public handlers пока не заменять.
   PHPMailer положить в `.dom-u-morya/smtp-runtime/<identity>`; dirs 0700, files 0600.
3. **До baseline snapshot** пользователь сам вводит SMTP_USERNAME/SMTP_PASSWORD непосредственно в защищённый
   `.dom-u-morya/config.php` (0600). Не передавать пароль аргументом shell, токеном URL,
   в GitHub или чат; не сбрасывать mailbox password. MAIL_FROM фиксирован;
   MAIL_TO=azm1982@yandex.ru; FORM_ENABLED=false, DELIVERY_VERIFIED=false,
   LEGAL_APPROVED='', DELIVERY_VERIFIED_TO='', LEGAL_MAIL_TO=''. Сохранить HMAC/state.
   После snapshot эти байты/права/mtime не менять; worker их не редактирует.
4. Однократный случайный wrapper в webroot разрешён **только этим GO**:
   случайное имя ≥96 бит, независимый token ≥256 бит только в HTTP-заголовке,
   в коде только hash(token), constant-time comparison, TTL 120 сек, POST-only,
   HTTPS/Origin, no-store/noindex, display_errors/log_errors off. Ошибочный токен,
   метод, истёкший TTL, повтор → непрозрачный 404/409 **без SMTP**.
   Предварительная безопасная runtime-проверка через тот же wrapper **без отправки**:
   ровно web PHP 8.4, openssl/ctype/filter, trust store, runtime hashes/permissions,
   FORM_ENABLED=false и точный тестовый MAIL_TO. Не использовать phpinfo().
5. Wrapper использует приватный кандидат и **тот же** `validate → accept → message →
   smtpTransport`. Конфиг читает по фиксированному абсолютному приватному пути после
   проверки прав: кандидат расположен на другой глубине, относительный config()
   production endpoint для него не подходит. Не менять persisted FORM_ENABLED и
   не обходить флаги в публичном endpoint. Перед SMTP атомарный one-shot marker
   через exclusive create, 0600, pending с commit/SHA/id/time. Общий accept сохраняет
   дополнительный idempotency marker до отправки. Никакого входящего JSON посетителя:
   fixture зашит в проверенный wrapper (вымышленное имя/телефон, synthetic@example.invalid,
   lot 22825/studio/furnished/calc, family 6978183/20/20/6, Telegram, 12–15,
   consent true/2026-10-30). Ответ: id/status/runtime, без конфига, полей и SMTP error.
6. Сделать ровно **один** авторизованный POST `action=attempt`; отдельный POST preflight
   не вызывает transport. Transport ACK означает только приём SMTP,
   не Inbox и не DKIM. При timeout/неизвестном результате не повторять и не удалять
   marker; сверить Яндекс и обсуждать новый GO. Порт 465 автоматически не пробовать.
7. В finally немедленно удалить wrapper и токен из памяти/временных файлов. По свежему
   URL с cache bypass подтвердить 404 и физическое отсутствие файла; form-status
   остаётся false, обычный lead POST остаётся 503. При разрыве связи оператор вручную
   завершает cleanup; TTL запрещает отправку, но сам по себе файл не удаляет.
   Сохранить только id/status/SHA/time/результаты cleanup, без тела письма или секретов.
8. Владелец проверяет в Яндексе Inbox/Spam, ровно один экземпляр, тему/id и все поля,
   `DKIM-Signature` **и** `Authentication-Results: spf=pass; dkim=pass`, желательно
   dmarc=pass и совпадение доменов. Передать в приёмку только обезличенный результат.
   Нет DKIM, ошибка или дубль → STOP, FORM_ENABLED=false, обращение к Jino.

## GO B: конечный маршрут и правовая редакция

Отдельный GO на **одно** синтетическое письмо MAIL_TO=info@anyara.ru по той же схеме;
всё ещё FORM_ENABLED=false. Подтверждение Яндекса не переносится на другой адрес.
Нужна приёмка владельца конечного ящика (Inbox/Spam, один экземпляр, id, полный состав,
SPF/DKIM). Обновить согласованные privacy/consent **перед публичным включением**:
фактический получатель/почтовые провайдеры/хранение, доступ, сроки/удаление/отзыв,
оператор ИП Саврасова. Сейчас страницы говорят о sales/Jino, они в этом Draft не менялись.
При новой редакции синхронно изменить CONSENT_VERSION в PHP, JS и документах, повторить
целевые тесты и пересоздать пакет. Нельзя вписывать старую дату ради обхода гейта.

## GO C: установка backend и публичное включение

Отдельный GO с **финальным** commit/package SHA, конечным MAIL_TO, согласованной
legal редакцией и приёмкой доставки. Приватный runtime уже проверен, а public endpoint
до включения остаётся закрыт флагами. Перед заменой файлов нужен полный приватный backup
публичного релиза и config с mode/uid/gid/hash и ограниченным доступом; GO A их не заменяет.
Процедура публикует только четыре public файла
из scoped manifest (и отдельно утверждённый legal diff, если он готов): сначала новые
файлы, затем atomic rename `lead-core.php` последним. Никаких root rsync --delete.
Сохранять .envrc, dotfile guard, владельцев/права и все посторонние файлы. Проверить
неизменность всех остальных public SHA, status=false, отрицательные запросы, HTTP PHP 8.4.

Только после этих проверок и явного разрешения на приём заявок атомарно установить
FORM_ENABLED=true, DELIVERY_VERIFIED=true, DELIVERY_VERIFIED_TO=info@anyara.ru,
LEGAL_MAIL_TO=info@anyara.ru, LEGAL_APPROVED=точная опубликованная версия.
Финальный synthetic real-browser submit тоже является реальным письмом и должен
входить в GO с заданным количеством; проверить received MIME, один ID/экземпляр,
replay того же key без нового письма, negative/consent/rate/error honesty и smoke.
Не использовать вымышленные флаги доставки или юридического согласования.

## Rollback / STOP

Сначала FORM_ENABLED=false атомарно в приватном конфиге; убедиться в false/503 и
доступности телефона/email. Удалить временный wrapper, сохранить uncertain state.
Вернуть прежний `api/lead-core.php` из backup, удалить **только три** новых public PHP
пути, если их не было в baseline; сверить все исходные SHA/mode/uid/gid и .envrc.
Приватный конфиг восстановить из 0600 backup с **FORM_ENABLED=false**. Прежний backend
с mail() остаётся выключенным: его нельзя использовать как fallback.
Отложить удаление неиспользуемого runtime до завершения работающих PHP-запросов;
конфиг/backup/state не удалять в публичную папку. Отправленное письмо не отзывается
rollback; отдельные экземпляры синтетических писем удаляет владелец ящика.
Прошлый rollback первоначального placeholder-релиза здесь неприменим.

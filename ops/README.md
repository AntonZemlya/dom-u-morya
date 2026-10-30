# FORM-001 / RELEASE-001 — управляемый выпуск на Jino

Только `zhk-dom-umorya.ru`. Целевой HTTP runtime — PHP 8.4. Общая CLI-настройка PHP 8.1 и другие домены не меняются. Staging не создаётся.

## Локальная подготовка

Рабочая ветка `codex/form-001-jino-prod` от GitHub main `f2f61dd31f1fe62281802f4addc5ac26cb5a64fe`. Локальный PHP 8.4.14 собран из официального архива в `/private/tmp/dom-u-morya-php84/php-8.4.14/sapi/cli/php`. Устанавливать его системным не нужно.

```sh
npm ci
npm run check
PHP84_BIN=/private/tmp/dom-u-morya-php84/php-8.4.14/sapi/cli/php npm run test:form
python3 ops/test_release.py
npm test
SITE_URL=https://zhk-dom-umorya.ru BUILD_TARGET=production npm run build
npm run test:dist
npm run test:eng-001
npm run test:seo
npm run test:previews
npm run test:performance
npm run test:catalog-transfer
npm run test:legal
git diff --check
```

Постоянный Python-preview — только `127.0.0.1:4183`, PHP он не исполняет. Локальная форма в нём выключена; временный PHP QA запускается на loopback и останавливается в `finally`. Только для этого временного сервера используется `?form-qa`. Fake mailer недоступен в production entrypoint; в QA реальный `mail()` дополнительно отключён через `disable_functions`.

После коммита, без незакоммиченных файлов:

```sh
python3 ops/release.py package
python3 ops/release.py preflight
python3 ops/release.py prepare --sha PACKAGE_SHA256
```

`package` заново строит production dist и создаёт детерминированный `.release-output/release.tar.gz`, `package.json` и внутренний manifest (каждый публичный путь + SHA-256, commit, origin, хеш дерева). `prepare` создаёт только приватную папку релиза и резервную копию, проверяет SHA архива после передачи; публичный docroot остаётся прежним. До публикации его inventory должен совпадать с backup, включая `.envrc`, владельцев, режимы и прежний index.

Серверный приватный корень: `/home/users/j/j84938826/.dom-u-morya`, режим 0700. Конфиг — `config.php` 0600, состояние — `state/` 0700, файлы 0600. Конфиг создаётся только при deploy: `FORM_ENABLED=false`, `DELIVERY_VERIFIED=false`, `LEGAL_APPROVED=''`. Секрет HMAC генерируется на Jino, в Git/пакет не попадает.

## Контрольный GO

Владелец рассматривает HEAD, архивный SHA-256, 242 пути manifest, backup path/hash, QA и [правовые изменения](../review/form-001/LEGAL-CHANGES.md), подтверждает объём прав на медиа. **Запрос начала разработки не считается GO.**

Требуемое сообщение: `GO PROD PACKAGE_SHA256`. После него в этой же задаче:

```sh
python3 ops/release.py deploy --sha PACKAGE_SHA256 --go PACKAGE_SHA256
python3 ops/release.py runtime --sha PACKAGE_SHA256 --go PACKAGE_SHA256
python3 ops/release.py redirect --sha PACKAGE_SHA256 --go PACKAGE_SHA256
python3 ops/smoke.py --allow-http-302
```

Deploy размещает assets/API/legal, последним index; конфиг выключен. `.htaccess` пока отложен. Runtime создаёт случайный защищённый PHP-файл на 120 секунд, проверяет по HTTPS версию 8.4, `mail()` и `X-Forwarded-Protocol`, включая попытку подмены заголовка. Токен существует только в памяти и HTTP-заголовке. `finally` удаляет диагностику. Публичного phpinfo() нет. Если SSH/сеть отказали во время cleanup, немедленно удалить указанный `api/runtime-*.php` по SSH, даже после истечения 120 секунд.

После подтверждения Jino proxy устанавливается ровно включённое в пакет правило 301 из [официальной справки Jino](https://jino.ru/spravka/hosting/), с фиксированным целевым доменом. Проверить HTTPS (без цикла). Затем в Jino → Домены → **zhk-dom-umorya.ru** → SSL выключить панельный «Всегда использовать только HTTPS», который сейчас возвращает 302: HTTPS остаётся обеспечен проверенным правилом 301 в Apache. Сразу проверить HTTP/HTTPS/www и внутренние пути. При проблеме вернуть панельный переключатель и откатить правило/релиз. Другие домены/SSL-сертификат не менять. После смены:

```sh
python3 ops/smoke.py --all-files
```

Smoke проверяет точные статические байты по manifest, canonical/OG/JSON-LD, sitemap/robots, HTTP/www 301, 404, endpoint GET 405, core 404 и no-store. В браузере дополнительно проверить mobile, выбранную квартиру, калькулятор/PDF. Статические и PHP-проверки не отправляют заявки.

## Один синтетический email и включение

Только после отдельного сообщения владельца `SEND ONE SYNTHETIC PACKAGE_SHA256`:

```sh
python3 ops/release.py probe --sha PACKAGE_SHA256 --go PACKAGE_SHA256 --permit 'SEND ONE SYNTHETIC PACKAGE_SHA256'
```

From/To: `sales@zhk-dom-umorya.ru`. Тема: «Дом у моря — синтетический тест». Текст: `Synthetic delivery test. No visitor data. Release PACKAGE_SHA256. Probe PROBE_ID.` Без чужих ПДн. Однократный приватный маркер запрещает повтор на том же релизе даже при потере ответа. Временный HTTP-файл защищён и удаляется, как runtime-диагностика. `accepted=true` означает только принятие MTA. Не повторять автоматически при неопределённости.

Владелец проверяет **Входящие/Спам**, ровно одно письмо, соответствующий probe ID / Message-ID, полные заголовки `SPF=pass` и `DKIM=pass`. При отсутствии подтверждения **FORM_ENABLED остаётся false**; нужен выбор владельца: rollback либо честная информационная версия. До этого не объявлять production задачу DONE.

После подтверждения доставки и точной legal редакции (включая порядок доступа/удаления):

```sh
python3 ops/release.py enable --sha PACKAGE_SHA256 --go PACKAGE_SHA256 --delivery-confirmed PROBE_ID --legal-approved 2026-10-30 --mail-auth 'SPF=pass;DKIM=pass;duplicates=0'
python3 ops/smoke.py --all-files --form-enabled
```

Затем одна согласованная владельцем тестовая заявка через браузер с синтетическими данными, проверка ровно одного уведомления, повтор с тем же ключом и негативный сценарий без отправки. ПДн/сырой POST/почтовые заголовки с пользовательскими контактами в отчёт не помещать.

## Откат и обслуживание

Если панельный HTTPS-переключатель уже выключали ради Apache 301, **сначала вернуть его в исходное включённое состояние в панели этого домена**, затем выполнить команды ниже. Это восстанавливает исходный HTTPS 302 после удаления нового `.htaccess`. При автоматическом откате во время первоначального копирования панель ещё не менялась.

```sh
python3 ops/release.py disable --sha PACKAGE_SHA256
python3 ops/release.py rollback --sha PACKAGE_SHA256
python3 ops/release.py cleanup
```

Rollback сначала выключает форму, восстанавливает прежние файлы/режимы из проверенного backup и удаляет только пути точного manifest, которых раньше не было. `.envrc` не переписывается и не удаляется; его хеш контролируется. Обнаружение её внешнего изменения останавливает операцию для ручного разбора. `rsync --delete` не используется. При изменённом index после preflight deploy остановится до публикации. Критический сбой записи вызывает автоматический rollback.

Cleanup удаляет истёкшие HMAC/метаданные под тем же файловым lock. Отдельные cron-задания и общие настройки аккаунта эта задача не меняет. Непубличный MTA на Jino задаёт фактическое время исполнения `mail()`; приложение ограничивает PHP execution, ожидание lock (250 мс) и HTTP-клиента (12 сек). Потеря/таймаут результата не вызывает повторную отправку: pending/failed блокируют автоматический replay на 24 часа.

[PHP manual](https://www.php.net/manual/en/function.mail.php) отдельно указывает, что принятие почты не подтверждает доставку. Системный SSH `php -v` 8.1 не является проверкой HTTP PHP 8.4.

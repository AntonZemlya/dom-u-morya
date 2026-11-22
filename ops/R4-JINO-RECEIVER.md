# Доставка каталога «Дома у моря» на Jino

На Jino остаётся приёмник нативного пакета `dom-private-v1` для `sadovoe-kolco/24/house-by-the-sea`. Импорт и рендеринг WebP выполняются на VPS. Частный staging хранит файлы по SHA-256 и повторно использует уже полученные байты. При установке публикатор заново проверяет SHA, состав, планы и воспроизводимость нативного снимка, затем применяет его под блокировками сайта. Пакет проходит обработку по одному файлу. Общий лимит нативного пакета и лимит private media равны 180 МиБ каждый.

## Проверка окружения перед установкой

Управление существующим сайтом ведёт Control Plane через отдельный административный доступ. Установку кода, выдачу ключа, отключение PRICE-SYNC-002 и первую доставку выполняют после согласованного GO для соответствующей операции.

Уточните в кабинете и на shell точный абсолютный путь поддерживаемого Python ≥3.9. Предпочтителен существующий Python 3.11 или 3.12. Системного Python 3.6.8 достаточно для старого Cron. Для нового приёмника нужен современный интерпретатор. Действующие пути Node.js и PHP приведены ниже. На копии измерьте RSS именно Python, Node и PHP, подтвердите лимит shell-процесса и квоту аккаунта. Приёмник оставляет резерв файловой системы 256 МиБ, его кэш занимает до 180 МиБ и на время установки нужен отдельный каталог размером до полного пакета. Квоту аккаунта сверяют в Jino отдельно от `df`.

```sh
"$RPM_PYTHON" --version
"$RPM_PYTHON" -I -B -c 'import fcntl, ssl, sys; assert sys.version_info >= (3, 9); print(ssl.OPENSSL_VERSION)'
/opt/alt/alt-nodejs22/root/usr/bin/node --version
/usr/bin/php8.4 --version
```

Проверьте поддержку `restrict` и `command=` для отдельного ключа в `authorized_keys`, включая отказ для произвольной команды, оболочки, PTY и subsystems. Если Jino не применяет forced command, остановите настройку и используйте согласованный защищённый приёмник. Проверка host key и отдельный ключ VPS обязательны. [Документация Jino по Python](https://jino.ru/spravka/hosting/python.html).

## Частный комплект

Соберите комплект из двух утверждённых Git HEAD. Следующие команды создают локальную копию проверенных байтов и перечень SHA-256. Копия включает только перечисленные файлы. Каталог `ops` не входит в публичный релиз сайта.

```sh
umask 077
RPM_HOUSE_BUNDLE=$(mktemp -d)
git archive "$HOUSE_HEAD" -- \
  ops/rpm_receiver.py ops/catalog_publisher.py ops/catalog_package_media.py \
  scripts/catalog-cron.sh scripts/catalog_sync.py scripts/catalog_source.py \
  scripts/check_official_prices.py scripts/catalog-snapshot.mjs \
  scripts/catalog-presentation.mjs scripts/realty-schema.mjs \
  content-model.js data/apartments.json | tar -xf - -C "$RPM_HOUSE_BUNDLE"
git -C "$RPM_REPO" show "$RPM_HEAD:price_manager/delivery_receiver.py" \
  > "$RPM_HOUSE_BUNDLE/ops/delivery_receiver.py"
(cd "$RPM_HOUSE_BUNDLE" && find . -type f -exec shasum -a 256 {} +) > "$RPM_HOUSE_BUNDLE.sha256"
```

Передайте проверенные файлы операторским каналом в новый приватный каталог `/home/users/j/j84938826/.dom-u-morya/rpm-receiver-v1/releases/<HOUSE_HEAD>`. Каталоги имеют режим 0700, файлы 0600. Сверьте байты через `sha256sum -c` с независимым локальным перечнем. Создайте соседний каталог `/home/users/j/j84938826/.dom-u-morya/rpm-receiver-v1/staging` в режиме 0700. `RPM_HOUSE_RECEIVER` указывает на `ops/rpm_receiver.py` в этом выпуске.

Строка для отдельного открытого ключа после проверки прав. Подставьте подтверждённый путь к Python, точный `HOUSE_HEAD` и ключ, предназначенный только для данного сайта. Закрытый ключ хранится на VPS. Ограничение forced command связывает SSH-ключ с конкретным получателем, а права кода определяются аккаунтом Jino.

```text
restrict,command="<RPM_PYTHON> -I -B /home/users/j/j84938826/.dom-u-morya/rpm-receiver-v1/releases/<HOUSE_HEAD>/ops/rpm_receiver.py receive" ssh-ed25519 <PUBLIC_KEY> rpm-house-delivery
```

Ключ запускает `receive` только при точной исходной команде `rpm-receive-v1`. Данные стандартных потоков используют протокол Realty Price Manager. Операции `prepare`, `owner`, `restore`, `invalidate` и `status` доступны через отдельный операторский доступ. Сетевой read контрольного HTTPS использует канонический адрес сайта, проверенный TLS и подтверждение конкретных SHA и даты.

## Переключение PRICE-SYNC-002

1. Выпустите совместимые сайт и PHP-читатели штатным менеджером. Проверьте receipt `verified` и рабочий HEAD/GET главной. Получите `BASE_NATIVE_SHA` из статуса публикатора и подтвердите его по `X-Dom-Catalog-Snapshot`. Код статуса 3 означает, что срок доверия истёк или источник не подтверждён. Заголовок и тело остаются проверяемыми.
2. Отключите в панели Jino только задание `Дом у моря — ежедневная сверка каталога`. Дождитесь выхода запущенного writer. Подтвердите отсутствие `started_at` и `pending` в статусе. При незавершённой старой операции сначала восстановите её по отдельному регламенту. Снимите один проверенный архив существующего состояния, пока writer остановлен.
3. Выполните `prepare`. Под `sync.lock` и `manager-v1/lock` команда сверяет активный SHA, HTTP, исходный каталог, существующий `catalog-cron.sh` и точный SHA исходного `catalog_sync.py` из принятого PRICE-SYNC-002. Оригинал сохраняется в private `publisher-transactions/`, затем атомарно меняется только файл worker. Повтор для уже установленного guarded worker проверяет те же данные. При неизвестных байтах worker остановите переключение и установите точную проверенную ревизию через Control Plane.
4. Выполните `owner` для передачи права записи. Guarded worker откажется от запуска, восстановления и отправки почты до изменения состояния. Зафиксируйте `owner=publisher`, прежний активный SHA и отсутствие `pending`.
5. Перед первой доставкой управляющий передаёт отправителю `BASE_NATIVE_SHA` как независимую ожидаемую базу вместе с проверенными SHA манифеста и нативной версии. Ожидаемая база всегда обязательна для действующего каталога. При потерянном ответе повторяйте тот же пакет с прежней ожидаемой базой. При конфликте источника или указателя сверяйте текущее состояние перед следующим пакетом.

```sh
"$RPM_PYTHON" -I -B "$RPM_HOUSE_RECEIVER" status
"$RPM_PYTHON" -I -B "$RPM_HOUSE_RECEIVER" prepare --expect "$BASE_NATIVE_SHA"
"$RPM_PYTHON" -I -B "$RPM_HOUSE_RECEIVER" owner --expect "$BASE_NATIVE_SHA" --owner publisher
"$RPM_PYTHON" -I -B "$RPM_HOUSE_RECEIVER" status
```

Продолжайте только после независимой проверки первого выпуска. Статус должен вернуть точный SHA пакета, активный SHA, `pending=null` и `confirmed`. На обоих HTTPS-методах проверьте `X-Dom-Catalog-Snapshot`, `X-Dom-Catalog-Status`, `X-Dom-Catalog-Template`, `X-Dom-Catalog-Checked-At` и `Cache-Control: no-store`. На GET сверьте лоты и цены между HTML, browser JSON, JSON-LD и калькулятором, скачайте PDF нового и проверьте блокировку старого из сохранённой вкладки. Сравните SHA выдачи старых и новых URL планировок. Проверку 409 прогоняйте через изолированный `DomLead\validate` без `accept` и транспорта, используя повтор локального [R2B QA](R2B-PUBLISHER-RUNBOOK.md). На публичном сайте для приёмки используйте GET и HEAD.

## Диагностика и откат

`publication_busy` и `publication_unavailable` позволяют повторить доставку. При временном 429/503 публикатор оставляет действующее состояние или возвращает его после неудачной смены. `publication_refused` требует проверки частного статуса и согласованной базы. При `pending` повторите идентичный пакет или выполните проверенный откат. В обоих случаях используются уже действующие блокировки релиза. Обычный релиз сайта проходит через штатный release manager.

Сначала остановите плановую отправку этого ЖК на VPS и зафиксируйте текущие `active` и `package`. Обе версии обязательны для отката, в том числе при повторном подтверждении тех же цен. После отката каталог помечается неподтверждённым. Для новой установки потребуется подтверждение позднее последней принятой попытки, даже если прежний пакет остался в очереди VPS. Если для аварийного возврата требуется старый Cron, повторите откат по сохранённой цепочке до исходного legacy-снимка. Сверьте прежние URL, затем передайте writer обратно. Решение о включении старого задания в панели принимается отдельно.

```sh
"$RPM_PYTHON" -I -B "$RPM_HOUSE_RECEIVER" status
"$RPM_PYTHON" -I -B "$RPM_HOUSE_RECEIVER" restore \
  --expect "$ACTIVE_NATIVE_SHA" --expect-package "$ACTIVE_PACKAGE_SHA"
"$RPM_PYTHON" -I -B "$RPM_HOUSE_RECEIVER" status
"$RPM_PYTHON" -I -B "$RPM_HOUSE_RECEIVER" owner --expect "$LEGACY_NATIVE_SHA" --owner legacy
```

Для отдельного подтверждённого сигнала недоступности источника оператор использует `invalidate --expect "$ACTIVE_NATIVE_SHA" --expect-package "$ACTIVE_PACKAGE_SHA"`. Операция сохраняет последнюю дату и версии и не затрагивает очередь legacy-уведомлений. Встроенная граница доверия 36 часов действует и при отсутствии такого сигнала. При приближении к лимиту private media измерьте реально достижимые и ранее выданные ресурсы. Автоматическая очистка области сайта в этом приёмнике отсутствует, старые URL продолжают работать.

## Воспроизведение на локальной копии

```sh
RPM_REPO=/path/to/reviewed/realty-price-manager python3 -B ops/test_rpm_receiver.py
```

Тест использует PHP CLI и CGI с временной копией публичных файлов, Node и общий приёмник из менеджера. Он проверяет native CAS и общий lock, сбои 429/503, потерянный ответ и повтор без передачи медиа, возврат к legacy, старый URL и 409. Для браузерного PDF и полного теста с сайтом используйте [процедуру R2B](R2B-PUBLISHER-RUNBOOK.md). Доступность инструментов, RSS PHP/Node и поддержка ограничения ключа на самом Jino требуют пробы Control Plane.

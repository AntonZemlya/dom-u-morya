# Rollback и аварийное восстановление

Обычный rollback возвращает public baseline **последнего** релиза. Он сохраняет
текущие `.envrc`, постоянный guard, config/runtime, state, реальные заявки и другие
домены. Это отличается от disaster recovery — восстановления после потери аккаунта,
диска, SSH или критической конфигурации.

## Обычный rollback

```sh
npm run release -- status --release-id RELEASE_ID
npm run backup -- verify --release-id RELEASE_ID
npm run release -- rollback --release-id RELEASE_ID --dry-run --output .release-output/rollback.json
```

Dry-run проверяет backup, receipt, текущее дерево и возвращает отдельный точный GO:
`GO ROLLBACK zhk-dom-umorya.ru RELEASE_ID PACKAGE_SHA256 PLAN PLAN_SHA256`.
После отдельного разрешения владельца:

```sh
npm run release -- rollback --plan .release-output/rollback.json --go 'EXACT_ROLLBACK_GO'
```

Изменение policy требует пересоздать план. При rollback проверяются bytes, permissions,
owners и отсутствие стороннего drift. Новый index возвращается последним. Удаляются
только новые scoped файлы и созданные пустые каталоги; чужие каталоги не удаляются.
После записи сверяются исходные metadata, затем HTTPS static SHA и form/security GET.
Реальные state и config не перезаписываются из исторического snapshot.

## Сценарии отказа

| Событие | Действие |
|---|---|
| SSH потерян до ответа | STOP; после возврата связи читать status. Не повторять apply и не создавать новый ID для обхода |
| SHA/package/manifest не совпали | STOP до записи; собрать заново из проверенного commit |
| Drift production/config/.envrc | STOP; сохранить metadata, выяснить источник, новый review/plan |
| Нехватка квоты/места | STOP до публикации. Не удалять копии ради продолжения без отдельного плана/GO |
| Частичная запись | Worker пробует scoped restore; если прерван — receipt publishing, отдельный rollback plan/GO |
| Ошибка rollback | Сохранить backup/receipt и `rolling_back`/`recovery_required`; не удалять и не начинать новый релиз |
| TLS или DNS недоступны | Не отключать проверку TLS и не подменять DNS. Проверить локальную сеть/официальный статус провайдера; после восстановления finalize либо отдельный rollback |
| Доступ к Jino полностью потерян | Использовать панель/поддержку и независимую шифрованную копию; GitHub не содержит config/секреты |

## Disaster recovery

Остановить релизные действия; владелец восстанавливает доступ через Jino. Проверить
доступные панельные копии, их дату/состав, выбрать нужный домен и приватные файлы;
восстанавливать сначала в отдельную приватную папку. Это серверная запись и требует
отдельного GO. Не распаковывать whole-account backup поверх всех доменов.

Сопоставить исходный commit/package, manifest/SHA, `.envrc`, guard, config и SMTP
runtime. Секреты восстанавливает владелец с ограничением 0600/0700; после компрометации
их ротация — отдельное согласованное действие. Не восстанавливать state заявок из
старого snapshot автоматически: решение по данным и срокам — DATA-RETENTION-001,
[Issue #18](https://github.com/AntonZemlya/dom-u-morya/issues/18).

Вне Jino хранить только шифрованный backup и несекретные receipt/manifest. Без такой
копии и недоступного провайдера нельзя обещать восстановление приватной конфигурации.
После восстановления проверить TLS, public SHA, dotfile 403/404, API GET 405 и
ready/enabled. Не отправлять письмо или валидную заявку без отдельного разрешения.

## Внешняя копия — READY_NOT_CONFIGURED

Механизм CMS envelope использует имеющийся на Jino OpenSSL, AES-256-CBC и публичный
X.509 сертификат получателя. Backup проверяется и **шифруется на Jino в памяти**;
через SSH на Mac приходит только ciphertext. Приватный ключ никогда не передаётся
на Jino или в Git. Нужны решение владельца о каталоге хранения, его сертификат,
отдельное безопасное хранение ключа и проверка расшифрования. Облако не подключено.

```sh
npm run backup -- export --release-id RELEASE_ID --certificate /private/path/owner-public.crt --output /private/path/backup.cms
openssl cms -decrypt -binary -inform DER -in /private/path/backup.cms -recip /private/path/owner-public.crt -inkey /private/path/owner.key -out /private/path/backup.tar.gz
```

Расшифрование выполняется только в приватном каталоге с umask 077; сверить plaintext
SHA с export receipt и внутренним manifest перед восстановлением. CMS envelope
защищает конфиденциальность; подлинность получателя/сертификата подтверждает владелец,
а SHA receipt хранится отдельно доверенным способом. После локальной проверки удалить
расшифрованную рабочую копию по самостоятельному решению владельца, без автоматического
удаления произвольных файлов. Синтетический encrypt/decrypt roundtrip проверен тестом;
фактический production export/restore не выполнялся.

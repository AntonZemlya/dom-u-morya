# FORM-004 — пакет независимой приёмки

Основание: [Control Plane FORM-004](https://github.com/AntonZemlya/dom-u-morya/pull/17#issuecomment-6543301609)
и окончательное письменное ТЗ владельца. Принятая исходная база
`52a71bd0c22f4899469d706df9038d8da665bdf9`; PR #17 остаётся Draft, base=c1a32fa.

## Результат

- From sales@zhk-dom-umorya.ru → To info@anyara.ru + BCC azm1982@yandex.ru.
  Один DATA, два RCPT; BCC скрыт в MIME. Отказ любого RCPT прерывает всю
  транзакцию до DATA. Нет частичной доставки по намеренному fallback.
- Сохранён FORM-003: тема, Москва/секунды, контакты/квартира/ипотека, рубли,
  пустые строки. Добавлен только отдельный служебный блок согласия в конец.
  ID/Message-ID/idempotency и server audit сохранены; ID не выводится менеджеру.
- Версия согласия 2026-10-31 синхронна в PHP/JS/privacy/consent. Галочка изначально
  пуста. Preview ниже получены из реально принятого локальным TLS sink MIME:
  [полный](full-email.txt), [минимальный](minimal-email.txt), [метаданные QA](format-results.json).
- Новые gates различают подтверждённый SMTP/контрольный ящик и подтверждённый
  владельцем, но не проверенный доставкой основной адрес. MAIN_DELIVERY_VERIFIED
  и старый DELIVERY_VERIFIED остаются false. Отдельный тест на основной адрес отменён.
- [Исполняемый единый релиз и откат](../../ops/FORM-004.md): 7 public + 5 private
  runtime + 3 control + manifest, воспроизводимый архив. Все остальные public hashes
  совпадают с принятым production snapshot. Конфиг, секреты, tests/review в архив не входят.

## Локальный QA — PASS

Среда: PHP CLI 8.4.27, PHP CGI 8.4.14 (OpenSSL/ctype), закреплённый PHPMailer 7.1.1,
Apache 2.4 + TLS, Playwright. Тестовые письма только в одноразовый loopback sink;
реальные адреса в envelope не вызывают отправку: sink не является relay.

| Проверка | Результат |
| --- | --- |
| PHP contract | 90 assertions: consent/version, поля, инъекции, origin, size, rate/idempotency, uncertain, state/lock, MSK rollover/TZ/формат |
| Полученный полный/минимальный MIME | Точная тема/текст, UTF-8 base64, From/To/Reply-To/Message-ID, 2 RCPT/1 DATA, BCC отсутствует в headers |
| Ошибки SMTP | Нет STARTTLS, неверное имя TLS/CA, AUTH, первый RCPT, второй BCC RCPT, DATA, accepted→disconnect/timeout; opaque error, повтор заблокирован |
| No-send readiness | FORM=false, ready=true без SMTP; corrupt/пустой/неверный state даёт ready=false |
| Повторы | Один ключ/другой ключ того же тела, конкурентные запросы и потерянный HTTP-ответ не создают дублей |
| Конфигурация/логи | Неверные маршруты/approvals/permissions fail closed; секретов и ПДн нет в technical logs/state |
| Browser FORM | 1440/768/390/320, выбранная квартира, family/manual calc, consent, retry, ошибки, no-JS, нет overflow/JS errors |
| Release lifecycle | 7 сценариев, настоящие Apache TLS/PHP CGI: stage disabled→enable→rollback, wrong GO, повтор, config/public drift, tamper/symlink, partial publish failure, полный контроллер и автоматический откат при ошибке smoke |
| Сохранение при релизе/откате | HMAC, STATE_DIR, пароль/SMTP, неизвестные рабочие настройки, state и markers; 0 SMTP connections, 0 временных wrapper |
| Security regression | 11 unit + Apache/PHP/TLS dotfile deny/ACME/301/порядок публикации/rollback |
| Исторический GO A harness | 9/9 локальных сценариев на архивном кандидате FORM-003, внешний DNS/TCP/SSH запрещён; не разрешение на новую реальную отправку |
| Scope/package | Старый low-level package contract PASS; новый packager exact delta и 16-member/hash allowlist PASS; финальный archive/SHA в go-prod.json |
| Общие регрессии | check, test, test:dist, test:eng-001, test:previews, test:seo, test:legal — PASS, 28 лотов/57 SVG/4 widths/калькулятор/PDF сохранены |
| Зависимости | composer validate + audit PASS, advisories отсутствуют |

Команды запуска перечислены в package.json и ops/FORM-004.md. Старый test:smtp-e2e
проверяет исторический пакет, новая финальная схема проверяется test:form и
**test:form-release**. Все локальные процессы и временные config/cert/state удалены.
Синтетические preview сохранены намеренно для проверки оформления.

## Состояние и пределы готовности

Выполнены только read-only snapshot Jino и GET form-status: все 243 публичных файла
и метаданные private config совпали с принятой baseline, enabled=false, действующая
production-версия согласия 2026-10-30. [Результат](production-readonly.json).
Production, private SMTP-config, получатели, флаги,
one-shot markers и другие домены не менялись; новых реальных писем не было.
Последний принятый production snapshot — после настройки SMTP; перед будущей записью
его полное совпадение с живым состоянием обязательно, любое отличие означает STOP.

Jino → Яндекс подтверждён ранее владельцем (Inbox/SPF/DKIM PASS). Доставка на
info@anyara.ru остаётся неподтверждённой. **Провайдер и место хранения основного
ящика неизвестны**, что прямо сообщил владелец и что отражено в документах.
Нельзя выдавать это за проверенную юридическую готовность: оператору нужно уточнить
условия хранения, доступа и удаления, оценить документы и утвердить редакцию перед GO.
[Issue #18](https://github.com/AntonZemlya/dom-u-morya/issues/18) содержит отдельную
отложенную задачу хранения. Ручная процедура описана; SQLite/cron/удаления писем нет.

Финальные commit/SHA и **точная строка GO PROD FORM** выдаются после commit в
`.release-output/form-004/go-prod.json` и в описании PR. Архив содержит manifest с
полным исходным snapshot и SHA всех членов; config.php/пароля в архиве нет.
До независимой приёмки и отдельного точного GO не выполнять apply, не включать
форму и не отправлять синтетические письма на основной адрес.

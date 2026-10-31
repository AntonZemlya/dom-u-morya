# FORM-003 — текст уведомления менеджеру

Основание: [последнее ТЗ в PR #17](https://github.com/AntonZemlya/dom-u-morya/pull/17#issuecomment-6542911460).
База узкого diff: `5a7c366299c08caea96d8bb5b5d3ffce30e394d4`.
**LOCAL PASS. Production/config не изменялись, новые реальные письма не отправлялись.**
Прежний GO A завершён: владелец подтвердил Inbox/SPF/DKIM у письма
`20261031-76e2b1edfec27dc7`; этот допуск и его маркеры не используются повторно.

## Изменение

В production-коде изменена только функция `message()` в `api/lead-core.php`.
Тема строго **ЖК «Дом у моря» — новая заявка**. Plain text разделён пустыми строками
на контакты, квартиру и ипотеку; опциональные строки/секции опускаются. Время из
исходного `$now` преобразуется `DateTimeImmutable` в `Europe/Moscow`, с секундами.
Числа и программы отображаются по-русски. Заявка только с предпочтением категории
получает раздел «ПРЕДПОЧТЕНИЯ»; запрос полной оплаты сохраняет свой смысл отдельной
человеческой строкой. Исходные телефон/e-mail сохраняются. Наличие/цена требуют
подтверждения, расчёт остаётся предварительным и не является предложением банка.

ID, оператор, технические сведения о согласии, ISO/UTC и длинные ссылки отсутствуют
в теме/теле. Внутренний ID, RFC Message-ID, JSON-ответ, `created`/`consentVersion`
в приватном состоянии, consent guard, fingerprint/replay/TTL, logs, From/To/Reply-To
и PHPMailer/SMTP/TLS не менялись. HTML не добавлен.

Полученные через локальный SMTP текстовые превью: [полное](full-email.txt) и
[минимальное](minimal-email.txt). Это synthetic fixture, не сведения посетителя.
Сырые принятые `.eml` сохранены только локально в `.test-output/form-003/`;
в preview технические headers намеренно не включены.

## Проверки

| Проверка | Результат |
| --- | --- |
| PHP 8.4.27 `-l` + contracts | **87 PASS**: exact full/minimal body/subject, MSK seconds, переход даты, независимость от default TZ, десятичная площадь/ставка, private consent metadata и все прежние security отказы |
| `npm run test:form` | PASS: настоящий dist endpoint → PHPMailer → loopback TLS SMTP sink; MIME декодирован стандартным email parser |
| Full/minimal MIME | Exact Subject и все строки/пустые строки; нет ID/оператора/consent/UTC/URL/raw family; Message-ID соответствует неизменному JSON id; optional Reply-To сохраняется/опускается |
| Security/transport regression | PASS: Origin/POST/JSON/size/consent/honeypot/Unicode/CRLF/price/rates, TLS/CA/hostname/AUTH/RCPT/DATA errors, disconnect/timeout, replay/concurrent/lost response, no-PII state/logs |
| Browser 1440/768/390/320 + no-JS | PASS: квартира/полный family/manual calc, ошибки, согласие, status/duplicate blocking, отсутствие overflow/JS ошибок |
| Дополнительный harness | **9/9 PASS** на QA-only локальном пакете: Apache/TLS, FastCGI no-send, sink, timeout/cleanup/markers; production controller/worker/wrapper не менялись |
| `npm run check` / build / test:smtp-package | PASS: generated data, source audit, release allowlist/hash/reproducibility contracts |
| `npm run test:security` | PASS: 11 unit + реальный локальный Apache/PHP/TLS, dotfile guard и rollback |
| Legal proposal | `git apply --check review/form-003/legal-proposal.patch` PASS; реальные HTML не менялись |
| Scope | Весь код до/после `message()` побайтно прежний; SMTP runtime, HTML/JS/CSS/favicon/catalog/SEO/legal/.htaccess не менялись |

[MIME-результаты](format-results.json), [harness счётчики/source SHA](harness-results.json).
Файлы тестового CA, ключи, private config, spool и state удалены; процессы остановлены.

Изоляция QA: ранний прогон отрицательного GO-теста обнаружил совпадение фиктивного
commit с «неверным» значением и выполнил HTTP-проверки production. SSH/install/attempt
не выполнялись, письма и изменения конфигурации/файлов отсутствовали. Исправлены
отличающееся неверное значение и NoNetwork stub; дополнительно весь Python harness
блокирует внешний DNS/TCP и запуск SSH через audit hook. Финальный 9/9 прогон прошёл
с этим запретом. Контроллер production не изменён.

## Предложение по юридическим текстам — НЕ ПРИМЕНЕНО

[legal-proposal.patch](legal-proposal.patch) — только текст для согласования владельцем:
номер/время/редакция согласия учитываются в приватном состоянии, связь с письмом
сохраняется через Message-ID; manager subject/body не содержат номер и редакцию.
Уточнены фактические сроки technical state (24 ч accepted / 7 суток uncertain / 10 минут
rate counters) и SMTP вместо локального mail-транспорта. Остальные правовые положения
не редактировались. Это техническое предложение, не утверждённая правовая редакция.

Получатель и описание хранения в исходных страницах по-прежнему sales/Jino. Данный
узкий patch сам по себе не готов к публикации: адрес/хранение/провайдеры и дата редакции
должны быть отдельно согласованы при GO B. `CONSENT_VERSION` и JS сейчас не менялись.

## Новый пакет и дальнейшие GO B/C

После коммита `python3 -B ops/smtp_package.py` создаёт scoped update из 10 regular
members. Новые commit/SHA/размер — в `.release-output/form-002/package.json` и PR.
В payload изменяется только `public/api/lead-core.php`; остальные восемь файлов прежние.
Legal proposal, preview и тесты в update не входят. Принятые артефакты завершённого GO A
сохранены локально в `.release-output/form-002/completed-go-a-5a7c366/`.
Старый `go-a.json` — историческая квитанция использованного допуска, не разрешение
публиковать/отправлять новый формат. Новых GO A строк для FORM-003 не создаём.

1. **Приёмка FORM-003:** независимо проверить diff от 5a7c366, оба полученных MIME,
   private consent audit, новый commit/архив SHA и legal proposal. Форму оставить false.
2. **GO B, подготовка:** оператор утверждает конечный `info@anyara.ru`, фактические
   доставку/хранение/доступ/удаление и правовую редакцию. При новой версии согласия
   синхронно менять CONST в PHP, JS и документы и повторять проверки. Текущий GO A
   harness жёстко разрешает только Яндекс: для конечного адреса нужна отдельная
   reviewable адаптация с новым package SHA/одним разрешением, не обход To allowlist.
3. **GO B, проверка:** после отдельного owner GO приватно настроить конечный адрес,
   сохранив HMAC/state и false/empty approval flags, получить новый read-only snapshot.
   Разрешённым one-shot механизмом отправить ровно согласованное число synthetic писем.
   Проверить Inbox/Spam, полученные subject/body/headers, один экземпляр, SPF/DKIM.
   Ошибка/unknown outcome → STOP, без resend, cleanup/marker сохранить. Сейчас эти
   действия не выполняются; успешный прежний Яндекс-тест не заменяет эту приёмку.
4. **GO C:** отдельное разрешение на точные final commit/package/legal версии и
   публикацию backend. Backup перед заменой, allowlist/atomic switch, .envrc/dotfile guard
   сохранить, другие сайты не затрагивать. Включение только при подтверждённых
   `DELIVERY_VERIFIED_TO=info@anyara.ru`, `LEGAL_MAIL_TO=info@anyara.ru`, точной опубликованной
   `LEGAL_APPROVED` и явном owner GO. Финальный real-browser synthetic submit тоже
   требует разрешённого количества писем. При отказе — FORM_ENABLED=false и откат
   к проверенному выключенному релизу; автоматического mail() fallback нет.

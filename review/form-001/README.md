# FORM-001 / RELEASE-001 — локальная приёмка

Первичная приёмка: **30 октября 2026, МСК**. Исправление блокера dotfiles: **31 октября 2026, МСК**. Статус: код подготовлен; production GO и реальная почта не выполнялись.

База сверена с GitHub: `f2f61dd31f1fe62281802f4addc5ac26cb5a64fe`. Разработка — отдельный worktree, ветка `codex/form-001-jino-prod`. Main не менялся. Точный итоговый HEAD, SHA архива, manifest путей и путь фактического backup сохраняются после коммита в `.release-output/` и предъявляются в `GO-PROD.md`; это исключает самоссылку SHA внутри собственного коммита/пакета.

## Что реализовано

- `api/lead.php`, `lead-core.php`, `form-status.php`: PHP 8.4, JSON POST до 8192 байт. Allowlist: name/phone/consent/consentVersion, lotId/category/planView/requestKind, email/channel/callTime/calculation и honeypot website. Сведения о лоте берутся из неизменённого каталога; цена расчёта выбранного лота сверяется, ставка/расчёт помечаются как ввод пользователя.
- Same-origin Origin + JSON + обязательный X-Lead-Request; CORS не открывается. Запрещены произвольные поля, HTML и управляющие символы; контактные строки не используются в почтовых заголовках. From/To/envelope фиксированы на sales@zhk-dom-umorya.ru; тема и тело UTF-8/base64. Без SMTP-паролей.
- Вне webroot: один ограниченный файл состояния с HMAC-кодами и служебными метаданными. Права 0700/0600. 3 новые заявки на сетевой адрес за 10 минут и 100 глобально; forwarding-заголовки клиента не используются для обхода. Idempotency 24 часа, дополнительная защита одинакового содержимого на 10 минут. Pending/failed не отправляются повторно автоматически. Истёкшие записи очищаются под lock, включая повтор принятого запроса.
- Форма выключена без приватного конфига; для включения нужны FORM_ENABLED, подтверждённая доставка и точная legal редакция. Превью остаётся выключенным. Успех показывается только после 202/ok/валидного ID; ошибки и некорректные ответы не превращаются в успех и не показывают сырые диагностические сообщения.
- Сохранились дизайн/CSS, SEO-H1/Hero, 28 квартир, цены/формула ипотеки, 57 исходных SVG, фото и PDF. Добавлена передача вида планировки и контекста «100% оплата»/расчёта.
- При повторном performance-прогоне обнаружен нестабильный desktop CLS: источник — последовательная подмена fallback-шрифтов в Hero (0.076 + 0.036 + 0.008). В head добавлена ранняя загрузка тех же пяти WOFF2 только на широком экране (от 1141px), где проявился сдвиг. На мобильных ранний приоритет этих файлов не включается, чтобы не конкурировать с LCP. Эти шрифты уже используются первым экраном; CSS, файлы шрифтов, текст и итоговая геометрия не менялись. Performance-тест теперь закрывает браузер также при ошибке.
- Privacy/consent обновлены в определённых границах. [Точные смысловые изменения и требования к утверждению](LEGAL-CHANGES.md). Оператор не заменён застройщиком, отдельное согласие пустое, рассылок нет.
- `ops/`: детерминированный пакет, SHA-gated deploy, приватный backup с inventory/правами, отложенная проверенная установка 301, защищённая временная диагностика, однократный разрешаемый mail-probe, включение/выключение, smoke и rollback. `.envrc` исключена из публикации. Конфиг/логи/состояние/тесты/отчёты в dist не входят.

## Проверки

| Проверка | Результат |
| --- | --- |
| npm ci | PASS, lockfile сохранён, 0 уязвимостей по результату npm audit при установке |
| PHP 8.4 lint + contract | PASS, **60 assertions**, fake mail; размер, JSON, типы, согласие, телефон, поля, Unicode/CRLF, Origin, honeypot, rate/replay/TTL/lock, отказ транспорта и выключенный/отсутствующий конфиг |
| PHP 8.4 HTTP + браузер | PASS, 1440/768/390/320; лот 22825, расчёт, UTF-8 письмо в fake-mail, one request/one message, потерянный ответ → тот же key, 4xx/5xx/не-JSON, отсутствие конфига, no-JS, фокус/нет overflow |
| ops/test_release.py | PASS, 10 сценариев (добавлены guard до index, HTTP fail-closed, сохранение при legacy rollback, запрет старого SHA, security-only fix): подготовка без изменения docroot, manifest/права/.envrc, deploy/откат, gate включения, отложенный redirect, подмена/неожиданный файл/symlink, повреждённый архив, автоматический rollback при сбое записи |
| npm run check | PASS, структура и неизменность каталога/57 SVG/Hero, generated content и шаблоны секретов |
| npm test | PASS, воспроизводимость allowlist, UI/catalog всех 4 ширин, no-JS, PDF |
| npm run build | PASS, SITE_URL=https://zhk-dom-umorya.ru, production, **242 файла** |
| npm run test:dist | PASS, UI/catalog/no-JS/PDF |
| npm run test:eng-001 | PASS, оба ипотечных сценария/PDF, ссылки, кнопки, фокус, отклонение повторного PDF |
| npm run test:seo | PASS, canonical/OG/JSON-LD/robots/sitemap, HTTPS fail-closed, H1, JS/no-JS, 57 оригиналов и превью |
| npm run test:previews | PASS, 57 пар × desktop/mobile, max pixel MAE 4.709 |
| npm run test:catalog-transfer | PASS, 28 лотов, около 518 KB до lightbox; исходные SVG загружаются по запросу |
| npm run test:performance | PASS, три замера для каждой из 4 ширин + медленный mobile; подробности в performance.json |
| REC-003 legal integration | PASS, нет подмены исходников, сохранены остальные legal разделы/баннер/PDF, отдельное согласие и честный disabled UI |
| Исторические V2/V2.1/V2.2 | PASS после адаптации устаревших guard к уже принятому SEO и разрешённым FORM-001 границам |
| Python syntax, поиск секретов, dist exclusions, git diff --check | PASS; нет ключей/паролей/ПДн/localhost URL в публичном пакете |

Скриншоты: [1440](form-1440.png), [768](form-768.png), [390](form-390.png), [320](form-320.png). Поля пустые; режим включён только в изолированном fake-mail QA. Временный PHP-сервер остановлен, письма и состояние QA удалены. Постоянный предпросмотр `http://127.0.0.1:4183/` направлен на этот worktree/dist.

PHP 8.4.14 собран из официального https://www.php.net/distributions/php-8.4.14.tar.gz, SHA-256 `40341f3e03a36d48facdb6cc2ec600ff887a1af9a5e5fee0b40f40b61488afae`. Бинарник `/private/tmp/dom-u-morya-php84/php-8.4.14/sapi/cli/php`. Системный Mac PHP 8.5 не выдавался за 8.4; системный Jino CLI 8.1 не менялся. Отдельный Jino CLI `/opt/alt/php84/usr/bin/php` доступен как 8.4.27; это дополнение, не HTTP-доказательство.

## Read-only production preflight

В панели «Сайты» у zhk-dom-umorya.ru выбран PHP 8.4, `.envrc` содержит load_prefix для php84. Для отдельной проверки исправления dotfiles владелец разрешил проверку PHP: временный защищённый endpoint подтвердил фактический HTTP PHP 8.4; probe удалён. Это не публикация application endpoint и не проверка доставки почты. На сервере Python 3.6.8; release receiver использует совместимые API.

Первоначальный публичный каталог `/home/users/j/j84938826/domains/zhk-dom-umorya.ru` содержал только index.html (797 bytes, 0644) и .envrc (31 bytes, 0644), каталог 0755, владелец j84938826. SHA .envrc `f228ab287db1926f8ca47f987a5155f7d3811ff3f9275247d0cd5658875faefe`. Наличие свободного места подтверждено. До независимой приёмки публичных изменений не делали. По отдельному поручению владельца на HOLD установлена только постоянная защита dotfiles в `.htaccess`; index и `.envrc` остались прежними. Текущий docroot содержит эти три файла; application release не опубликован.

HTTPS 200; WWW HTTPS → apex 301; HTTP apex → HTTPS **302**, менять после GO документированным механизмом с проверкой заголовка прокси. Gzip подтверждён. SSL в панели активен для apex/www до 28.01.2027.

NS Jino, MX mail.zhk-dom-umorya.ru, SPF `v=spf1 redirect=_spf.jino.ru` и DKIM селектор `dkim._domainkey` независимо подтверждены по DNS. DMARC отсутствует; это последующая задача после почтовой проверки. Sendmail доступен. **Ни одного реального письма не отправлено; доставка/SPF/DKIM конкретного письма пока не подтверждены.** SMTP не используется.

## Что требуется перед production

Точный GO на пакет; утверждение legal редакции и доступа/удаления писем; фиксация прав на полный набор медиа. Для одного synthetic email — отдельное разрешение. До подтверждённой доставки в Inbox/Spam и заголовков/отсутствия дублей форма остаётся выключена. Выбор при недоставке — rollback или информационная версия по отдельному решению владельца. [Команды и порядок выпуска/отката](../../ops/README.md).

GitHub CI/Actions не запускались, платные минуты не расходовались, staging не создавался, другие домены не менялись. Production DONE не заявляется до фактического выпуска и приёмки письма.


## Исправление блокера независимой приёмки — 31.10.2026

[Первый комментарий](https://github.com/AntonZemlya/dom-u-morya/pull/16#issuecomment-6533142991) и [дополнение про rollback](https://github.com/AntonZemlya/dom-u-morya/pull/16#issuecomment-6533174102) учтены. Старый архив `9f6ee0429f078758f289673055f9d3860ca0e6980c89d29d8de2a5b6d6e54cf0` остаётся HOLD и программно запрещён к deploy.

Постоянный guard применяется до публикации index, независимо от блока 301. Он сохраняется после rollback; unsafe `.htaccess` из старой копии не восстанавливается. Build/release отвергает пакет без guard. Deploy требует HTTP 403/404 до записи index; rollback повторяет HTTP-проверку. Реальный loopback Apache 2.4.66 + TLS + PHP 8.4.14 FastCGI проверяет исходную утечку 200, затем 5 защищённых состояний: до index, после публикации без 301, с 301, после обычного и legacy rollback. Во всех состояниях проверяются существующие hidden files, nested dot-directories, percent-encoded paths, GET/HEAD, ACME HTTP/HTTPS 200, PHP и index. Все временные процессы остановлены. [Машинный отчёт](security-http.json).

На Jino выполнено только разрешённое security-only исправление текущей заглушки. Создан отдельный pre-security backup; `.envrc`/index побайтово сохранены, их владельцы/права не менялись. Подтверждены прямой /.envrc = 403, HTTPS index = 200, прежние HTTP 302 / WWW 301. Настройки интерпретатора, SSL, остальных доменов не менялись. Реальных писем нет; application release/форма не опубликованы.

[Проверка Jino](security-jino.json): 38 HTTP-проверок служебных путей, существующие скрытые CSS/PHP = 403, фактический PHP 8.4.27, ACME = 200, удалённые пробы = 403/404; только три ожидаемых файла после cleanup. Полные результаты Jino, новый HEAD/SHA, приватный пакет, новый backup и команды находятся в обновлённом `.release-output/GO-PROD.md`. Статус — HOLD для повторной независимой приёмки; staging не создаётся. Favicon, дизайн, HTML/CSS/JS, каталог и медиа при этом исправлении не изменены.

Основание правил: [Apache FilesMatch](https://httpd.apache.org/docs/2.4/mod/core.html#filesmatch), [Require all denied](https://httpd.apache.org/docs/2.4/mod/mod_authz_core.html#require), [RewriteRule F/END](https://httpd.apache.org/docs/2.4/rewrite/flags.html). Правило 301 остаётся основанным на [справке Jino](https://jino.ru/spravka/hosting/).

Сравнение dist со старым независимо принятым архивом: из 242 публичных путей изменена только `.htaccess`; остальные 241 файла, включая favicon, HTML/CSS/JS, планы и фотографии, побайтово идентичны. [Хеши и список](security-release-diff.json). Полный визуальный/SEO/performance baseline принят ранее; повторены проверки сборки, PHP/fake-mail и расширенный security lifecycle, относящиеся к этому исправлению.

# R2B: доказательства локальной приёмки

База `origin/main` после fetch22.11.2026 МСК: `f75b518c795590d833b202d206f89eb32d3c439a`.
Worktree: `/Users/azm1982/.codex/worktrees/6705/dom-u-morya`, ветка `codex/r2b-house-publisher`.
Окончательный R2A: `db9963536daeb68ab9466684adb3df9da6bdc1e1`, чистый `/private/tmp/rpm-r2a-acceptance`.
Начальная версия задания R2A: `c78c8894c0a5e69097023dde3e892aa88010dff2`.

## Результаты

| Проверка | Результат | Доказательство |
| --- | --- | --- |
| Publisher интеграция, PHP8.4.27 |13/13 PASS|[integration.log](integration.log)|
| Независимое review и повторные проверки |нет оставшихся P0/P1|[independent-review.md](independent-review.md)|
| Release manager, включая совместимый релиз и запрет старого reader при rollback |68/68 PASS|[independent-release-manager.log](independent-release-manager.log)|
| Штатный CI fast |13/13 PASS|[ci-fast.json](ci-fast.json)|
| PHP8.4 contract |93 assertions PASS, fake mail only|[php84-contract.log](php84-contract.log)|
| Browser/PDF, Chromium 151.0.7922.34 и PHP8.4.27 |PASS|[browser.json](e2e/browser.json), [e2e.json](e2e/e2e.json)|

Фактически скачаны три PDF выбранного ID900002 за7000000руб. Проверены содержимое листа для растрирования, заголовок PDF, размер и hash; итоговая страница визуально проверена. После смены версии та же вкладка не выдаёт PDF, даже если выбранный ID/цена не изменились. После invalidate — тоже. Более позднее подтверждение возвращает возможность выдачи. Запросы браузера ограничены loopback GET/HEAD; POST и внешние запросы запрещены.

## Независимо передаваемые ожидания пакетов

| Пакет | SHA256 manifest.json | Нативный SHA256 | checked_at UTC |
| --- | --- | --- | --- |
| A | `e5e2910c79443d8617dd20ee38c8830ddf02053744f7bd996d03b08cc44a9126` | `d8e478005055082696a9b5a1f303599a95508b549a028dd510c1777cebdbbe6b` | 2026-11-21T21:39:31Z |
| B | `2b68cafbc0e3e661ccf92b693b0d881db0e6d164eee1186f8b567fcb4cf47727` | `a5cdf174d551caccb63419661c3dd10e9efb9e7cd2d0942088cdbcad1fb08111` | 2026-11-21T21:39:32Z |
| C | `f062cdb9df68d883b34275e3916695f426662d80268179713f184e5e11c059ff` | `a5cdf174d551caccb63419661c3dd10e9efb9e7cd2d0942088cdbcad1fb08111` | 2026-11-21T21:39:33Z |

Точные байты трёх manifest сохранены в [manifests/](manifests/). Корень пакетов:

`/private/var/folders/qd/p6dgnfjd4l5flstpbmw9ylrw0000gn/T/dom-publisher-packages-5kpwub1r`

Полные каталоги и независимые expected SHA находятся в [e2e/fixtures.json](e2e/fixtures.json). Пакеты A/B/C собраны настоящим генератором. B меняет другую цену и удаляет лот; C имеет тот же native SHA, но новое подтверждение. В отличие от входного пакета, этот JSON является отдельной доверенной записью SHA для команды приёмки.

## Повтор координатором

```sh
cd /Users/azm1982/.codex/worktrees/6705/dom-u-morya
export PATH="/private/tmp/dom-u-morya-pagespeed-repo/toolchain/php@8.4/8.4.27_1/bin:$PATH"
python3 -B tests/r2b_e2e.py \
  --fixtures /Users/azm1982/.codex/worktrees/6705/dom-u-morya/review/r2b/e2e/fixtures.json \
  --output /private/tmp/dom-publisher-coordinator-replay
```

Пример независимой приёмки A:

```sh
python3 -B ops/catalog_publisher.py verify \
  --package /private/var/folders/qd/p6dgnfjd4l5flstpbmw9ylrw0000gn/T/dom-publisher-packages-5kpwub1r/projects/sadovoe-kolco/24/house-by-the-sea/exports/packages/e5e2910c79443d8617dd20ee38c8830ddf02053744f7bd996d03b08cc44a9126 \
  --sha e5e2910c79443d8617dd20ee38c8830ddf02053744f7bd996d03b08cc44a9126
```

Через36часов сохранённые подтверждения намеренно истекают. Создание свежих реальных пакетов и новая E2E:

```sh
python3 -B tests/r2b_e2e.py \
  --r2a-repo /private/tmp/rpm-r2a-acceptance \
  --output /private/tmp/dom-publisher-coordinator-fresh
```

Свежие SHA и пути печатаются и записываются runner. Для воспроизводимых байтов можно передать `--checked-at 2026-11-21T21:39:31Z`; это не обходит TTL. Серверы после прогона остановлены; не используйте старые порты из логов.

## Контроль первого перехода и восстановления

В integration.log строка `LEGACY_PREVIEW_BINDINGS` содержит точные старый/новый URL и SHA обеих HTTP-выдач. Оригинал SVG:
`026ef1ab1116319eafed3c5a65c9f3c24034c4d4bb1d17138826dec2ee19cb1d`.
Прежний VP8L WebP SHA:
`724422453b135750225c8af5c2c9b32cad6aaa62c95f56b749626a84512afe7c`.
Новый R2A WebP SHA:
`8105e8c154ed6b1944ac9646f1563e7e54e4d5fb3fec14a9599a03387ab77c77`.

Проверен legacy bootstrap из28 отслеживаемых лотов и60SVG/VP8L, новый пакет с тем же оригиналом и другой кодировкой превью, безопасный отказ старого транспорта при коллизии, неизменные старые URL, ручное восстановление и offline-возврат worker. SIGKILL/retry/response-loss/CAS-recovery, повреждённый прежний ресурс, общие locks, сохранение полей/outbox, delayed invalidate после нового same-native подтверждения и TTL покрыты постоянными тестами и независимыми логами.

Порядок переключения/восстановления и точные CLI аргументы: [ops/R2B-PUBLISHER-RUNBOOK.md](../../ops/R2B-PUBLISHER-RUNBOOK.md).
Production, merge, Jino/VPS/Cron, живой источник, доставка заявок и реальная почта не затрагивались.

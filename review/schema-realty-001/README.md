# SCHEMA-REALTY-001 · отчёт для независимой приёмки

8 ноября 2026 года. База — `ade7a7b`. Изменены JSON-LD главной, сведения о проверке в видимых карточках и дата соответствующего снимка в расчёте и серверном справочнике. Каталог формируется из того же набора записей и той же модели названий, что и карточки в HTML.

## Коммерческая сверка на 8 ноября

Прочитаны страница проекта и 28 индивидуальных страниц застройщика. В публичных данных каталога отобраны записи проекта 24 с кодом house-by-the-sea. Наборы ID совпали полностью. Для каждой квартиры сверены её ID, номер, корпус, секция, этаж, площадь и число спален. Цена в каталоге совпала с точной ценой в детальных данных и Offer на странице застройщика. На каждой из 28 страниц застройщик явно указал валюту RUB и статус InStock. Расхождений с прежними ценами и исключений по доступности нет. [Каталог застройщика](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea)

Единый источник для нашей разметки и HTML — записи в `data/apartments.json`. В них сохранены URL карточки, время получения, дата снимка, цена и статус застройщика. В «О квартире» видны статус на дату проверки и ссылка на источник. Дата в расчётах и PDF берётся из выбранного лота.

## Что описывает граф

| Узел | Смысл и источник |
| --- | --- |
| `ApartmentComplex` | Сам проект. Все квартиры связаны с ним через `containedInPlace`. Сохранён город Мариуполь. В источниках расходится обозначение улицы или проспекта Адмирала Лунина, 25. Для более точного адреса требуется сверка. |
| `WebPage`, `WebSite`, две `Organization` | Сохранены страница, сайт, оператор и застройщик. У главной `about` указывает на ЖК, `mentions` — на каталог. |
| `ItemList` | Один список на главной, 28 ссылок на сущности квартир. `numberOfItems` считает карточки этого каталога. По данным сайта в ЖК запроектировано 258 квартир. |
| `Apartment` | Отдельный стабильный идентификатор на основе ID застройщика, видимое название с номером квартиры, этаж, площадь в м² (MTK), число спален по классификации источника. Для студии число отдельных спален равно нулю. |

На юридических страницах каталог отсутствует. Идентификаторы вида `/#apartment-22825` обозначают сущности графа. Ссылки пользователя на планировки открывают SVG, отдельного HTML-маршрута для квартиры сейчас нет. [ApartmentComplex](https://schema.org/ApartmentComplex) · [Apartment](https://schema.org/Apartment) · [ItemList](https://schema.org/ItemList)

`Apartment.subjectOf` указывает на внешнюю страницу объявления застройщика типа `RealEstateListing`. В ней `offers` описывает проверенную цену, валюту и наличие. Эта связь привязывает предложение к конкретной квартире и источнику. Оператор сайта не объявляется продавцом. При неизвестном статусе коммерческий узел пропускается. Отдельно учтены явные статусы продажи или недоступности. [RealEstateListing](https://schema.org/RealEstateListing) · [Offer](https://schema.org/Offer) · [subjectOf](https://schema.org/subjectOf)

## Как поисковики могут использовать данные

Поисковики могут извлечь принадлежность квартир к комплексу, их характеристики, цены, статус и состав опубликованного каталога. В галерее поддерживаемых Google форматов отсутствует специальный расширенный результат для продажи квартир по типу Apartment. Для выдачи Яндекса действуют собственные требования сервисов. Распознавание сущностей не гарантирует особого сниппета. [Google Search Central — поддерживаемые форматы](https://developers.google.com/search/docs/appearance/structured-data/search-gallery) · [Рекомендации Google](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) · [Справка Яндекс Вебмастера](https://yandex.ru/support/webmaster/ru/yandex-indexing/validator)

## Каталог и отдельные страницы

Все 28 уникальных ID в опубликованном HTML совпали с `data/apartments.json`. Квартиры сгруппированы в четыре раскрываемые категории, их площади, этажи, номера и схемы доступны без JavaScript. С JavaScript интерфейс показывает список порциями и поддерживает фильтрацию. Для поиска весь каталог имеет один canonical. Он пригоден для запросов по ЖК, а поделиться ссылкой на самостоятельную индексируемую карточку определённой квартиры сейчас нельзя.

Рекомендуем отдельные стабильные URL, если владелец готов поддерживать карточки лотов. Каждой нужны содержательный HTML с планом и характеристиками, ссылка из каталога, собственный canonical, актуальная дата и понятное состояние после продажи или снятия. Тогда можно адресовать конкретные квартиры в поиске и передавать ссылку партнёрам. Для выпуска нынешнего графа создание таких страниц необязательно.

## Яндекс Недвижимость и актуализация

YRL — отдельный XML-канал передачи объявлений на площадку. Подготовку фида имеет смысл начинать после подтверждения полномочий размещающей стороны, возможности размещения данного ЖК и регулярного источника актуальных данных. Для подготовки понадобятся ID комплекса и корпуса в Яндексе, точный адрес, состояние и срок сдачи дома, контакт продавца, даты объявлений, актуальные цены и статусы квартир, разрешённые к использованию планы и изображения. Требуется порядок обновления и удаления проданных лотов. Разовая сверка 8 ноября не обеспечивает последующие обновления фида. [Общие требования YRL](https://www.yandex.ru/support/realty/ru/feed/content-requirements) · [Требования к новостройкам](https://www.yandex.ru/support/realty-partner/ru/requirements-sale-new)

Перед выпуском повторить сверку цен и наличия по официальному каталогу и индивидуальным карточкам, если с момента проверки данные могли измениться. Для YRL отдельно сверить адрес по документам, идентификаторы Яндекса и полномочия размещающей стороны.

## Проверки

- Локальные `npm run ci:fast` и `npm run test:seo` прошли. В браузерных тестах использовались 320, 390, 768 и 1440 px с JavaScript и без него.
- На главной 34 уникальных определения с `@id` и по 28 вложенных RealEstateListing и Offer. Проверены ссылки списка, связь с ЖК, единицы, этаж и число спален каждой квартиры. В локальном режиме без origin используются внутренние идентификаторы. Сборка сверяет ID квартир с HTML.
- Заголовки SEO, canonical и og:url, социальные метаданные, robots.txt и sitemap.xml проверены сравнением с базой main для того же HTTPS origin.
- Валидаторы получили JSON-LD, извлечённый из собранной главной. SHA-256 минимальной HTML-обёртки — `aab7ebffcf3af7285501cb5fc93d10ee226f3245dad34e488349172f98b9859e`.
- Schema Markup Validator вернул 0 ошибок и 0 предупреждений. Яндекс Вебмастер в режиме «HTML-код» извлёк 28 Apartment и 28 Offer, в результатах зарегистрировано 28 значений https://schema.org/InStock. [Валидатор Schema.org](https://validator.schema.org/) · [Валидатор Яндекса](https://webmaster.yandex.ru/tools/microtest/)
- Google Rich Results Test в режиме Code после отправки вернул «Something went wrong» и предложил повторить через несколько часов. Подтверждённого результата Google для этой сборки пока нет. Для повторной проверки вставить блок `<script type="application/ld+json">` из локального `dist/index.html` после `SITE_URL=https://zhk-dom-umorya.ru npm run build:production`. [Rich Results Test](https://search.google.com/test/rich-results)

## Сверка по лотам

Каждая ссылка ведёт на индивидуальный источник. Время сверки — 8 ноября 2026 года около 17:25 МСК.

| ID | № квартиры | Цена, ₽ | Статус застройщика |
| --- | ---: | ---: | --- |
| [22825](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22825?projectId=1) | 6 | 6 978 183 | InStock |
| [22936](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22936?projectId=1) | 117 | 7 741 038 | InStock |
| [22952](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22952?projectId=1) | 133 | 7 762 135 | InStock |
| [22953](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22953?projectId=1) | 134 | 7 762 135 | InStock |
| [22890](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22890?projectId=1) | 71 | 7 933 673 | InStock |
| [22906](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22906?projectId=1) | 87 | 7 956 744 | InStock |
| [22822](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22822?projectId=1) | 3 | 8 042 710 | InStock |
| [22833](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22833?projectId=1) | 14 | 8 042 710 | InStock |
| [22838](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22838?projectId=1) | 19 | 8 067 093 | InStock |
| [22849](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22849?projectId=1) | 30 | 8 067 093 | InStock |
| [22875](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22875?projectId=1) | 56 | 8 080 996 | InStock |
| [22820](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22820?projectId=1) | 1 | 8 341 040 | InStock |
| [22886](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22886?projectId=1) | 67 | 8 383 931 | InStock |
| [22835](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22835?projectId=1) | 16 | 8 426 566 | InStock |
| [22918](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22918?projectId=1) | 99 | 8 432 661 | InStock |
| [22938](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22938?projectId=1) | 119 | 8 464 100 | InStock |
| [22851](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22851?projectId=1) | 32 | 8 527 337 | InStock |
| [22867](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22867?projectId=1) | 48 | 8 553 233 | InStock |
| [22907](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22907?projectId=1) | 88 | 8 783 698 | InStock |
| [23029](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/23029?projectId=1) | 210 | 8 831 424 | InStock |
| [22828](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22828?projectId=1) | 9 | 9 417 369 | InStock |
| [22844](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22844?projectId=1) | 25 | 9 542 302 | InStock |
| [22876](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22876?projectId=1) | 57 | 9 599 951 | InStock |
| [22940](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/22940?projectId=1) | 121 | 10 676 180 | InStock |
| [23003](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/23003?projectId=1) | 184 | 11 093 210 | InStock |
| [23031](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/23031?projectId=1) | 212 | 11 655 243 | InStock |
| [23024](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/23024?projectId=1) | 205 | 14 714 343 | InStock |
| [23037](https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea/23037?projectId=1) | 218 | 15 154 854 | InStock |

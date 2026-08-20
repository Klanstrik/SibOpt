# Как смотреть заявки в PostgreSQL

После запуска проекта через PostgreSQL в базе автоматически создаются обычные рабочие таблицы и удобные представления для просмотра.

## Для просмотра заявок

В pgAdmin откройте:

PostgreSQL 18 → Databases → sibir_optika → Schemas → public → Views → zayavki_dlya_buhgalterii

Дальше нажмите правой кнопкой по `zayavki_dlya_buhgalterii`:

View/Edit Data → All Rows

Там заявки отображаются понятными колонками:

- Дата заявки
- Статус
- Тип заявки
- Имя клиента
- Телефон
- Товар или услуга
- Рецепт / параметры
- Комментарий клиента
- Заметка сотрудника
- Страница сайта
- Источник
- Последнее изменение
- ID заявки

## Для просмотра товаров

PostgreSQL 18 → Databases → sibir_optika → Schemas → public → Views → tovary_dlya_prosmotra

Правой кнопкой:

View/Edit Data → All Rows

## Что не нужно открывать

`backup.leads_json_backup` и `backup.products_json_backup` — это старые резервные копии после перехода с JSON. Они нужны только для сохранности старых данных. Для обычного просмотра их открывать не нужно.

Рабочие данные находятся в:

- `public.leads`
- `public.products`
- `public.settings`

Для удобного просмотра используйте именно:

- `public.zayavki_dlya_buhgalterii`
- `public.tovary_dlya_prosmotra`

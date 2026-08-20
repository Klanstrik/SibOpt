# Исправление ошибки PostgreSQL VIEW

Исправлена ошибка запуска:

> изменить имя столбца "ID заявки" на "Номер заявки" в представлении нельзя

Причина:
PostgreSQL не разрешает менять набор/имена колонок существующего VIEW через `CREATE OR REPLACE VIEW`.

Что исправлено:
- перед пересозданием читаемых представлений теперь удаляются ВСЕ связанные VIEW:
  - `public.zayavki_dlya_buhgalterii`
  - `zayavki_dlya_buhgalterii`
  - `public.tovary_dlya_prosmotra`
  - `tovary_dlya_prosmotra`
  - `leads_readable`
  - `crm_leads_readable`
  - `sales_report_readable`
  - `leads_export_readable`
- таблицы и заявки не удаляются;
- PostgreSQL-данные сохраняются;
- после запуска VIEW создаются заново с актуальными колонками.

После распаковки:
1. Скопируйте свой `.env` в корень проекта.
2. Запустите `npm start`.

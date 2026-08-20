# SEO-апгрейд проекта «Сибирь-Оптика»

Что добавлено в код:

- Исправлены `canonical` URL на абсолютные адреса.
- Заменён `example.ru` в `robots.txt` и `sitemap.xml`.
- Добавлены Open Graph и Twitter Card мета-теги.
- Добавлена микроразметка Schema.org: `Optician` и `BreadcrumbList`.
- Добавлен `site.webmanifest`.
- Добавлена OG-картинка `public/og-image.svg`.
- В `server.js` добавлены gzip-сжатие, ETag, `Cache-Control` для статики и `X-Content-Type-Options`.
- В `.env.example` добавлена переменная `SITE_URL`.

Перед реальной публикацией замени домен в `.env`:

```env
SITE_URL=https://твой-домен.ru
```

Важно: SEO не выводит сайт в топ мгновенно. После публикации нужно добавить сайт в Google Search Console и Яндекс Вебмастер, отправить sitemap и подключить Яндекс Бизнес / Google Business Profile.

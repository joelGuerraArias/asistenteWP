# Versiones — AsistenteWP

La versión vive en `package.json`.

## 2.5.0 — 2026-08-23

Publicación automática desde feeds RSS a webhooks de redes (mismo gráfico + caption que al pegar un enlace).

### Feed → redes (cron 09:15–21:15)

- Hasta **2 noticias nuevas** por marca y corrida; **nunca repite** (`guid`/`link` en `.feed-repost-sent.json`)
- **FV Digital:** `https://fvdigital.do/feed` → webhook `fvdigital` (`#fvdigital`)
- **F1RD:** Motorsport F1 + Híbridos y Eléctricos **intercalados** → webhook `formula1rd` (`#Formula1RD`)
  - `https://lat.motorsport.com/rss/f1/news/`
  - `https://www.hibridosyelectricos.com/uploads/feeds/feed_hibridos-y-electricos_es.xml`
- Genera titular corto + caption con IA, tarjeta social (R2) y envía al webhook
- Aviso obligatorio en Telegram (con foto de la tarjeta)
- Gráficos F1RD: logo **Fórmula 1 Al Límite** (alpha), tag **f1mister**, pie **www.formula1rd.com**
- Tarea Windows `AsistenteWP-FeedRepost`
- Comandos: `npm run feed:repost`, `feed:repost:dry`, `feed:repost:f1`, `feed:repost:cron:install`

### Destino F1RD en el bot (desde 2.0)

- Destino FV / F1RD / Ambos al pegar IG/FB/YT/Dailymotion
- Hashtag F1RD unificado a `#Formula1RD`

## 2.0.0 — 2026-08-22

Destino de publicación **antes** de Video/Noticia en enlaces de Instagram, Facebook, YouTube y Dailymotion.

- El bot pregunta **FV Digital**, **F1RD** o **Ambos**
- FV Digital: WordPress + webhook `#fvdigital`
- F1RD: solo redes (`#f1rd`), sin WordPress
- Ambos: WordPress FV y los dos webhooks
- Noticias de periódicos (URL normal) siguen solo FV Digital
- X/Twitter no entra en esta pregunta de destino

## 1.0.1 — 2026-08-22

Snapshot actual en GitHub (post-commit inicial).

- Enlaces YT/IG/FB/X: el bot pregunta Video o Noticia
- WordPress: timeout y errores cortos (deja de mandar HTML 522 a Telegram)
- Si WordPress falla, el gráfico igual se envía a redes (R2 + webhook)
- Frase célebre diaria HyperFrames (cron 08:00)
- Digest DGCP, purge Intrant >24h, filtro `juan manuel mendez`
- Termómetro `/foto`, `/nota`, `/periodista`, `/trad`
- Alertas Gmail y hojas Intrant/Edesur

## 1.0.0 — 2026-08 (commit `17bba62`)

Primera versión en GitHub: bot Telegram, WordPress, monitoreo TV/radio.

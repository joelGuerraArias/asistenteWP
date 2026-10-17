# Versiones — AsistenteWP

La versión vive en `package.json`.

## 2.8.0 — 2026-10-17

### Encuestas ALPHA + comandos Telegram

- ALPHA nuevo: pregunta solo en el recuadro azul de abajo (sin opciones en el gráfico)
- `/encuesta` — foto + pregunta → tarjeta → webhook (revisa ortografía y avisa, **no cambia** el texto)
- `/encuestadoble` — pide 2, 3 o 4 fotos, rostros en círculos (+ VS si son 2) → pregunta → webhook
- Cola temática desde markdown + `encuestas/fotos/` (cron 09:00 / 16:00)

### Videos en Desktop\video2

- Todo video procesado (`/video`, `/trad`, `/dub`, `/ndigital`, `/local`, SIE, frase) se archiva en `Desktop\video2` con su `.txt` de caption
- Scripts para re-bajar del día desde R2

### Otros

- Acumulado desde 2.7.0: reportes redes, SIE publish, freshness 24h, feeds gráficos, dub ElevenLabs, etc.

## 2.7.0 — 2026-09-30

### Envío de correos resiliente (SMTP bloqueado por VPN/ISP)

- Diagnóstico 01/10/2026: **UrbanVPN** bloqueaba 25/465/587/2525 → el correo del REPORTE ejecutivo (07:30), Google Alerts (07:00) y DGCP (08:00) fallaron con `connect ETIMEDOUT 1.179.119.1:587` (tarea con resultado 1)
- `sendEmail` reintenta ahora por la **API HTTPS de Brevo (puerto 443)** cuando el SMTP falla — requiere `BREVO_API_V3_KEY` (clave `xkeysib-`; la clave SMTP `xsmtpsib-` no sirve para la API)
- SMTP con timeouts cortos: falla en ~15 s en lugar de esperar minutos, e indica la alternativa en el mensaje de error

### Correos de X, Instagram y YouTube: URL de la fuente obligatoria

- Cada mención muestra, además del botón **Ver publicación / Ver post / Ver video**, la línea **URL de la fuente:** con la dirección completa en texto visible
- Aplica a los correos de `run-social-report.mjs` (X, Instagram, YouTube), al bloque del último post de @intrant_rd, al del último video del canal del INTRANT y al monitor `instagram-monitor`
- Si una publicación no trae enlace, la línea indica "no disponible en este corte" (nunca se omite)
- `run-social-report.mjs` avisa en consola cuántos ítems llegaron sin URL

### Feed FV Digital → redes: 4 noticias por corrida

- `FEED_REPOST_COUNT` pasa de **2** a **4**: el cron 09:15–21:15 publica hasta 4 noticias nuevas de `https://fvdigital.do/feed` por corrida
- F1RD se mantiene en **2** (`FEED_REPOST_F1_COUNT=2`)
- Valores explícitos en `.env` / `.env.example`; la tarea `AsistenteWP-FeedRepost` muestra el conteo en su descripción

## 2.6.0 — 2026-09-03

### /trad — elegir fuente de voz
- Tras descargar el video, pregunta: **traducir el audio** o **crear audio desde el caption**
- Modo caption: **siempre traduce el caption a español** antes del TTS
- Si solo hay una fuente viable, continúa sin preguntar

### F1RD en español
- Gráficos (titular de tarjeta) y captions de Formula1RD pasan a **español** (antes inglés)

### /busca y monitor sitio INTRANT
- `/busca` localiza titulares con Tavily + Brave y arma correo estilizado
- Cron 08:00 / 18:00 en `intrant.gob.do/noticias`: si hay noticia nueva → mismo flujo `/busca`
- Destinatarios: correos Intrant + autosemana; CC belgicajr

### REPORTE Intrant y otros
- REPORTE consolidado a Word (`.docx`) + correo
- Mejoras `/pic` (destino FV/F1RD + envío)
- Encuestas y scripts de cron asociados

## 2.5.0 — 2026-08-23

Publicación automática desde feeds RSS a webhooks de redes (mismo gráfico + caption que al pegar un enlace).

### Feed → redes (cron 09:15–21:15)

- Hasta **2 noticias nuevas** por marca y corrida; **nunca repite** (`guid`/`link` en `.feed-repost-sent.json`)
- **FV Digital:** `https://fvdigital.do/feed` → webhook `fvdigital` (`#fvdigital`)
- **F1RD:** Motorsport F1 → webhook `formula1rd` (`#Formula1RD`)
  - `https://lat.motorsport.com/rss/f1/news/`
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

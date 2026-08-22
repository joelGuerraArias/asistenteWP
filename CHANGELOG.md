# Versiones — AsistenteWP

La versión vive en `package.json`. Major (`2.0.0`) cuando cambia el flujo de publicación.

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

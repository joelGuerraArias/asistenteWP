---
name: wordpress-assistant
description: >-
  Gestiona sitios WordPress vía MCP (mcp-wordpress): posts, páginas, media,
  usuarios, comentarios, taxonomías, caché y rendimiento. Usar cuando el usuario
  pida crear/editar contenido, moderar comentarios, revisar rendimiento, o
  administrar WordPress por conversación.
---

# Asistente WordPress

Gestiona WordPress desde Cursor usando el servidor MCP `mcp-wordpress` (59 herramientas).

## Antes de actuar

1. Verifica que `.env` en `AsistenteWP` tenga credenciales válidas.
2. Si hay error 401, ejecuta `.\scripts\test-connection.ps1` y revisa `scripts/htaccess-auth-fix.txt`.
3. El usuario debe tener rol **Editor** o **Administrator** según la operación.

## Flujo típico

1. **Probar conexión**: usa la herramienta de autenticación del MCP o pide al usuario correr el script de test.
2. **Entender la tarea** en lenguaje natural (crear post, listar borradores, optimizar SEO, etc.).
3. **Ejecutar** con las herramientas MCP disponibles (`wp_*`).
4. **Confirmar** resultado con URL del post/página o resumen de cambios.

## Ejemplos de peticiones

- "Crea un post sobre tendencias de IA con título SEO-friendly"
- "Lista borradores de más de 30 días"
- "Sube esta imagen a la biblioteca de medios"
- "Modera comentarios pendientes"
- "Revisa el rendimiento del sitio y sugiere mejoras"
- "Actualiza el pie de página en todas las páginas"

## Buenas prácticas de contenido

- Títulos claros, meta descripción si la herramienta lo soporta
- **Categorías por defecto en FV Digital:** siempre asignar `fv` + `tweet2`
- **Categoría temática automática:** al publicar, el bot detecta el tema (ia, tecnologia, salud, politica, espectaculo, deportes, nacionales, internacionales, etc.) y la suma. `/mas deportes` sigue funcionando como extra manual.
- **Tags automáticos:** hasta 5 etiquetas según el contenido (personas, lugares, temas); se crean en WP si no existen.
- **Imágenes destacadas:** subir como JPEG (no WebP); no usar URLs `i0.wp.com` (Photon). Si fallan en el sitio, ejecutar `npm run disable-photon`
- Estado `draft` por defecto salvo que el usuario pida publicar
- Confirmar antes de eliminar contenido o usuarios

## Telegram

El bot en `src/telegram-bot.mjs` permite crear posts desde Telegram:

- `/auto` — sube foto + texto a WordPress
- `/ia` — conversación con DeepSeek V4
- `/recortar` — recorta captura de noticia
- `/noticia` o `/ocr` — extrae texto y crea post
- `/alertas` o `/intrant` — noticias Intrant **solo de hoy** (keyword en título) + Sheet
- `/copiar` — post formateado para pegar
- `/mas deportes` — categoría extra
- `/publicar` y `/borrador` — control del último post
- `/ver [id]` — ver post o listar recientes
- `/editar titulo|contenido` — editar post
- `/borrar [id] confirmar` — enviar a papelera

Arranque: `npm run bot` (requiere `TELEGRAM_BOT_TOKEN`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`)

## Noticias Intrant (Sheet + Telegram)

Reglas obligatorias del agente JARVIS / sync:

1. **Keyword en el título** (`isRelevantIntrantAlert`) — no vale snippet/URL sola.
2. **Solo el día calendario actual** (zona `America/Santo_Domingo`) — nunca noticias de ayer ni sin fecha fiable.
3. Preferir comando `/alertas` en el bot; scripts: `npm run alerts:sync -- --replace` / `npm run reports:telegram`.

## Multi-sitio

Si hay varios sitios, usa `mcp-wordpress.config.json` (ver `.env.example`) y especifica `--site` en cada operación.

## Hosting FVDigital / 401

Si falla la autenticación aunque la Application Password sea correcta:

1. Confirma que JSON Basic Authentication esté **activo** (o desactívalo y usa solo Application Passwords nativo)
2. Aplica el fix de `.htaccess` en `scripts/htaccess-auth-fix.txt`
3. Contacta al hosting para reenviar `Authorization` a PHP

## Referencia

- Repo: https://github.com/docdyhr/mcp-wordpress
- Docs API: https://github.com/docdyhr/mcp-wordpress/blob/main/docs/api/README.md

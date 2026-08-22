# AsistenteWP — JARVIS para FV Digital

**Versión actual: `2.0.0`** — historial en [CHANGELOG.md](CHANGELOG.md).

Bot de Telegram + asistente WordPress para **fvdigital.do**. Publica noticias desde el móvil (texto, voz, foto, enlace), redacta artículos con IA y se conecta a Cursor vía [mcp-wordpress](https://github.com/docdyhr/mcp-wordpress).

---

## Requisitos

- **Node.js** 18+ (recomendado 20+)
- **Windows** (scripts de arranque automático están hechos para PowerShell)
- Cuenta WordPress con **contraseña de aplicación**
- Bot de Telegram creado con [@BotFather](https://t.me/BotFather)
- Claves API: **DeepSeek** (redacción) y **Mistral** (voz, visión, OCR)

---

## Instalación inicial

```powershell
cd "C:\Users\Joel Guerra\Desktop\software\AsistenteWP"
npm install
copy .env.example .env
```

Edita `.env` con tus credenciales (ver sección [Configuración](#configuración)).

Prueba la conexión a WordPress:

```powershell
npm run test:connection
```

---

## Encender, apagar y autoinicio

Todos los comandos se ejecutan desde la carpeta del proyecto.

### Encender el bot (manual)

```powershell
npm run bot:start
```

Inicia el bot en segundo plano, libera el puerto si estaba ocupado y evita instancias duplicadas.

Alternativa en primer plano (útil para depurar):

```powershell
npm run bot
```

### Apagar el bot

```powershell
npm run bot:stop
```

Detiene el proceso por:
- archivo `.bot.pid`
- puerto **9000**
- cualquier proceso `node` que ejecute `telegram-bot.mjs`

### Instalar arranque automático (al encender / iniciar sesión)

```powershell
npm run bot:install
```

Esto configura:
1. **Tarea programada** `AsistenteWP-JARVIS` — se ejecuta al iniciar sesión en Windows
2. **Acceso directo** en la carpeta Startup de Windows

El bot arrancará solo cada vez que enciendas la PC e inicies sesión.

### Desinstalar arranque automático

```powershell
npm run bot:uninstall
```

Elimina la tarea programada y el acceso directo de Startup. **No borra** el proyecto ni el `.env`; solo deja de iniciar solo.

### Resumen rápido

| Acción | Comando |
|--------|---------|
| Encender | `npm run bot:start` |
| Apagar | `npm run bot:stop` |
| Instalar autoinicio | `npm run bot:install` |
| Quitar autoinicio | `npm run bot:uninstall` |
| Ver en consola (debug) | `npm run bot` |

---

## Puerto 9000 — estado del bot

El bot escucha en **http://127.0.0.1:9000** (solo local, no expuesto a internet).

| URL | Respuesta |
|-----|-----------|
| `http://127.0.0.1:9000/health` | JSON con estado (`ok`, `telegram`, `uptimeSec`) |
| `http://127.0.0.1:9000/` | Igual que `/health` |

Ejemplo de respuesta sana:

```json
{
  "ok": true,
  "service": "asistente-wp-jarvis",
  "port": 9000,
  "uptimeSec": 120,
  "telegram": "online",
  "activeSessions": 0
}
```

Cambia el puerto en `.env`:

```
BOT_PORT=9000
```

---

## Logs

Cuando usas `npm run bot:start`, los logs se guardan en:

```
logs/bot-out.log   # salida estándar
logs/bot-err.log   # errores
```

Si el bot no responde en Telegram, revisa `logs/bot-err.log` primero.

---

## Configuración

Copia `.env.example` → `.env` y completa:

### WordPress (obligatorio)

```env
WORDPRESS_SITE_URL=https://fvdigital.do
WORDPRESS_USERNAME=hermes
WORDPRESS_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
DEFAULT_CATEGORIES=fv,tweet2
DEFAULT_POST_STATUS=draft
```

> La categoría `fv` se mapea al slug `fb` en fvdigital.do.

### Telegram (obligatorio)

```env
TELEGRAM_BOT_TOKEN=tu-token-de-BotFather
TELEGRAM_ECHO_ONLY=false
TELEGRAM_ALLOWED_CHAT_IDS=          # vacío = todos; o tu chat ID de @userinfobot
TELEGRAM_BUFFER_MS=12000
BOT_PORT=9000
```

### IA y audio

```env
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-pro

MISTRAL_API_KEY=...
SPEECH_PROVIDER=mistral
MISTRAL_TRANSCRIBE_MODEL=voxtral-mini-latest
MISTRAL_TTS_MODEL=voxtral-mini-tts-2603
MISTRAL_TTS_VOICE_ID=               # opcional; sin esto usa Google TTS
SPEECH_LANGUAGE=es
VOICE_REPLIES=true

MISTRAL_VISION_MODEL=pixtral-large-latest
MISTRAL_OCR_MODEL=mistral-ocr-latest
```

### Editorial

```env
NEWS_AUTHOR_SIGNATURE=Milton Jerez
```

---

## Uso del bot en Telegram

Busca tu bot (ej. `@AsisWPBot`) y envía mensajes.

### Publicación automática

| Entrada | Qué hace |
|---------|----------|
| **Enlace YT / IG / FB / Dailymotion** | Primero pregunta destino: **FV Digital**, **F1RD** o **Ambos**; luego Video o Noticia |
| **Enlace de periódico** | Solo FV Digital (WordPress + redes FV) |
| **X / Twitter** | Video o Noticia, sin pregunta F1RD |
| **Foto + texto** | Crea post con imagen destacada |
| **Texto largo** (noticia) | Publica tras unos segundos de espera |
| **Nota de voz** | Transcribe y actúa como texto |
| **"Hola"** u otro saludo | Responde con menú; **no publica** en WordPress |

### Comandos principales

| Comando | Acción |
|---------|--------|
| `/escribir` o `/escribir tema` | Redacta noticia original (investiga en la web, sugiere títulos, pide foto) |
| `/cancelar` | Cancela redacción en curso |
| `/auto` | Modo publicación directa (por defecto) |
| `/publicar` | Publica el último borrador |
| `/borrador` | Deja el último como borrador |
| `/ver` o `/ver 123` | Ver post o listar los 5 más recientes |
| `/editar titulo ...` | Cambiar título del último post |
| `/editar contenido` | El siguiente mensaje actualiza el cuerpo |
| `/borrar confirmar` | Enviar último post a papelera |
| `/recortar` + foto | Recorta captura con visión IA |
| `/noticia` o `/ocr` + captura | OCR → post con DeepSeek |
| `/ia` | Modo conversación (chat libre) |
| `/post` | Volver a modo publicación |
| `/mas deportes` | Añade categoría extra al siguiente post |
| `/copiar` | Devuelve el post para pegar manualmente |
| `/escuchar` | Solo transcribe el próximo audio, sin publicar |
| `/foto` | Video Termómetro: nombre + institución + foto del funcionario |
| `/voz on` / `/voz off` | Respuestas en audio |
| `/estado` | Modo, IA, STT, último post |
| `/ayuda` | Menú de ayuda |

### Flujo `/escribir`

1. Envías `/escribir` o describes el tema
2. El bot investiga en la web y muestra artículos relacionados
3. Sugiere 3 títulos (o escribes el tuyo)
4. Pides foto: envías imagen, `buscar`, `sin foto` o `sí`
5. Redacta y publica en WordPress

### Flujo `/foto` — Termómetro FV Digital

1. Envías `/foto` (opcionalmente `/foto Guido Gómez Mazara`)
2. El bot pide la institución (ej. `Indotel`)
3. El bot pide la foto del funcionario
4. Quita el fondo, recorta la figura y la pega en el frame base
5. Escribe letra por letra: *"¿Cómo lo ha hecho [nombre] en [institución]?"*
6. Genera un video 1:1 de **30 segundos** y lo sube a R2 → webhook de redes

### Categorías

Por defecto todos los posts llevan **fv** + **tweet2**. Añade más con `/mas deportes` o `+deportes` en el texto.

---

## Cursor / MCP WordPress

El servidor MCP permite usar WordPress desde el chat de Cursor.

```powershell
npm run mcp
```

Tras editar `.env`, reinicia Cursor. El servidor MCP suele estar en `~/.cursor/mcp.json`.

Ejemplos en Cursor:
- "Prueba mi conexión a WordPress"
- "Crea un post sobre IA con optimización SEO"
- "Lista mis borradores"

### Error 401 en hosting

Si el test falla con 401 pero la contraseña es correcta, el hosting no pasa `Authorization` a PHP. Solución: `scripts/htaccess-auth-fix.txt`.

---

## Solución de problemas

### El bot no responde en Telegram

1. Comprueba que está vivo: http://127.0.0.1:9000/health
2. Si no responde: `npm run bot:stop` y luego `npm run bot:start`
3. Revisa `logs/bot-err.log`

### Error 409 — Conflict (varias instancias)

```
Conflict: terminated by other getUpdates request
```

Significa que hay **más de un bot corriendo**. Solución:

```powershell
npm run bot:stop
# Espera 3 segundos
npm run bot:start
```

**No ejecutes `npm run bot` varias veces** ni mezcles `bot` y `bot:start` a la vez.

### La voz no funciona

- Verifica `MISTRAL_API_KEY` en `.env`
- Prueba `/escuchar` y envía un audio corto
- Si `VOICE_REPLIES=true` pero no hay audio de respuesta, configura `MISTRAL_TTS_VOICE_ID` o deja que use Google TTS como respaldo

### Imágenes destacadas no se ven (Jetpack Photon)

```powershell
npm run disable-photon
```

### Reinicio completo (limpio)

```powershell
npm run bot:stop
npm run bot:uninstall    # opcional: quitar autoinicio
npm run bot:install      # opcional: volver a poner autoinicio
npm run bot:start
```

---

## Estructura del proyecto

```
AsistenteWP/
├── .env                    # credenciales (no commitear)
├── .env.example
├── .bot.pid                # PID del proceso activo (generado al arrancar)
├── logs/                   # logs del bot en segundo plano
├── config/
│   └── categories.json     # mapeo de categorías WP
├── scripts/
│   ├── run-bot.ps1         # encender en segundo plano
│   ├── stop-bot.ps1        # apagar
│   ├── install-autostart.ps1
│   ├── uninstall-autostart.ps1
│   ├── test-connection.ps1
│   └── disable-photon.mjs
└── src/
    ├── telegram-bot.mjs    # bot principal
    ├── http-server.mjs     # health check puerto 9000
    ├── wordpress.mjs       # API REST WordPress
    ├── deepseek.mjs        # redacción y formato
    ├── audio.mjs           # STT / TTS
    ├── news-fetch.mjs      # importar desde URL
    ├── news-research.mjs   # investigación web
    └── ...
```

---

## Scripts npm

| Script | Descripción |
|--------|-------------|
| `npm run bot` | Bot en primer plano (consola) |
| `npm run bot:start` | Bot en segundo plano |
| `npm run bot:stop` | Detener bot |
| `npm run bot:install` | Autoinicio al encender / iniciar sesión |
| `npm run bot:uninstall` | Quitar autoinicio |
| `npm run test:connection` | Probar WordPress |
| `npm run mcp` | Servidor MCP para Cursor |
| `npm run disable-photon` | Desactivar Photon en Jetpack |

---

## Seguridad

- **Nunca** subas `.env` a git (ya está en `.gitignore`)
- `TELEGRAM_ALLOWED_CHAT_IDS` restringe quién puede usar el bot
- El puerto 9000 solo escucha en `127.0.0.1` (localhost)
- Rota las claves si se exponen accidentalmente

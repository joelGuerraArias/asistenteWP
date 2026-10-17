---
name: reporte
description: >-
  Arma y envía el REPORTE Intrant consolidado (medios, X, YouTube, Instagram,
  Facebook, TV/radio → Word ejecutivo + correo). Usar cuando el usuario pida
  /reporte, el reporte de las 7:30/17:00, o fuentes Intrant de redes/Apify.
---

# REPORTE Intrant

## Qué es

Producto **REPORTE**: informe diario de movilidad/transporte Intrant.

## Cuándo corre

| Qué | Horario |
|-----|---------|
| Gmail → Sheet | **07:00** y **16:30** |
| Envío REPORTE (Word + correo a lista Intrant) | **07:30** y **17:00** |
| A demanda | Telegram **`/reporte`** o `npm run report:intrant` |

## Fuentes

- Medios digitales (alertas de prensa) — Gmail alerts → sheet (proceso aparte)
- X (`@INTRANT_RD`)
- **YouTube:** digest Gmail del día (`INTRANT · Tránsito RD | YouTube — DD/MM/YYYY`, salida Apify mailed). Fallback: Apify GET last + ventana hoy+`REPORTE_SOCIAL_DAYS` (default 3). **No** dispara runs; **no** escribe sheet.
- **Instagram:** digest Gmail del día (`Seguimiento Intrant en Instagram - …`). Fallback: Apify GET last + misma ventana. Aislado de alertas/sheet.
- Facebook: búsqueda lean `INTRANT RD` (`scraper_one/facebook-posts-search`)
- TV/radio: `Analisishoy_YYYYMMDD.md` completo (bloques `# 🎞️ Video` / `# 🎧 Audio`, hoy + ayer) — clips **.mp4** y audio **.wav/.mp3**
- En el correo: banner del **término más mencionado** del ciclo + anexo fijo TV/Audio con tono

Código digests (solo reporte): `src/reporte-gmail-digests.mjs`

## Producto de salida

1. **Brief ejecutivo** (DeepSeek) — abre SIEMPRE con cobertura de **Juan Manuel Méndez** (noticia/video), luego el resto
2. **Word (.docx)** — portada (foto Méndez + KPIs) + mismo brief del correo
3. Archivo `.md` del brief en `INFORMES_DIR`

## Instagram / Facebook refresh

Solo con costo Apify explícito:

```bash
npm run report:intrant -- --refresh=instagram
npm run report:intrant -- --refresh=facebook
```

- IG: `INTRANT_IG_START_URLS` en `.env`
- FB: query `INTRANT_FB_QUERY=INTRANT RD` (nunca solo `Intrant` → matches “infant”)

## Sheets

Al insertar alertas Intrant, columna `fecha` = **día del sync** en `dd/mm/yyyy`.

## Comandos

```bash
npm run report:intrant:dry
npm run report:intrant
npm run report:intrant:cron:install
```

Env: `APIFY_TOKEN`, `RAPIDAPI_KEY`, `INFORME_EMAIL_INTRANT` (todos los destinos Intrant), `INTRANT_REPORT_CRON_TIMES=07:30,17:00`.

## Código

- `src/intrant-report.mjs` — orquesta
- `src/intrant-report-sources.mjs` — fuentes
- `src/reporte-gmail-digests.mjs` — digests YT/IG (solo reporte)
- `src/intrant-report-brief.mjs` — prompt + HTML correo
- `src/intrant-report-docx.mjs` — Word ejecutivo
- `scripts/run-intrant-report.mjs` — CLI

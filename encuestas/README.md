# Encuestas — TXT + fotos → WordPress FV + redes FV Digital

Coloca en esta carpeta:

1. Un archivo `.txt` (ej. `encuestas_6_anos_prm_2020_2026.txt`) con bloques:

```
ENCUESTA 1
Nombre: Persona
Cargo actual: Cargo

Pregunta:
Texto de la pregunta…
```

2. Una foto por persona cuyo nombre haga match (ej. `guido.jpg`, `ito bisono.jpg`, `luis abinader.jpg`).  
   También vale `foto: archivo.png` dentro del bloque.

## Horario (cron)

- **09:00** — check: si falta la foto de la próxima encuesta, avisa por Telegram  
- **10:00** — publica **1** encuesta pendiente (la primera del TXT no enviada): WP → webhook `#fvdigital`  
- Estado: `.encuestas-sent.json` (nunca repite)

```powershell
npm run encuestas:cron:install
npm run encuestas:check          # check foto ahora
npm run encuestas -- --daily     # 1 pendiente (como el cron 10:00)
npm run encuestas:dry            # simular todas las pendientes
npm run encuestas -- --limit=1
```

En Telegram: `/encuestas` (1 pendiente).

Titular WP/redes (formato corto):  
`PRM 6 años en el Poder, ¿Cómo lo ha hecho Guido Gómez Mazara en Indotel?`  
La pregunta completa queda en el cuerpo del artículo.

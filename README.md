# DAW DANY TOOL — v1.1 (desde cero)

Proyecto minimalista en **HTML + CSS + JS** que corre 100% local con **WebAudio**. Listo para publicar en **GitHub Pages** sin dependencias.

## Estructura
```
/ (raíz)
├── index.html
├── styles.css
├── app.js
└── LICENSE
```

## Desarrollo local
Solo abre `index.html` en tu navegador. Para **micro** y algunas APIs, usa `https://` o sirve localmente:

```bash
# Opción rápida con Python 3
python -m http.server 8080
# abre: http://localhost:8080
```

## Despliegue en GitHub Pages
1. Crea un repositorio (por ejemplo `daw-dany-tool`).
2. Sube estos cuatro archivos a la rama `main`.
3. En **Settings → Pages**, selecciona **Deploy from a branch** → `main` → `/root`.
4. Espera el build y visita la URL pública (usa **https** para habilitar micrófono).

## Funciones incluidas
- Transporte (Play/Pause/Stop, saltos, Loop con inicio/fin, marcadores, posición).
- BPM + Metrónomo (click sintetizado de 30ms).
- Pistas: Audio (importación local con forma de onda) e Instrumento (sinte demo).
- Grabación de micrófono (MediaRecorder). Última toma se agrega como pista.
- Mezclador: master gain, analizador, Peak y LUFS aprox.
- Exportación a WAV (OfflineAudioContext).
- Guardar/Cargar proyecto (.json) — los audios se re-vinculan por seguridad/tamaño.

## Licencia
MIT — ver `LICENSE`.

---

## Deploy a GitHub Pages (rama danytool + Actions)
Este repo está configurado para desplegarse automáticamente a **GitHub Pages** usando **GitHub Actions** desde la rama `danytool`.

- Workflow: `.github/workflows/pages.yml` (sin build; sube la raíz `.` tal cual).
- Disparadores: `push` a `danytool` y `workflow_dispatch` manual.
- Permisos: `contents: read`, `pages: write`, `id-token: write`.
- Concurrencia: grupo `pages` con cancelación en progreso.
- Jobs: `build` (checkout + upload artifact) y `deploy` (deploy-pages con `environment: github-pages`).

URL esperada (Pages):

```
https://613tdany-dotcom.github.io/DAW-DANY-TOOL/
```

Notas:
- La primera vez, **Settings → Pages** suele mostrar "GitHub Actions" como origen automáticamente. Si el repositorio requiere confirmación manual, habilítalo allí una sola vez.
- Las rutas son relativas, por lo que el sitio funciona bajo `/DAW-DANY-TOOL/`.

## Desarrollo local HTTPS (Windows + Chrome + mkcert)
Para que el micrófono funcione en desarrollo, usa HTTPS local sin dependencias de Node.

1. Sigue la guía: `dev/README-local-https.md` (instalación de mkcert y generación de certificados).
2. Ejecuta el servidor:

```bash
python dev/serve_https.py
```

3. Abre:

```
https://localhost:8443
```

Chrome en Windows utiliza el almacén de certificados del sistema, por lo que tras `mkcert -install` confiará en los certificados generados.

### Saneamiento del remoto Git (quitar token)
Si por accidente configuraste el remoto con un token embebido, cámbialo localmente a HTTPS sin credenciales:

```bash
git remote set-url origin https://github.com/613tdany-dotcom/DAW-DANY-TOOL.git
```

Este ajuste se hace **solo en tu máquina**. No se deben versionar tokens, claves ni ninguna información sensible.

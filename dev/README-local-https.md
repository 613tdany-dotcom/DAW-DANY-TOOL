# Desarrollo local con HTTPS en Windows (Chrome + mkcert)

Este proyecto requiere HTTPS para habilitar permisos de micrófono en el navegador. A continuación tienes un flujo simple para Windows usando Python (sin Node) y certificados locales de confianza con [mkcert](https://github.com/FiloSottile/mkcert).

## 1) Instalar mkcert

- Con Chocolatey (recomendado):

```powershell
choco install mkcert -y
```

- O descarga el ejecutable desde la sección Releases:

- https://github.com/FiloSottile/mkcert/releases

Luego ejecuta una vez la instalación de la CA local:

```powershell
mkcert -install
```

Esto agrega una autoridad certificadora local al almacén del sistema (Windows). Chrome utilizará automáticamente este almacén, por lo que los certificados generados serán de confianza.

## 2) Generar certificados para localhost

Asegúrate de tener la carpeta `dev/certs/` (el repo incluye un `.gitkeep` para mantenerla vacía). Genera los certificados con:

```powershell
mkcert localhost 127.0.0.1 ::1 \
  -cert-file dev/certs/localhost.pem \
  -key-file dev/certs/localhost-key.pem
```

> Nota: Nunca subas estos certificados a git. Ya están ignorados por `.gitignore`.

## 3) Ejecutar el servidor HTTPS local

Desde la raíz del repo:

```powershell
python dev/serve_https.py
```

Abre en tu navegador:

```
https://localhost:8443
```

- El servidor sirve archivos desde la raíz del repositorio y muestra `index.html` por defecto.
- Si es la primera vez, Chrome te pedirá permiso de micrófono. Acepta para poder grabar.

## 4) Problemas comunes

- "Certificados no encontrados": verifica que existen `dev/certs/localhost.pem` y `dev/certs/localhost-key.pem` y que ejecutaste `mkcert -install` antes de generarlos.
- Si usas varias versiones de Python en Windows, también puedes probar:

```powershell
py -3 dev\serve_https.py
```

## 5) Limpieza de seguridad

Si en algún momento compartes el repositorio, recuerda que los certificados locales están ignorados en git (`dev/certs/*`). No incluyas certificados ni claves privadas en commits.

#!/usr/bin/env python3
import http.server
import socketserver
import ssl
import os
import sys
from pathlib import Path

PORT = 8443
REPO_ROOT = Path(__file__).resolve().parents[1]
CERT_FILE = REPO_ROOT / 'dev' / 'certs' / 'localhost.pem'
KEY_FILE = REPO_ROOT / 'dev' / 'certs' / 'localhost-key.pem'

class SimpleMimeHandler(http.server.SimpleHTTPRequestHandler):
    # Serve from repository root
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def guess_type(self, path):
        _, ext = os.path.splitext(path.lower())
        if ext == '.html':
            return 'text/html; charset=utf-8'
        if ext == '.css':
            return 'text/css; charset=utf-8'
        if ext == '.js':
            # Widely compatible for browsers
            return 'text/javascript; charset=utf-8'
        if ext == '.json':
            return 'application/json; charset=utf-8'
        if ext == '.wav':
            return 'audio/wav'
        return 'application/octet-stream'

    # Default to index.html for root paths
    def do_GET(self):
        if self.path in ('/', ''):
            self.path = '/index.html'
        return super().do_GET()


def main():
    if not CERT_FILE.exists() or not KEY_FILE.exists():
        print('\n[!] Certificados no encontrados.')
        print(f'    Esperado: {CERT_FILE}')
        print(f'              {KEY_FILE}')
        print('\nGenera certificados con mkcert (ver dev/README-local-https.md):')
        print('    mkcert localhost 127.0.0.1 ::1 -cert-file dev/certs/localhost.pem -key-file dev/certs/localhost-key.pem')
        sys.exit(1)

    httpd = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), SimpleMimeHandler)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=str(CERT_FILE), keyfile=str(KEY_FILE))
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    print(f"\nSirviendo HTTPS desde: {REPO_ROOT}")
    print(f"URL: https://localhost:{PORT}")
    print("Presiona Ctrl+C para detener\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDeteniendo servidor...")
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()

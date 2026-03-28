#!/usr/bin/env python3
"""Simple HTTP/HTTPS server with no-cache headers for geolocation support.

When behind Cloudflare proxy, run on HTTP (port 80) — Cloudflare handles SSL.
For local/direct access, use HTTPS with cert.pem/key.pem.
"""
import http.server
import ssl
import sys
import os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 80

# Use HTTPS if cert files exist and not running on port 80 (Cloudflare handles SSL)
cert_dir = os.path.dirname(os.path.abspath(__file__))
certfile = os.path.join(cert_dir, 'cert.pem')
keyfile = os.path.join(cert_dir, 'key.pem')

server = http.server.HTTPServer(('', port), NoCacheHandler)

if port != 80 and os.path.exists(certfile) and os.path.exists(keyfile):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile, keyfile)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print(f'Serving HTTPS on port {port} (geolocation will work)')
else:
    print(f'Serving HTTP on port {port}')
    if port == 80:
        print('  → Behind Cloudflare proxy: HTTPS/geolocation handled by Cloudflare')

server.serve_forever()

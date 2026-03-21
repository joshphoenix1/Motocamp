#!/usr/bin/env python3
"""Simple HTTPS server with no-cache headers for geolocation support."""
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

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8085

# Use HTTPS if cert files exist (required for geolocation on mobile)
cert_dir = os.path.dirname(os.path.abspath(__file__))
certfile = os.path.join(cert_dir, 'cert.pem')
keyfile = os.path.join(cert_dir, 'key.pem')

server = http.server.HTTPServer(('', port), NoCacheHandler)

if os.path.exists(certfile) and os.path.exists(keyfile):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile, keyfile)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print(f'Serving HTTPS on port {port} (geolocation will work)')
else:
    print(f'WARNING: No cert.pem/key.pem found — serving HTTP (geolocation will NOT work on mobile)')
    print(f'Generate certs: openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes')

server.serve_forever()

"""Serve the official Google Picker in a loopback-only test window."""
import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path

ADDRESS = '127.0.0.1'
PORT = 43191


class PickerHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, config, **kwargs):
        self.config = config
        super().__init__(*args, **kwargs)

    def do_GET(self):
        if self.headers.get('Host') != f'{ADDRESS}:{PORT}':
            self.send_error(400)
            return
        if self.path == '/picker':
            body = b'<!doctype html><meta charset=utf-8><title>Google Drive</title><p>Google Drive Picker...</p><script src="/picker.js"></script>'
            mime = 'text/html'
        elif self.path == '/picker.js':
            body = Path(__file__).with_name('picker.js').read_bytes()
            mime = 'text/javascript'
        elif self.path == '/config':
            body = json.dumps(self.config).encode()
            mime = 'application/json'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors chrome-extension://kipakimegljfgbjchpljlmiahgnalfdj; base-uri 'none'; script-src 'self' https://apis.google.com; connect-src 'self' https://*.google.com https://*.googleapis.com; style-src 'unsafe-inline'; frame-src https://*.google.com; img-src data: https://*.gstatic.com https://*.google.com")
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    ThreadingHTTPServer((ADDRESS, PORT), partial(PickerHandler, config=config)).serve_forever()

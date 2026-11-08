#!/usr/bin/env python3
"""Finansım yerel sunucusu.

Sadece Python 3 (macOS'ta hazır) gerekir. Çalıştır:  python3 server.py
- Bilgisayardan:  http://localhost:8080
- iPhone'dan (aynı Wi-Fi):  http://<Mac IP adresi>:8080
Verilerin bu sunucuya GİTMEZ; her cihaz kendi tarayıcısında saklar.
"""
import http.server, json, os, socket, socketserver, sys, time, urllib.request

PORT = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8080))
ROOT = os.path.dirname(os.path.abspath(__file__))
RATES_URL = "https://finans.truncgil.com/v4/today.json"
_cache = {"t": 0, "body": None}


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json", ".js": "text/javascript", ".svg": "image/svg+xml"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0].endswith("/api/rates"):
            return self.rates()
        if self.path.endswith((".py", ".command", ".md")):
            return self.send_error(404)
        return super().do_GET()

    def rates(self):
        try:
            if not _cache["body"] or time.time() - _cache["t"] > 300:
                req = urllib.request.Request(RATES_URL, headers={"User-Agent": "finansim-local/1.0"})
                with urllib.request.urlopen(req, timeout=10) as r:
                    _cache["body"], _cache["t"] = r.read(), time.time()
            body, code = _cache["body"], 200
        except Exception as e:  # noqa: BLE001
            body, code = json.dumps({"error": str(e)}).encode(), 502
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        ip = lan_ip()
        print("\n  💰 Finansım çalışıyor\n")
        print(f"  Bu bilgisayarda : http://localhost:{PORT}")
        if ip:
            print(f"  iPhone'da       : http://{ip}:{PORT}   (aynı Wi-Fi'de olmalı)")
        print("\n  Kapatmak için bu pencerede Ctrl+C\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Kapatıldı.")

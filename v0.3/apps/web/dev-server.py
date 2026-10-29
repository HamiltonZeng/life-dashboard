#!/usr/bin/env python3
import http.server
import os
import urllib.request
import urllib.error

WEB_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(WEB_DIR, "../.."))
HOST = os.environ.get("WEB_HOST", "127.0.0.1")
PORT = int(os.environ.get("WEB_PORT", "5173"))
API_TARGET = os.environ.get("API_PROXY_TARGET", "http://127.0.0.1:18080")
APP_ORIGIN = os.environ.get("APP_ORIGIN", "http://localhost:18080")

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirectHandler)


class DashboardHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _proxy(self):
        target_url = API_TARGET.rstrip("/") + self.path
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else None

        headers = {}
        for k, v in self.headers.items():
            lk = k.lower()
            if lk in ("host", "origin", "connection", "content-length"):
                continue
            headers[k] = v
        headers["Origin"] = APP_ORIGIN

        req = urllib.request.Request(
            target_url, data=body, headers=headers, method=self.command
        )
        try:
            with OPENER.open(req, timeout=15) as resp:
                status = resp.status
                resp_headers = resp.headers
                resp_body = resp.read()
        except urllib.error.HTTPError as e:
            status = e.code
            resp_headers = e.headers
            resp_body = e.read()
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            msg = f'{{"error":{{"code":"BAD_GATEWAY","message":"{str(e)}"}}}}'
            self.wfile.write(msg.encode("utf-8"))
            return

        self.send_response(status)
        for k, v in resp_headers.items():
            if k.lower() in ("transfer-encoding", "connection", "content-length"):
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(resp_body)

    def _serve_spa(self):
        pathname = self.path.split("?")[0]
        if pathname.startswith("/api/") or pathname.startswith("/health/"):
            self._proxy()
            return

        file_path = None
        if pathname.startswith("/packages/ui/"):
            candidate = os.path.abspath(os.path.join(REPO_ROOT, pathname.lstrip("/")))
            if candidate.startswith(os.path.join(REPO_ROOT, "packages/ui")):
                file_path = candidate
        elif pathname != "/" and os.path.splitext(pathname)[1]:
            candidate = os.path.abspath(os.path.join(WEB_DIR, pathname.lstrip("/")))
            if candidate.startswith(WEB_DIR):
                file_path = candidate
        else:
            file_path = os.path.join(WEB_DIR, "index.html")

        if not file_path or not os.path.isfile(file_path):
            file_path = os.path.join(WEB_DIR, "index.html")

        ext = os.path.splitext(file_path)[1]
        ctype = MIME_TYPES.get(ext, "application/octet-stream")
        with open(file_path, "rb") as f:
            data = f.read()

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        self._serve_spa()

    def do_HEAD(self):
        self._serve_spa()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_PATCH(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()


if __name__ == "__main__":
    httpd = http.server.ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print(f"Life Dashboard Web server listening on http://{HOST}:{PORT} (API proxy -> {API_TARGET})", flush=True)
    httpd.serve_forever()

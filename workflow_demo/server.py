#!/usr/bin/env python3
"""Shipping Agency AI Automation — Standalone Workflow Demo Server

Serves workflow_demo static assets and proxies /api/v1 calls to the FastAPI backend
(127.0.0.1:8001), injecting the required Origin: http://localhost:3000 header so all
mutations, CSRF, and HttpOnly session cookies work seamlessly from localhost:8080.
"""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8001")
EXPECTED_ORIGIN = os.environ.get("EXPECTED_ORIGIN", "http://localhost:3000")
DIRECTORY = Path(__file__).resolve().parent

FIXTURES = Path(os.environ.get("SHIPPING_DEMO_FIXTURES", DIRECTORY / ".fixtures"))
PRESETS = {
    "scan": {
        "subject": "Synthetic arrival: scanned B/L package count",
        "notes": "Investigate a synthetic 531-package shipment.",
        "files": ("supplier-531.xlsx", "draft-bl-scan-531.pdf"),
    },
    "mismatch": {
        "subject": "Synthetic arrival: conflicting B/L package count",
        "notes": "Compare a packing list reporting 531 packages with a B/L reporting 513.",
        "files": ("supplier-531.xlsx", "draft-bl-513.pdf"),
    },
}


class WorkflowDemoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/demo-presets":
            self.handle_presets_list()
        elif parsed.path == "/api/demo-presets/file":
            self.handle_preset_file(parsed.query)
        elif self.path.startswith("/api/v1/"):
            self.proxy_api()
        else:
            if self.path == "/" or self.path == "":
                self.path = "/index.html"
            super().do_GET()

    def handle_presets_list(self):
        items = []
        for pid, preset in PRESETS.items():
            files = [
                {"name": name, "size": (FIXTURES / name).stat().st_size}
                for name in preset["files"]
                if (FIXTURES / name).is_file()
            ]
            items.append({
                "id": pid,
                "subject": preset["subject"],
                "notes": preset["notes"],
                "files": files,
            })
        body = json.dumps(items).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_preset_file(self, query_string: str):
        qs = urllib.parse.parse_qs(query_string)
        preset_id = qs.get("preset", [""])[0]
        filename = qs.get("filename", [""])[0]
        preset = PRESETS.get(preset_id)
        if not preset or filename not in preset["files"]:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing preset or filename parameter")
            return
        target = FIXTURES / filename
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Preset file not found")
            return
        content = target.read_bytes()
        mime = (
            "application/pdf" if filename.endswith(".pdf")
            else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        encoded_name = urllib.parse.quote(filename)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{encoded_name}")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path.startswith("/api/v1/"):
            self.proxy_api()
        else:
            self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method Not Allowed")

    def do_PUT(self):
        if self.path.startswith("/api/v1/"):
            self.proxy_api()
        else:
            self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method Not Allowed")

    def do_DELETE(self):
        if self.path.startswith("/api/v1/"):
            self.proxy_api()
        else:
            self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method Not Allowed")

    def proxy_api(self):
        if self.command in {"POST", "PUT", "DELETE"}:
            port = self.server.server_port
            origins = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost")}
            if self.headers.get("Origin") not in origins:
                self.send_error(HTTPStatus.FORBIDDEN, "Demo mutations require a local browser origin")
                return
        target_url = urllib.parse.urljoin(BACKEND_URL, self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        req = urllib.request.Request(target_url, data=body, method=self.command)

        # Forward headers with adjustments
        for key, val in self.headers.items():
            k_lower = key.lower()
            if k_lower in ("host", "content-length", "origin"):
                continue
            req.add_header(key, val)

        # Ensure correct Origin header for FastAPI browser_origin guard
        req.add_header("Origin", EXPECTED_ORIGIN)

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                self.send_response(resp.status)
                for header_key, header_val in resp.getheaders():
                    # Handle Set-Cookie to ensure browser accepts cookie from this origin
                    if header_key.lower() == "set-cookie":
                        cleaned = header_val.replace("; Secure", "").replace("; SameSite=Strict", "; SameSite=Lax")
                        self.send_header(header_key, cleaned)
                    else:
                        self.send_header(header_key, header_val)
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as err:
            self.send_response(err.code)
            for header_key, header_val in err.headers.items():
                if header_key.lower() == "set-cookie":
                    cleaned = header_val.replace("; Secure", "").replace("; SameSite=Strict", "; SameSite=Lax")
                    self.send_header(header_key, cleaned)
                else:
                    self.send_header(header_key, header_val)
            self.end_headers()
            self.wfile.write(err.read())
        except (OSError, ValueError):
            self.send_error(HTTPStatus.BAD_GATEWAY, "Backend connection failed")


def main():
    parser = argparse.ArgumentParser(description="Workflow Demo Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    parser.add_argument("--host", choices=["127.0.0.1", "localhost"], default="127.0.0.1")
    args = parser.parse_args()

    server_address = (args.host, args.port)
    httpd = ThreadingHTTPServer(server_address, WorkflowDemoHandler)
    print(f"\n=======================================================")
    print(f" Shipping Agency AI — Guided Workflow Demo Workspace")
    print(f" Serving at: http://{args.host}:{args.port}")
    print(f" Backend API target: {BACKEND_URL}")
    print(f" Injected Origin: {EXPECTED_ORIGIN}")
    print(f"=======================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping demo server...")
        httpd.server_close()


if __name__ == "__main__":
    main()


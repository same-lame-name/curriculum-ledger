#!/usr/bin/env python3
"""Unit tests for browser_fetch.py (double-fetch elimination, timeout budget, file:// and urllib fallback)."""

import http.server
import os
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import browser_fetch


class _FakeResp:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


class BrowserFetchTests(unittest.TestCase):
    def test_no_urllib_fallback_on_http_404_or_500(self):
        for code in (404, 500, 503):
            calls = []

            def fake_get(url, impersonate=None, timeout=None):
                calls.append((url, impersonate, timeout))
                return _FakeResp(code, "err")

            fake_requests = types.SimpleNamespace(get=fake_get)
            fake_pkg = types.SimpleNamespace(requests=fake_requests)
            with mock.patch.dict(sys.modules, {"curl_cffi": fake_pkg, "curl_cffi.requests": fake_requests}), \
                 mock.patch("urllib.request.urlopen") as m_urlopen:
                with self.assertRaises(RuntimeError) as cm:
                    browser_fetch.raw_fetch(f"https://example.com/{code}", timeout=5)
                self.assertIn(f"HTTP {code}", str(cm.exception))
                self.assertEqual(len(calls), 1)
                m_urlopen.assert_not_called()

    def test_no_urllib_fallback_on_timeout_or_network_error(self):
        def fake_timeout(url, impersonate=None, timeout=None):
            raise TimeoutError("timed out")

        fake_requests = types.SimpleNamespace(get=fake_timeout)
        fake_pkg = types.SimpleNamespace(requests=fake_requests)
        with mock.patch.dict(sys.modules, {"curl_cffi": fake_pkg, "curl_cffi.requests": fake_requests}), \
             mock.patch("urllib.request.urlopen") as m_urlopen:
            with self.assertRaises(TimeoutError):
                browser_fetch.raw_fetch("https://example.com/slow", timeout=2)
            m_urlopen.assert_not_called()

    def test_403_retries_with_remaining_budget_and_no_urllib(self):
        seen_timeouts = []

        def fake_get(url, impersonate=None, timeout=None):
            seen_timeouts.append((impersonate, timeout))
            if impersonate == "chrome120":
                return _FakeResp(403, "blocked")
            return _FakeResp(200, "<h1>Allowed</h1>")

        fake_requests = types.SimpleNamespace(get=fake_get)
        fake_pkg = types.SimpleNamespace(requests=fake_requests)
        with mock.patch.dict(sys.modules, {"curl_cffi": fake_pkg, "curl_cffi.requests": fake_requests}), \
             mock.patch("urllib.request.urlopen") as m_urlopen:
            out = browser_fetch.raw_fetch("https://example.com/protected", timeout=5)
            self.assertEqual(out, "<h1>Allowed</h1>")
            self.assertEqual([x[0] for x in seen_timeouts], ["chrome120", "safari15_5"])
            self.assertLessEqual(seen_timeouts[1][1], 5.0)
            m_urlopen.assert_not_called()

    def test_403_skips_retry_when_timeout_budget_exhausted(self):
        calls = []

        def fake_get(url, impersonate=None, timeout=None):
            calls.append(impersonate)
            return _FakeResp(403, "blocked")

        fake_requests = types.SimpleNamespace(get=fake_get)
        fake_pkg = types.SimpleNamespace(requests=fake_requests)
        with mock.patch.dict(sys.modules, {"curl_cffi": fake_pkg, "curl_cffi.requests": fake_requests}), \
             mock.patch.object(browser_fetch.time, "monotonic", side_effect=[100.0, 101.95]), \
             mock.patch("urllib.request.urlopen") as m_urlopen:
            with self.assertRaises(RuntimeError) as cm:
                browser_fetch.raw_fetch("https://example.com/blocked", timeout=2)
            self.assertIn("HTTP 403", str(cm.exception))
            self.assertEqual(calls, ["chrome120"])
            m_urlopen.assert_not_called()

    def test_file_scheme_uses_urllib_without_curl_cffi(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "sample.html"
            p.write_text("<main><h1>Local</h1><p>Hello world</p></main>", encoding="utf-8")
            file_url = p.as_uri()
            with mock.patch.dict(sys.modules, {"curl_cffi": None}):
                out = browser_fetch.fetch_web_page(file_url, fmt="markdown", timeout=5)
                self.assertIn("# Local", out)
                self.assertIn("Hello world", out)

    def test_urllib_fallback_on_import_error_and_truncation(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = b"<main><h1>Title</h1><p>" + (b"x" * 200) + b"</p></main>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            url = f"http://127.0.0.1:{srv.server_address[1]}/"
            with mock.patch.dict(sys.modules, {"curl_cffi": None}):
                md = browser_fetch.fetch_web_page(url, fmt="markdown", max_chars=50, timeout=5)
                self.assertIn("# Title", md)
                self.assertIn("[... truncated to 50 characters ...]", md)
                txt = browser_fetch.fetch_web_page(url, fmt="text", timeout=5)
                self.assertIn("Title", txt)
                self.assertNotIn("# ", txt)
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()

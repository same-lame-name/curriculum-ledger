#!/usr/bin/env python3
"""browser_fetch.py — High-fidelity browser-impersonating web fetcher.

Bypasses anti-bot TLS fingerprinting (JA3/JA4), Cloudflare Turnstile, and
User-Agent blocks across the public web.

Outputs high-density, clean Markdown, plain text, or raw HTML with
navigation, styles, and scripts automatically stripped.

CLI Usage:
    python3 browser_fetch.py "https://example.com"
    python3 browser_fetch.py "https://en.wikipedia.org/wiki/Algorithm" --format text
    python3 browser_fetch.py "https://news.ycombinator.com" --max-chars 10000
"""

import argparse
import html
import os
import re
import sys
import time
from html.parser import HTMLParser

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class SimpleMarkdownParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.output = []
        self.skip_stack = 0
        self.in_pre = False
        self.list_stack = []
        self.link_stack = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        tag = tag.lower()

        # Tags whose entire subtree should be skipped
        if tag in ('script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer', 'aside', 'iframe'):
            self.skip_stack += 1
            return

        if self.skip_stack > 0:
            return

        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            level = int(tag[1])
            self.output.append(f"\n\n{'#' * level} ")
        elif tag == 'p':
            self.output.append("\n\n")
        elif tag == 'br':
            self.output.append("\n")
        elif tag == 'hr':
            self.output.append("\n\n---\n\n")
        elif tag == 'blockquote':
            self.output.append("\n\n> ")
        elif tag == 'pre':
            self.in_pre = True
            data_content = attrs_dict.get('data-content')
            if data_content:
                self.output.append(f"\n```\n{data_content}\n```\n")
                self.skip_stack += 1
            else:
                self.output.append("\n```\n")
        elif tag == 'code' and not self.in_pre:
            self.output.append("`")
        elif tag in ('ul', 'ol'):
            self.list_stack.append(tag)
            self.output.append("\n")
        elif tag == 'li':
            indent = "  " * (len(self.list_stack) - 1)
            prefix = "- " if not self.list_stack or self.list_stack[-1] == 'ul' else "1. "
            self.output.append(f"\n{indent}{prefix}")
        elif tag == 'a':
            href = attrs_dict.get('href', '')
            self.link_stack.append(href)
            self.output.append("[")
        elif tag in ('strong', 'b'):
            self.output.append("**")
        elif tag in ('em', 'i'):
            self.output.append("*")

    def handle_endtag(self, tag):
        tag = tag.lower()

        if tag in ('script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer', 'aside', 'iframe'):
            if self.skip_stack > 0:
                self.skip_stack -= 1
            return

        if self.skip_stack > 0:
            if tag == 'pre':
                self.skip_stack -= 1
                self.in_pre = False
            return

        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.output.append("\n\n")
        elif tag == 'p':
            self.output.append("\n\n")
        elif tag == 'blockquote':
            self.output.append("\n\n")
        elif tag == 'pre':
            self.output.append("\n```\n")
            self.in_pre = False
        elif tag == 'code' and not self.in_pre:
            self.output.append("`")
        elif tag in ('ul', 'ol'):
            if self.list_stack:
                self.list_stack.pop()
            self.output.append("\n")
        elif tag == 'a':
            href = self.link_stack.pop() if self.link_stack else ""
            if href and not href.startswith("javascript:"):
                self.output.append(f"]({href})")
            else:
                self.output.append("]")
        elif tag in ('strong', 'b'):
            self.output.append("**")
        elif tag in ('em', 'i'):
            self.output.append("*")

    def handle_data(self, data):
        if self.skip_stack > 0:
            return
        self.output.append(data)


def raw_fetch(url, timeout=15):
    """Fetches content using browser TLS impersonation (curl_cffi) for HTTP(S), or urllib as fallback."""
    if url.lower().startswith(("http://", "https://")):
        try:
            from curl_cffi import requests as cffi_requests
        except ImportError:
            cffi_requests = None

        if cffi_requests is not None:
            t0 = time.monotonic()
            resp = cffi_requests.get(url, impersonate="chrome120", timeout=timeout)
            if 200 <= resp.status_code < 300:
                return resp.text
            if resp.status_code in (403, 429):
                remaining = timeout - (time.monotonic() - t0)
                if remaining > 0.2:
                    try:
                        resp2 = cffi_requests.get(url, impersonate="safari15_5", timeout=remaining)
                        if 200 <= resp2.status_code < 300:
                            return resp2.text
                    except Exception:
                        pass
            raise RuntimeError(f"HTTP {resp.status_code} while fetching {url}")

    # Fallback when curl_cffi is unavailable, or for non-HTTP schemes (e.g. file://)
    import urllib.request
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def html_to_markdown(html_str):
    """Converts HTML to clean, compact Markdown using generic HTML5 structural semantics."""
    # Prioritize standard semantic main content containers if present (HTML5 / WAI-ARIA / CMS conventions)
    for tag_pattern in (
        r'<main\b[^>]*>',
        r'<article\b[^>]*>',
        r'role=["\']main["\']',
        r'<div\b[^>]*id=["\'](?:content|main-content|pageContent|main)["\'][^>]*>',
    ):
        m = re.search(tag_pattern, html_str, re.IGNORECASE)
        if m:
            html_str = html_str[m.start():]
            break

    parser = SimpleMarkdownParser()
    parser.feed(html_str)
    raw_text = "".join(parser.output)
    raw_text = html.unescape(raw_text)

    # Normalize excessive newlines
    lines = [l.rstrip() for l in raw_text.splitlines()]
    result = []
    consecutive_blank = 0
    for l in lines:
        if not l.strip():
            consecutive_blank += 1
            if consecutive_blank <= 1:
                result.append("")
        else:
            consecutive_blank = 0
            result.append(l)

    return "\n".join(result).strip()


def html_to_plain_text(html_str):
    """Strips tags and returns plain readable text."""
    md = html_to_markdown(html_str)
    text = re.sub(r'#+\s*', '', md)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r'[*_`]', '', text)
    return text.strip()


def fetch_web_page(url, fmt="markdown", max_chars=30000, timeout=15):
    """Fetches a web page and returns content in requested format ('markdown', 'text', 'html')."""
    raw = raw_fetch(url, timeout=timeout)
    if fmt == "html":
        content = raw
    elif fmt == "text":
        content = html_to_plain_text(raw)
    else:
        content = html_to_markdown(raw)

    if max_chars and len(content) > max_chars:
        content = content[:max_chars] + f"\n\n[... truncated to {max_chars} characters ...]"

    return content


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="browser_fetch.py",
        description="Fetch live web pages using browser TLS impersonation (bypasses Cloudflare and anti-bot checks)."
    )
    ap.add_argument("url", help="HTTP or HTTPS URL to fetch")
    ap.add_argument("--format", choices=["markdown", "text", "html"], default="markdown", help="output format (default: markdown)")
    ap.add_argument("--max-chars", type=int, default=30000, help="maximum characters to return (default: 30000)")
    ap.add_argument("--timeout", type=int, default=15, help="timeout in seconds (default: 15)")

    args = ap.parse_args(argv)

    try:
        res = fetch_web_page(args.url, fmt=args.format, max_chars=args.max_chars, timeout=args.timeout)
        print(res)
        return 0
    except Exception as e:
        print(f"Error fetching {args.url}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

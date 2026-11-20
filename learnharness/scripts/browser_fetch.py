#!/usr/bin/env python3
"""browser_fetch.py — Hardened browser-impersonating web fetcher.

Bypasses anti-bot TLS fingerprinting (JA3/JA4) for public http(s) URLs while
enforcing SSRF checks across every DNS resolution and redirect hop.
"""

import argparse
import html
import ipaddress
import json
import re
import socket
import sys
import time
import urllib.parse
from html.parser import HTMLParser
from curl_cffi import CurlOpt, requests as cffi_requests

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

DEFAULT_MAX_BYTES = 5 * 1024 * 1024
DEFAULT_MAX_REDIRECTS = 5

NON_PUBLIC_NETS = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("192.88.99.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("64:ff9b::/96"),
    ipaddress.ip_network("64:ff9b:1::/48"),
    ipaddress.ip_network("100::/64"),
    ipaddress.ip_network("2001:db8::/32"),
    ipaddress.ip_network("2002::/16"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("ff00::/8"),
)


def is_public_ip(ip_str: str) -> bool:
    """True only when the address is a globally routable public IP."""
    cleaned = ip_str.strip().strip("[]").split("%", 1)[0]
    try:
        ip = ipaddress.ip_address(cleaned)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if not ip.is_global:
        return False
    for net in NON_PUBLIC_NETS:
        if ip.version == net.version and ip in net:
            return False
    return True


def _is_ip_literal(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname.strip("[]"))
        return True
    except ValueError:
        return False


def validate_public_url(url: str, ip_allowed=is_public_ip) -> tuple[str, int, list[str]]:
    """Validate scheme and ensure every resolved address is public."""
    parsed = urllib.parse.urlsplit(url)
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("Only http and https URLs are allowed")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError(f"URL has no hostname: {url}")
    port = parsed.port or (443 if scheme == "https" else 80)

    if _is_ip_literal(hostname) and not ip_allowed(hostname):
        raise PermissionError(f"refusing to connect to a private or local address ({hostname})")

    try:
        infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise RuntimeError(f"DNS lookup failed for {hostname}: {exc}") from exc

    ips: list[str] = []
    for info in infos:
        raw_ip = str(info[4][0]).split("%", 1)[0]
        if raw_ip and raw_ip not in ips:
            ips.append(raw_ip)

    if not ips:
        raise RuntimeError(f"DNS lookup returned no addresses for {hostname}")

    for ip in ips:
        if not ip_allowed(ip):
            raise PermissionError(f"refusing to connect to a private or local address ({hostname})")

    return hostname, port, ips


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

        if tag in ("script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "iframe"):
            self.skip_stack += 1
            return

        if self.skip_stack > 0:
            return

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self.output.append(f"\n\n{'#' * level} ")
        elif tag == "p":
            self.output.append("\n\n")
        elif tag == "br":
            self.output.append("\n")
        elif tag == "hr":
            self.output.append("\n\n---\n\n")
        elif tag == "blockquote":
            self.output.append("\n\n> ")
        elif tag == "pre":
            self.in_pre = True
            data_content = attrs_dict.get("data-content")
            if data_content:
                self.output.append(f"\n```\n{data_content}\n```\n")
                self.skip_stack += 1
            else:
                self.output.append("\n```\n")
        elif tag == "code" and not self.in_pre:
            self.output.append("`")
        elif tag in ("ul", "ol"):
            self.list_stack.append(tag)
            self.output.append("\n")
        elif tag == "li":
            indent = "  " * (len(self.list_stack) - 1)
            prefix = "- " if not self.list_stack or self.list_stack[-1] == "ul" else "1. "
            self.output.append(f"\n{indent}{prefix}")
        elif tag == "a":
            href = attrs_dict.get("href", "")
            self.link_stack.append(href)
            self.output.append("[")
        elif tag in ("strong", "b"):
            self.output.append("**")
        elif tag in ("em", "i"):
            self.output.append("*")

    def handle_endtag(self, tag):
        tag = tag.lower()

        if tag in ("script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "iframe"):
            if self.skip_stack > 0:
                self.skip_stack -= 1
            return

        if self.skip_stack > 0:
            if tag == "pre":
                self.skip_stack -= 1
                self.in_pre = False
            return

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.output.append("\n\n")
        elif tag == "p":
            self.output.append("\n\n")
        elif tag == "blockquote":
            self.output.append("\n\n")
        elif tag == "pre":
            self.output.append("\n```\n")
            self.in_pre = False
        elif tag == "code" and not self.in_pre:
            self.output.append("`")
        elif tag in ("ul", "ol"):
            if self.list_stack:
                self.list_stack.pop()
            self.output.append("\n")
        elif tag == "a":
            href = self.link_stack.pop() if self.link_stack else ""
            if href and not href.startswith("javascript:"):
                self.output.append(f"]({href})")
            else:
                self.output.append("]")
        elif tag in ("strong", "b"):
            self.output.append("**")
        elif tag in ("em", "i"):
            self.output.append("*")

    def handle_data(self, data):
        if self.skip_stack > 0:
            return
        self.output.append(data)


def html_to_markdown(html_str: str) -> str:
    """Convert HTML to compact Markdown using semantic main containers when present."""
    for tag_pattern in (
        r"<main\b[^>]*>",
        r"<article\b[^>]*>",
        r'role=["\']main["\']',
        r'<div\b[^>]*id=["\'](?:content|main-content|pageContent|main)["\'][^>]*>',
    ):
        m = re.search(tag_pattern, html_str, re.IGNORECASE)
        if m:
            html_str = html_str[m.start():]
            break

    parser = SimpleMarkdownParser()
    parser.feed(html_str)
    raw_text = html.unescape("".join(parser.output))

    lines = [line.rstrip() for line in raw_text.splitlines()]
    result = []
    consecutive_blank = 0
    for line in lines:
        if not line.strip():
            consecutive_blank += 1
            if consecutive_blank <= 1:
                result.append("")
        else:
            consecutive_blank = 0
            result.append(line)

    return "\n".join(result).strip()


def html_to_plain_text(html_str: str) -> str:
    """Strip HTML tags and return plain readable text."""
    md = html_to_markdown(html_str)
    text = re.sub(r"#+\s*", "", md)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[*_`]", "", text)
    return text.strip()


def fetch_raw(
    url: str,
    timeout: float = 15,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    ip_allowed=is_public_ip,
) -> dict:
    """Fetch a public HTTP(S) URL with hop-by-hop redirect IP validation."""
    current_url = url
    deadline = time.monotonic() + max(0.5, float(timeout))

    for _hop in range(max_redirects + 1):
        hostname, port, ips = validate_public_url(current_url, ip_allowed=ip_allowed)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"Timed out fetching {current_url}")

        curl_options = {}
        if not _is_ip_literal(hostname):
            resolved_ip = f"[{ips[0]}]" if ":" in ips[0] else ips[0]
            curl_options[CurlOpt.RESOLVE] = [f"{hostname}:{port}:{resolved_ip}"]

        with cffi_requests.Session(trust_env=False, curl_options=curl_options) as session:
            resp = session.get(
                current_url,
                impersonate="chrome120",
                timeout=remaining,
                allow_redirects=False,
            )
            if resp.status_code in (403, 429):
                remaining_retry = deadline - time.monotonic()
                if remaining_retry > 0.5:
                    try:
                        resp2 = session.get(
                            current_url,
                            impersonate="safari15_5",
                            timeout=remaining_retry,
                            allow_redirects=False,
                        )
                        if 200 <= resp2.status_code < 400 or resp2.status_code not in (403, 429):
                            resp = resp2
                    except Exception:
                        pass

        if resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("location")
            if location:
                current_url = urllib.parse.urljoin(current_url, location)
                continue

        content_bytes = resp.content
        if len(content_bytes) > max_bytes:
            raise ValueError("Response too large")

        return {
            "status": int(resp.status_code),
            "url": current_url,
            "contentType": resp.headers.get("content-type", "text/html; charset=utf-8"),
            "body": resp.text,
        }

    raise RuntimeError("Too many redirects")


def fetch_web_page(
    url: str,
    fmt: str = "markdown",
    max_chars: int = 30000,
    timeout: float = 15,
    max_bytes: int = DEFAULT_MAX_BYTES,
    ip_allowed=is_public_ip,
) -> dict:
    """Fetch a web page and format its body ('markdown', 'text', 'html')."""
    raw = fetch_raw(url, timeout=timeout, max_bytes=max_bytes, ip_allowed=ip_allowed)
    body = raw["body"]
    if fmt == "html":
        content = body
    elif fmt == "text":
        content = html_to_plain_text(body)
    else:
        content = html_to_markdown(body)

    if max_chars and max_chars > 0 and len(content) > max_chars:
        content = content[:max_chars] + f"\n\n[... truncated to {max_chars} characters ...]"

    return {
        "status": raw["status"],
        "url": raw["url"],
        "contentType": raw["contentType"],
        "body": content,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="browser_fetch.py",
        description="Fetch public HTTP(S) web pages using browser TLS impersonation and strict SSRF validation.",
    )
    ap.add_argument("url", help="HTTP or HTTPS URL to fetch")
    ap.add_argument("--format", choices=["markdown", "text", "html"], default="markdown", help="output format (default: markdown)")
    ap.add_argument("--max-chars", type=int, default=30000, help="maximum characters to return (0 = unlimited, default: 30000)")
    ap.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES, help="maximum response bytes (default: 5242880)")
    ap.add_argument("--timeout", type=float, default=15, help="timeout in seconds (default: 15)")
    ap.add_argument("--json", action="store_true", help="emit JSON metadata + body")

    args = ap.parse_args(argv)

    try:
        res = fetch_web_page(
            args.url,
            fmt=args.format,
            max_chars=args.max_chars,
            timeout=args.timeout,
            max_bytes=args.max_bytes,
        )
        if args.json:
            print(json.dumps(res))
            return 0
        if not (200 <= res["status"] < 300):
            raise RuntimeError(f"HTTP {res['status']} while fetching {res['url']}")
        print(res["body"])
        return 0
    except PermissionError as exc:
        print(f"Error fetching {args.url}: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"Error fetching {args.url}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

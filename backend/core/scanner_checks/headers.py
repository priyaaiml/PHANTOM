"""Passive: security headers & cookie flags (plan.md Part 6.2).

Severity policy (pinned by tests/test_headers_check.py):
  * A missing header is an OBSERVATION of absent defense-in-depth. It is never
    proof that the application is exploitable.
  * medium: Strict-Transport-Security (HTTPS responses only), Content-Security-Policy.
  * low:    X-Frame-Options (skipped when CSP frame-ancestors is set), X-Content-Type-Options.
  * confidence "firm" means "the header really is absent from this response"
    (a direct observation), not "exploitable".
`parameter` is set to the header/cookie name so the scanner's
(finding_type, url, parameter) de-duplication key is unique per header/cookie.
"""
from __future__ import annotations

import re

from core.scanner_engine import BaseScanCheck, register_check
from core.scanner_checks.base import headers_of

RECOMMENDED = {
    "strict-transport-security": ("Strict-transport-security (HSTS)", "CWE-319", "medium",
        "Force HTTPS with Strict-Transport-Security on HTTPS responses."),
    "content-security-policy": ("Content-Security-Policy", "CWE-693", "medium",
        "Add a Content-Security-Policy to mitigate XSS and injection vectors."),
    "x-frame-options": ("X-Frame-Options / frame-ancestors", "CWE-1021", "low",
        "Prevent clickjacking with X-Frame-Options: DENY/SAMEORIGIN (or CSP frame-ancestors)."),
    "x-content-type-options": ("X-Content-Type-Options", "CWE-430", "low",
        "Add X-Content-Type-Options: nosniff to stop MIME-type sniffing."),
}

_COOKIE_SPLIT = re.compile(r",(?=[^;]+?=)")


class SecurityHeadersCheck(BaseScanCheck):
    name = "Missing Security Headers"
    check_type = "headers"
    severity = "low"
    cwe_id = "CWE-693"
    mode = "passive"

    async def check(self, entry: dict) -> list[dict]:
        if not entry.get("status_code"):
            return []
        headers = headers_of(entry)
        present = ", ".join(sorted(headers)) or "(none)"
        has_frame_ancestors = "frame-ancestors" in str(headers.get("content-security-policy", "")).lower()
        findings = []
        for key, (title, cwe, severity, remediation) in RECOMMENDED.items():
            if key == "strict-transport-security" and entry.get("scheme") != "https":
                continue
            if key == "x-frame-options" and has_frame_ancestors:
                continue
            if str(headers.get(key, "")).strip():
                continue  # present with a non-empty value
            findings.append(
                self.finding(
                    title=f"Missing {title}",
                    description=(
                        f"The response does not include the {key} header. This is an observation "
                        "about missing defense-in-depth, not proof that the application is exploitable."
                    ),
                    severity=severity,
                    confidence="firm",
                    cwe_id=cwe,
                    url=entry["url"],
                    parameter=key,
                    evidence=f"header absent: {key}; headers present: {present}",
                    remediation=remediation,
                )
            )
        return findings


class CookieFlagsCheck(BaseScanCheck):
    name = "Insecure Cookie Flags"
    check_type = "cookies"
    severity = "low"
    cwe_id = "CWE-1004"
    mode = "passive"

    async def check(self, entry: dict) -> list[dict]:
        if not entry.get("status_code"):
            return []
        raw_cookies = headers_of(entry).get("set-cookie", "")
        if not raw_cookies:
            return []
        findings = []
        for cookie in _COOKIE_SPLIT.split(raw_cookies):
            parts = [p.strip() for p in cookie.split(";")]
            name = parts[0].split("=", 1)[0].strip()
            attrs = [p for p in parts[1:] if p]
            attr_names = {a.split("=", 1)[0].strip().lower() for a in attrs}
            missing = []
            if "secure" not in attr_names:
                missing.append("Secure")
            if "httponly" not in attr_names:
                missing.append("HttpOnly")
            if "samesite" not in attr_names:
                missing.append("SameSite")
            if not missing or not name or name.lower().startswith(("csrf", "xsrf")):
                continue
            shown = "; ".join([f"{name}=<value redacted>", *attrs])
            findings.append(
                self.finding(
                    title=f"Cookie '{name}' missing {', '.join(missing)}",
                    description=f"Set-Cookie for '{name}' lacks {', '.join(missing)} flag(s).",
                    severity="medium" if "Secure" in missing and entry.get("scheme") == "https" else "low",
                    confidence="firm",
                    cwe_id="CWE-1004",
                    url=entry["url"],
                    parameter=name,
                    evidence=f"Set-Cookie: {shown}"[:300],
                    remediation="Set Secure; HttpOnly; SameSite=Lax (or Strict) on session cookies.",
                )
            )
        return findings


register_check(SecurityHeadersCheck())
register_check(CookieFlagsCheck())

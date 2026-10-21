"""Header & cookie check behavior, including the documented severity policy."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PHANTOM_DATA_DIR", tempfile.mkdtemp(prefix="phantom-test-"))

import core.scanner_engine  # noqa: E402,F401  (registers checks, avoids import cycle)
from core.scanner_checks.headers import CookieFlagsCheck, SecurityHeadersCheck  # noqa: E402

ALL_FOUR = {
    "strict-transport-security", "content-security-policy",
    "x-frame-options", "x-content-type-options",
}


def _entry(headers, scheme="https", status=200, url="https://app.test/"):
    return {"url": url, "scheme": scheme, "status_code": status, "response_headers": json.dumps(headers)}


def _hdr(entry):
    return asyncio.run(SecurityHeadersCheck().check(entry))


def _cookie(entry):
    return asyncio.run(CookieFlagsCheck().check(entry))


def _params(findings):
    return [f["parameter"] for f in findings]


def test_missing_csp_is_reported_with_policy_severity():
    fs = _hdr(_entry({}, scheme="http"))
    csp = [f for f in fs if f["parameter"] == "content-security-policy"]
    assert len(csp) == 1
    assert csp[0]["severity"] == "medium" and csp[0]["confidence"] == "firm"
    assert "not proof" in csp[0]["description"]


def test_present_csp_not_reported():
    fs = _hdr(_entry({"content-security-policy": "default-src 'self'"}))
    assert "content-security-policy" not in _params(fs)


def test_header_name_case_is_ignored():
    fs = _hdr(_entry({
        "Content-Security-Policy": "default-src 'self'", "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff", "Strict-Transport-Security": "max-age=31536000",
    }))
    assert fs == []


def test_hsts_only_on_https():
    assert "strict-transport-security" not in _params(_hdr(_entry({}, scheme="http")))
    assert "strict-transport-security" in _params(_hdr(_entry({}, scheme="https")))


def test_frame_ancestors_satisfies_clickjacking_protection():
    fs = _hdr(_entry({"content-security-policy": "frame-ancestors 'none'"}))
    assert "x-frame-options" not in _params(fs)


def test_empty_header_value_counts_as_missing():
    fs = _hdr(_entry({"x-content-type-options": "  "}))
    assert "x-content-type-options" in _params(fs)


def test_each_missing_header_has_unique_parameter():
    fs = _hdr(_entry({}))
    assert len(fs) == 4
    assert set(_params(fs)) == ALL_FOUR  # unique keys -> engine de-dupe keeps all four


def test_severity_policy_pinned():
    sev = {f["parameter"]: f["severity"] for f in _hdr(_entry({}))}
    assert sev == {
        "strict-transport-security": "medium", "content-security-policy": "medium",
        "x-frame-options": "low", "x-content-type-options": "low",
    }


def test_no_status_code_no_findings():
    assert _hdr(_entry({}, status=None)) == []
    assert _cookie({**_entry({"set-cookie": "a=1"}), "status_code": None}) == []


def test_cookie_missing_all_flags_and_value_redacted():
    fs = _cookie(_entry({"set-cookie": "session=abc123; Path=/"}))
    assert len(fs) == 1 and fs[0]["parameter"] == "session"
    assert fs[0]["severity"] == "medium"  # Secure missing on https
    assert "abc123" not in fs[0]["evidence"]
    assert all(flag in fs[0]["title"] for flag in ("Secure", "HttpOnly", "SameSite"))


def test_cookie_flag_words_inside_value_do_not_count():
    fs = _cookie(_entry({"set-cookie": "id=secure_httponly_samesite; Path=/"}))
    assert len(fs) == 1 and "Secure, HttpOnly, SameSite" in fs[0]["title"]


def test_cookie_with_all_flags_is_clean_and_csrf_cookie_skipped():
    assert _cookie(_entry({"set-cookie": "sid=x; Secure; HttpOnly; SameSite=Lax"})) == []
    assert _cookie(_entry({"set-cookie": "csrftoken=x; Path=/"})) == []


def test_cookie_severity_low_on_http():
    fs = _cookie(_entry({"set-cookie": "s=1; Path=/"}, scheme="http"))
    assert fs[0]["severity"] == "low"

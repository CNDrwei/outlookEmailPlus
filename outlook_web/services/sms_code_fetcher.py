from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import urlparse

import requests

_CONTENT_KEYS = (
    "msg",
    "message",
    "sms",
    "content",
    "text",
    "body",
    "data",
    "result",
)

_CODE_KEYS = (
    "code",
    "smsCode",
    "sms_code",
    "verificationCode",
    "verification_code",
    "otp",
    "pin",
)


def _looks_like_message_text(text: str) -> bool:
    normalized = (text or "").strip()
    if not normalized:
        return False
    if normalized.startswith("{") or normalized.startswith("["):
        return False
    return True


def extract_sms_content_from_payload(payload: Any) -> str:
    """Extract human-readable SMS body from common API payload shapes."""
    if payload is None:
        return ""
    if isinstance(payload, str):
        text = payload.strip()
        if not text:
            return ""
        if _looks_like_message_text(text):
            return text
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return text
        return extract_sms_content_from_payload(parsed)
    if isinstance(payload, list):
        for item in payload:
            content = extract_sms_content_from_payload(item)
            if content:
                return content
        return ""
    if isinstance(payload, dict):
        for key in _CONTENT_KEYS:
            if key not in payload:
                continue
            content = extract_sms_content_from_payload(payload.get(key))
            if content:
                return content
        for value in payload.values():
            if isinstance(value, str) and _looks_like_message_text(value):
                return value.strip()
    return ""


def _extract_code_from_text(text: str, *, code_length: int = 6) -> Optional[str]:
    normalized = (text or "").strip()
    if not normalized:
        return None

    exact_pattern = rf"^\d{{{code_length}}}$"
    if re.fullmatch(exact_pattern, normalized):
        return normalized

    keyword_patterns = (
        rf"(?:code|验证码|verification|verify|pin|otp|动态码|校验码)[:：\s]*(\d{{{code_length}}})",
        rf"(\d{{{code_length}}})(?:\s*(?:is your|为您的|是您的|为您的验证码|为您的校验码))",
    )
    for pattern in keyword_patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if match:
            return match.group(1)

    matches = re.findall(rf"(?<!\d)\d{{{code_length}}}(?!\d)", normalized)
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    return matches[-1]


def extract_sms_code_from_payload(payload: Any, *, code_length: int = 6) -> Optional[str]:
    content = extract_sms_content_from_payload(payload)
    if content:
        code = _extract_code_from_text(content, code_length=code_length)
        if code:
            return code

    if isinstance(payload, str):
        stripped = payload.strip()
        if re.fullmatch(rf"\d{{{code_length}}}", stripped):
            return stripped
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            return _extract_code_from_text(stripped, code_length=code_length)
        return extract_sms_code_from_payload(parsed, code_length=code_length)

    if isinstance(payload, dict):
        for key in _CODE_KEYS:
            if key not in payload:
                continue
            value = payload.get(key)
            if isinstance(value, (int, float)):
                text = str(int(value))
                if re.fullmatch(rf"\d{{{code_length}}}", text):
                    return text
            if isinstance(value, str):
                code = _extract_code_from_text(value, code_length=code_length)
                if code:
                    return code

    return None


def validate_sms_code_url(url: str) -> bool:
    normalized = (url or "").strip()
    if not normalized:
        return False
    try:
        parsed = urlparse(normalized)
    except Exception:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def fetch_sms_code(url: str, *, timeout: int = 15, code_length: int = 6) -> dict[str, Any]:
    normalized_url = (url or "").strip()
    if not validate_sms_code_url(normalized_url):
        return {
            "success": False,
            "error": "短信接口 URL 无效",
            "error_en": "Invalid SMS API URL",
        }

    try:
        response = requests.get(normalized_url, timeout=timeout)
        response.raise_for_status()
    except requests.RequestException as exc:
        return {
            "success": False,
            "error": f"请求短信接口失败: {exc}",
            "error_en": f"Failed to fetch SMS API: {exc}",
        }

    raw_text = (response.text or "").strip()
    content = extract_sms_content_from_payload(raw_text) or raw_text[:2000]
    code = extract_sms_code_from_payload(raw_text, code_length=code_length) or ""
    return {
        "success": True,
        "code": code,
        "content": content,
        "raw": raw_text[:2000],
        "code_extracted": bool(code),
        "formatted": code,
    }

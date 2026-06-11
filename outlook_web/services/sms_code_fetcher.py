from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import urlparse

import requests

_CODE_KEYS = (
    "code",
    "sms",
    "msg",
    "message",
    "verificationCode",
    "verification_code",
    "smsCode",
    "sms_code",
    "content",
    "text",
    "data",
)


def _extract_code_from_text(text: str) -> Optional[str]:
    normalized = (text or "").strip()
    if not normalized:
        return None
    if re.fullmatch(r"\d{4,8}", normalized):
        return normalized
    match = re.search(r"(?<!\d)(\d{4,8})(?!\d)", normalized)
    if match:
        return match.group(1)
    return None


def extract_sms_code_from_payload(payload: Any) -> Optional[str]:
    if payload is None:
        return None
    if isinstance(payload, (int, float)):
        return str(int(payload))
    if isinstance(payload, str):
        direct = _extract_code_from_text(payload)
        if direct:
            return direct
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            return None
        return extract_sms_code_from_payload(parsed)
    if isinstance(payload, list):
        for item in payload:
            extracted = extract_sms_code_from_payload(item)
            if extracted:
                return extracted
        return None
    if isinstance(payload, dict):
        for key in _CODE_KEYS:
            if key not in payload:
                continue
            extracted = extract_sms_code_from_payload(payload.get(key))
            if extracted:
                return extracted
        for value in payload.values():
            extracted = extract_sms_code_from_payload(value)
            if extracted:
                return extracted
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


def fetch_sms_code(url: str, *, timeout: int = 15) -> dict[str, Any]:
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
    code = extract_sms_code_from_payload(raw_text)
    return {
        "success": True,
        "code": code or "",
        "raw": raw_text[:2000],
        "formatted": code or raw_text[:2000],
    }

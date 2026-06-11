import unittest
from unittest import mock

from outlook_web.services.sms_code_fetcher import (
    extract_sms_code_from_payload,
    extract_sms_content_from_payload,
    fetch_sms_code,
    validate_sms_code_url,
)


class SmsCodeFetcherTests(unittest.TestCase):
    def test_extract_code_prefers_six_digits(self):
        self.assertEqual(extract_sms_code_from_payload('{"code":"654321"}'), "654321")
        self.assertEqual(extract_sms_code_from_payload("Your verification code is 778899"), "778899")
        self.assertEqual(extract_sms_code_from_payload("123456"), "123456")

    def test_does_not_extract_from_longer_numbers(self):
        self.assertIsNone(extract_sms_code_from_payload("13439025042"))

    def test_extract_content_from_json_message(self):
        content = extract_sms_content_from_payload('{"msg":"Microsoft access code: 123456"}')
        self.assertEqual(content, "Microsoft access code: 123456")

    def test_fetch_result_keeps_content_when_code_missing(self):
        class FakeResponse:
            text = '{"msg":"waiting for sms"}'
            status_code = 200

            @staticmethod
            def raise_for_status():
                return None

        with mock.patch("outlook_web.services.sms_code_fetcher.requests.get", return_value=FakeResponse()):
            result = fetch_sms_code("http://example.test/api/msg?code=abc")

        self.assertTrue(result["success"])
        self.assertEqual(result["code"], "")
        self.assertEqual(result["content"], "waiting for sms")
        self.assertFalse(result["code_extracted"])

    def test_validate_sms_code_url(self):
        self.assertTrue(validate_sms_code_url("http://example.test/api/msg?code=abc"))
        self.assertFalse(validate_sms_code_url("ftp://example.test/api"))
        self.assertFalse(validate_sms_code_url(""))


if __name__ == "__main__":
    unittest.main()

import unittest

from outlook_web.services.sms_code_fetcher import extract_sms_code_from_payload, validate_sms_code_url


class SmsCodeFetcherTests(unittest.TestCase):
    def test_extract_code_from_json(self):
        self.assertEqual(extract_sms_code_from_payload('{"code":"654321"}'), "654321")
        self.assertEqual(extract_sms_code_from_payload("Your code is 778899"), "778899")

    def test_validate_sms_code_url(self):
        self.assertTrue(validate_sms_code_url("http://example.test/api/msg?code=abc"))
        self.assertFalse(validate_sms_code_url("ftp://example.test/api"))
        self.assertFalse(validate_sms_code_url(""))


if __name__ == "__main__":
    unittest.main()

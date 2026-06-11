import json
import unittest
import uuid
from unittest.mock import patch

from tests._import_app import clear_login_attempts, import_web_app_module


class OutlookSmsImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = import_web_app_module()
        cls.app = cls.module.app

    def setUp(self):
        with self.app.app_context():
            clear_login_attempts()

    def _login(self, client, password: str = "testpass123"):
        resp = client.post("/login", json={"password": password})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get("success"))

    def _default_group_id(self) -> int:
        conn = self.module.create_sqlite_connection()
        try:
            row = conn.execute("SELECT id FROM groups WHERE name = '默认分组' LIMIT 1").fetchone()
            return int(row["id"]) if row else 1
        finally:
            conn.close()

    def test_providers_include_outlook_sms(self):
        client = self.app.test_client()
        self._login(client)
        resp = client.get("/api/providers")
        self.assertEqual(resp.status_code, 200)
        providers = resp.get_json().get("providers") or []
        keys = [item.get("key") for item in providers]
        self.assertIn("outlook_sms", keys)

    def test_import_outlook_sms_json_array(self):
        client = self.app.test_client()
        self._login(client)
        email = f"sms-{uuid.uuid4().hex[:8]}@hotmail.com"
        payload = [
            {
                "recordId": email,
                "email": email,
                "password": "Secret@123",
                "clientId": "client-id-demo",
                "refreshToken": "refresh-token-demo",
                "phoneNumber": "13439025042",
                "smsCodeUrl": "http://example.test/api/msgForeign?code=demo",
            }
        ]
        resp = client.post(
            "/api/accounts",
            json={
                "account_string": json.dumps(payload, ensure_ascii=False),
                "group_id": self._default_group_id(),
                "provider": "outlook_sms",
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("summary", {}).get("imported"), 1)

        list_resp = client.get(f"/api/accounts?group_id={self._default_group_id()}")
        accounts = list_resp.get_json().get("accounts") or []
        matched = next((item for item in accounts if item.get("email") == email), None)
        self.assertIsNotNone(matched)
        self.assertEqual(matched.get("provider"), "outlook_sms")
        self.assertEqual(matched.get("phone_number"), "13439025042")
        self.assertEqual(matched.get("sms_code_url"), "http://example.test/api/msgForeign?code=demo")

    @patch("outlook_web.services.sms_code_fetcher.requests.get")
    def test_fetch_account_sms_code(self, mock_get):
        mock_get.return_value.status_code = 200
        mock_get.return_value.text = '{"code":"123456"}'
        mock_get.return_value.raise_for_status = lambda: None

        client = self.app.test_client()
        self._login(client)
        email = f"sms-fetch-{uuid.uuid4().hex[:8]}@hotmail.com"
        import_resp = client.post(
            "/api/accounts",
            json={
                "account_string": json.dumps(
                    [
                        {
                            "email": email,
                            "password": "Secret@123",
                            "clientId": "client-id-demo",
                            "refreshToken": "refresh-token-demo",
                            "phoneNumber": "13439025042",
                            "smsCodeUrl": "http://example.test/api/msgForeign?code=demo",
                        }
                    ],
                    ensure_ascii=False,
                ),
                "group_id": self._default_group_id(),
                "provider": "outlook_sms",
            },
        )
        self.assertTrue(import_resp.get_json().get("success"))

        list_resp = client.get(f"/api/accounts?group_id={self._default_group_id()}")
        account = next(item for item in list_resp.get_json().get("accounts") or [] if item.get("email") == email)

        fetch_resp = client.post(f"/api/accounts/{account['id']}/fetch-sms-code")
        self.assertEqual(fetch_resp.status_code, 200)
        fetch_data = fetch_resp.get_json()
        self.assertTrue(fetch_data.get("success"))
        self.assertEqual(fetch_data.get("data", {}).get("code"), "123456")


if __name__ == "__main__":
    unittest.main()

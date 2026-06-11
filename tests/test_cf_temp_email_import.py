import unittest
import uuid

from tests._import_app import clear_login_attempts, import_web_app_module


class CfTempEmailImportTests(unittest.TestCase):
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

    def test_import_historical_mailboxes_with_prefix_lines(self):
        client = self.app.test_client()
        self._login(client)
        domain = f"import-{uuid.uuid4().hex[:8]}.test"
        prefixes = [f"user{i}-{uuid.uuid4().hex[:6]}" for i in range(3)]
        resp = client.post(
            "/api/temp-emails/import",
            json={
                "domain": domain,
                "address_string": "\n".join(prefixes),
                "provider_name": "cloudflare_temp_mail",
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("imported"), 3)

        list_resp = client.get("/api/temp-emails")
        emails = {item["email"] for item in list_resp.get_json().get("emails") or []}
        for prefix in prefixes:
            self.assertIn(f"{prefix}@{domain}", emails)

    def test_import_skips_existing_mailbox(self):
        client = self.app.test_client()
        self._login(client)
        domain = f"dup-{uuid.uuid4().hex[:8]}.test"
        prefix = f"dup-{uuid.uuid4().hex[:6]}"
        payload = {
            "domain": domain,
            "address_string": prefix,
            "provider_name": "cloudflare_temp_mail",
        }
        first = client.post("/api/temp-emails/import", json=payload)
        second = client.post("/api/temp-emails/import", json=payload)
        self.assertTrue(first.get_json().get("success"))
        second_data = second.get_json()
        self.assertTrue(second_data.get("success"))
        self.assertEqual(second_data.get("imported"), 0)
        self.assertEqual(second_data.get("skipped"), 1)

    def test_import_requires_domain(self):
        client = self.app.test_client()
        self._login(client)
        resp = client.post(
            "/api/temp-emails/import",
            json={"domain": "", "address_string": "demo1"},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(resp.get_json().get("success"))


if __name__ == "__main__":
    unittest.main()

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

    def test_import_defers_jwt_sync_until_first_read(self):
        client = self.app.test_client()
        self._login(client)
        domain = f"jwt-{uuid.uuid4().hex[:8]}.test"
        prefix = f"hist-{uuid.uuid4().hex[:6]}"
        email_addr = f"{prefix}@{domain}"

        from unittest.mock import patch

        resolve_target = (
            "outlook_web.services.temp_mail_provider_cf.CloudflareTempMailProvider"
            ".resolve_address_credentials_detail"
        )
        with patch(resolve_target) as mock_resolve:
            resp = client.post(
                "/api/temp-emails/import",
                json={
                    "domain": domain,
                    "address_string": email_addr,
                    "provider_name": "cloudflare_temp_mail",
                },
            )
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(resp.get_json().get("success"))
            mock_resolve.assert_not_called()

            with self.app.app_context():
                from outlook_web.repositories import temp_emails as temp_emails_repo

                record = temp_emails_repo.get_temp_email_by_address(email_addr, view="descriptor")
                self.assertIsNotNone(record)
                meta = (record or {}).get("meta") or {}
                self.assertFalse(meta.get("provider_jwt"))

            mock_resolve.return_value = {
                "success": True,
                "credentials": {"jwt": "imported-jwt", "address_id": "addr-import-1"},
            }
            with patch(
                "outlook_web.services.temp_mail_provider_cf.CloudflareTempMailProvider.list_messages",
                return_value=[],
            ):
                msg_resp = client.get(f"/api/temp-emails/{email_addr}/messages")

            self.assertEqual(msg_resp.status_code, 200)
            mock_resolve.assert_called()

        with self.app.app_context():
            from outlook_web.repositories import temp_emails as temp_emails_repo

            record = temp_emails_repo.get_temp_email_by_address(email_addr, view="descriptor")
            meta = (record or {}).get("meta") or {}
            self.assertEqual(meta.get("provider_jwt"), "imported-jwt")
            self.assertEqual(meta.get("provider_mailbox_id"), "addr-import-1")

    def test_import_with_inline_jwt_persists_credentials_immediately(self):
        client = self.app.test_client()
        self._login(client)
        domain = f"inline-{uuid.uuid4().hex[:8]}.test"
        prefix = f"hist-{uuid.uuid4().hex[:6]}"
        email_addr = f"{prefix}@{domain}"

        from unittest.mock import patch

        with patch(
            "outlook_web.services.temp_mail_provider_cf.CloudflareTempMailProvider.resolve_address_credentials_detail",
        ) as mock_resolve:
            resp = client.post(
                "/api/temp-emails/import",
                json={
                    "domain": domain,
                    "address_string": f"{email_addr}----inline-jwt-token",
                    "provider_name": "cloudflare_temp_mail",
                },
            )

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get("success"))
        mock_resolve.assert_not_called()

        with self.app.app_context():
            from outlook_web.repositories import temp_emails as temp_emails_repo

            record = temp_emails_repo.get_temp_email_by_address(email_addr, view="descriptor")
            self.assertIsNotNone(record)
            meta = (record or {}).get("meta") or {}
            self.assertEqual(meta.get("provider_jwt"), "inline-jwt-token")

    def test_list_messages_returns_502_not_500_when_jwt_missing(self):
        client = self.app.test_client()
        self._login(client)
        domain = f"nojwt-{uuid.uuid4().hex[:8]}.test"
        prefix = f"nojwt-{uuid.uuid4().hex[:6]}"
        email_addr = f"{prefix}@{domain}"

        import_resp = client.post(
            "/api/temp-emails/import",
            json={
                "domain": domain,
                "address_string": email_addr,
                "provider_name": "cloudflare_temp_mail",
            },
        )
        self.assertTrue(import_resp.get_json().get("success"))

        from unittest.mock import patch

        with patch(
            "outlook_web.services.temp_mail_provider_cf.CloudflareTempMailProvider.resolve_address_credentials_detail",
            return_value={
                "success": False,
                "error_code": "TEMP_EMAIL_NOT_FOUND",
                "error_message": "CF Worker 上未找到邮箱",
                "data": {"email": email_addr},
            },
        ):
            msg_resp = client.get(f"/api/temp-emails/{email_addr}/messages")

        self.assertEqual(msg_resp.status_code, 502)
        payload = msg_resp.get_json()
        self.assertFalse(payload.get("success"))
        self.assertIn(payload.get("code"), {"TEMP_EMAIL_NOT_FOUND", "TEMP_EMAIL_CREDENTIALS_UNAVAILABLE"})


    def test_batch_delete_temp_emails(self):
        client = self.app.test_client()
        self._login(client)
        domain = f"batchdel-{uuid.uuid4().hex[:8]}.test"
        emails = [f"user{i}-{uuid.uuid4().hex[:4]}@{domain}" for i in range(3)]

        import_resp = client.post(
            "/api/temp-emails/import",
            json={
                "domain": domain,
                "address_string": "\n".join(email.split("@", 1)[0] for email in emails),
                "provider_name": "cloudflare_temp_mail",
            },
        )
        self.assertTrue(import_resp.get_json().get("success"))

        delete_resp = client.post(
            "/api/temp-emails/batch-delete",
            json={"emails": emails},
        )
        self.assertEqual(delete_resp.status_code, 200)
        data = delete_resp.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("deleted_count"), 3)

        with self.app.app_context():
            from outlook_web.repositories import temp_emails as temp_emails_repo

            for email_addr in emails:
                self.assertIsNone(temp_emails_repo.get_temp_email_by_address(email_addr))

    def test_batch_delete_requires_selection(self):
        client = self.app.test_client()
        self._login(client)

        resp = client.post("/api/temp-emails/batch-delete", json={"emails": []})
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(resp.get_json().get("success"))


if __name__ == "__main__":
    unittest.main()

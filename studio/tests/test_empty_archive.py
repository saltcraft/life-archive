"""Cold-start regressions using only fictional text and generated images."""
from contextlib import closing
import json
from pathlib import Path
import tempfile
import unittest

from studio.backend import backup_restore, db, server
from studio.tests.test_backend import invoke
from studio.tests.test_rc2 import form, picture


class EmptyArchiveTests(unittest.TestCase):
    def setUp(self):
        parent = db.local(db.DATA / "test-workspaces")
        parent.mkdir(parents=True, exist_ok=True)
        folder = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name)
        self.app = self.open(self.work / "archive")

    def open(self, root):
        app = server.Application("personal", root)
        app.host = "127.0.0.1:20021"
        return app

    def request(self, path, payload=None, *, app=None, content_type=None, status=200):
        app = app or self.app
        options = {}
        if content_type:
            options["CONTENT_TYPE"] = content_type
        method = "GET" if payload is None else "POST"
        body = payload if isinstance(payload, bytes) else db.encoded(payload)
        code, headers, raw = invoke(app, path, method, body, HTTP_ORIGIN="http://" + app.host,
                                    HTTP_X_LA_SESSION_TOKEN=app.token, **options)
        self.assertEqual(code, status, (path, raw))
        return json.loads(raw) if dict(headers)["Content-Type"].startswith("application/json") else raw

    def import_item(self, action, payload):
        return self.request(action, {"idempotency_key": payload["kind"], "payload": payload})["id"]

    def populate(self):
        original = "　　虚构测试资料。纸船顺着水纹漂远。"
        entry = self.import_item("imports", dict(kind="entry", title_raw="纸船",
                                 entry_date="2025-04-09", paragraphs=[original, "风停在岸边。"]))
        self.assertEqual(entry, "J001")
        details = self.request("entries/" + entry)
        quote = self.import_item("curation", dict(kind="quote", entry_id=entry,
                                 para_id=details["paragraphs"][0]["para_id"],
                                 char_start=9, char_end=len(original), status="user_confirmed"))
        self.assertEqual(quote, "Q001")
        self.assertEqual(self.request("discovery")[0]["quote_text"], original[9:])
        response = self.import_item("curation", dict(kind="response", entry_ids=[entry], title_raw="虚构回信",
                                    blocks=[{"type": "paragraph", "text": "纸船已经经过第二道桥。"}]))
        self.assertEqual(response, "A01")
        raw = picture("PNG")
        content_type, body = form(dict(key="first-photo", mode="single"), [("fiction.png", raw)])
        photo = self.request("photos/import", body, content_type=content_type)["photo_ids"][0]
        self.assertEqual(photo, "P001")
        self.assertEqual(self.request("images/" + photo), raw)
        return entry, response, photo

    def test_cold_start_and_first_identifiers(self):
        self.assertEqual(self.request("entry-count"), 0)
        for endpoint in ("entries", "discovery", "sets", "photos", "orphan-responses"):
            self.assertEqual(self.request(endpoint), [], endpoint)
        session = self.request("session")
        self.assertEqual((session["scope"], session["writable"], session["allow_scope_switch"]),
                         ("personal", True, False))
        self.request("fixture/reset", {"confirm": "reset-fixture"}, status=404)
        entry, _, photo = self.populate()
        item = {"id": entry, "kind": "entry"}
        self.request("trash/move", item)
        self.assertEqual(self.request("entry-count"), 0)
        self.request("trash/restore", {**item, "deleted_at": self.request("trash/list", {})[0]["deleted_at"]})
        self.assertEqual(self.request("entry-count"), 1)
        for item in ({"id": photo, "kind": "photo"}, item):
            self.request("trash/move", item)
            self.request("trash/purge", {**item, "deleted_at": self.request("trash/list", {})[0]["deleted_at"], "confirm": "purge"})
        self.assertEqual(self.request("entries"), [])
        self.assertEqual(self.request("photos"), [])
        self.assertEqual(self.request("trash/list", {}), [])
        self.request("images/" + photo, status=404)
        self.assertEqual(list((self.app.root / "photos_orig").iterdir()), [])

    def test_backup_restore_and_restart(self):
        entry, response, photo = self.populate()
        paths = ["entry-count", "entries", "discovery", "sets", "photos", "orphan-responses",
                 "entries/" + entry, "responses/" + response, "images/" + photo]
        before = {path: self.request(path) for path in paths}
        bundle = backup_restore.export_backup(self.app.root, self.work / "bundle")
        manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual((manifest["scope"], manifest["database"]), ("personal", "personal.sqlite"))
        with self.assertRaises(ValueError):
            backup_restore.restore(bundle, self.work / "invalid", scope="fixture")
        with self.assertRaises(ValueError):
            backup_restore.export_backup(self.app.root, self.app.root / "nested")
        with self.assertRaises(ValueError):
            backup_restore.restore(bundle, self.app.root / "nested")
        restored = backup_restore.restore(bundle, self.work / "restored")
        for _ in range(2):
            reopened = self.open(restored)
            self.assertEqual({path: self.request(path, app=reopened) for path in paths}, before)
        with closing(db.connect(self.app.root)) as source, closing(db.connect(restored)) as copy:
            self.assertEqual(backup_restore.snapshot(source), backup_restore.snapshot(copy))
        backup_restore.verify_restore(bundle, self.work / "rehearsal", scope="personal")
        self.assertEqual(self.request("entry-count"), 1)

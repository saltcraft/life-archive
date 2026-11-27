"""Offline regression suite using only generated fictional material."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from http.client import HTTPConnection
from io import BytesIO
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from xml.etree import ElementTree

from studio.backend import backup_restore as backup, db, fixture_seed, importer, random_pool, server, preferences

PAYLOAD = dict(label=importer.LABEL,kind="entry",title_raw="纸棚尺寸",entry_date="2026-10-02",
               paragraphs=["　　虚构测试资料。小船进了棚。","","　　第二张图尚未剪开。"])


def invoke(app,path,method="GET",body=b"",**overrides):
    env = dict(PATH_INFO=app.prefix+path,HTTP_HOST=app.host,REQUEST_METHOD=method,CONTENT_LENGTH=str(len(body)),
               CONTENT_TYPE="application/json",QUERY_STRING="").copy()
    env["wsgi.input"] = BytesIO(body)
    env.update(overrides)
    result = []
    raw = b"".join(app(env,lambda status,headers:result.extend([int(status.split()[0]),dict(headers)])))
    return result[0],result[1],raw


class FixtureTests(unittest.TestCase):
    def setUp(self):
        parent = db.local(db.DATA/"checks")
        parent.mkdir(parents=True,exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.root = self.work/"live"
        fixture_seed.seed(self.root)

    def test_reading_preferences_upgrade_and_strict_writes(self):
        path = db.prefs_path(self.root)
        legacy = {"font": 3, "resume": False}
        path.write_bytes(db.encoded({"font": 1}))
        self.assertEqual(preferences.read(self.root), {**preferences.DEFAULTS, "font": 1})
        for extra in ({}, {"stage_motion": 2}, {"book_breath": False}, {"stage_motion": 2, "book_breath": False},
                      {"stage_motion": None, "book_breath": "obsolete"}):
            raw = db.encoded({**legacy, **extra})
            path.write_bytes(raw)
            self.assertEqual(preferences.read(self.root), legacy)
            self.assertEqual(path.read_bytes(), raw)
        new = {"font": 1, "resume": True}
        preferences.write(self.root, new)
        self.assertEqual(json.loads(path.read_bytes()), new)
        for invalid in ({"font": 2}, {**new, "stage_motion": 0}, {**new, "book_breath": True},
                        {**new, "font": 4}, {**new, "font": True}, {**new, "resume": 1}, {**new, "extra": 1}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                preferences.write(self.root, invalid)
        self.assertEqual(preferences.read(self.root), new)

    def test_archive_quote_and_replay(self):
        app=server.Application("fixture",self.root)
        app.host="127.0.0.1:19085"
        def send(quote,token):
            payload=dict(payload=dict(kind="archive_quote",quote_id=quote,label=importer.LABEL),idempotency_key=token)
            return invoke(app,"curation","POST",db.encoded(payload),HTTP_ORIGIN="http://"+app.host,HTTP_X_LA_SESSION_TOKEN=app.token)
        for _ in range(2):
            status,_,body=send("F002-Q1","archive-once")
            self.assertEqual((status,json.loads(body)),(200,{"id":"F002-Q1"}))
        for key in ("F002-Q1","missing","F005-Q1"):
            self.assertEqual(send(key,"new-"+key)[0],400)
        for invalid in (None, {}, [], 1):
            self.assertEqual(send(invalid,"invalid-id")[0],400)
        self.assertNotIn("F002-Q1",[q.get("quote_id") for q in json.loads(invoke(app,"discovery")[2])])
        queue=json.loads(invoke(app,"curation")[2])["entries"]
        self.assertEqual(next(e["has_quote"] for e in queue if e["entry_id"]=="F002"),0)
        with closing(db.connect(self.root)) as c:
            c.execute("UPDATE entries SET deleted_at='test' WHERE entry_id='F001'")
        self.assertEqual(send("F001-Q1","hidden")[0],400)

    def test_schema_and_seed(self):
        fixture_seed.seed(self.root)
        with closing(db.connect(self.root)) as c:
            self.assertEqual({r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")},set(db.TABLES))
            self.assertEqual(c.execute("PRAGMA journal_mode").fetchone()[0],"wal")
            self.assertEqual(c.execute("PRAGMA foreign_keys").fetchone()[0],1)
            self.assertFalse(c.execute("PRAGMA foreign_key_check").fetchall())
            snap = backup.snapshot(c)
            self.assertEqual(len(snap["entries"]),8)
            lengths = [sum(len(p["text_raw"].strip()) for p in db.detail(c,e["entry_id"])["paragraphs"]) for e in snap["entries"]]
            self.assertEqual((min(lengths),max(lengths)),(240,1350))
            self.assertEqual([e["entry_id"] for e in snap["entries"] if e["entry_date"]=="2026-09-23"],["F003","F004"])
            self.assertEqual(len({e["title_raw"] for e in snap["entries"]}),8)
            e = db.detail(c,"F002")
            self.assertEqual((e["entry_date"],e["written_time_raw"],e["backfill_note"]),
                             ("2026-07-26","2026-07-27 凌晨写完","2026-07-31 补录一段后来想起的细节"))
            self.assertTrue(any(p["is_blank"] for p in e["paragraphs"]))
            for q in snap["quotes"]:
                t = c.execute("SELECT text_raw FROM paragraphs WHERE para_id=?",(q["para_id"],)).fetchone()[0]
                self.assertEqual(t[q["char_start"]:q["char_end"]],q["quote_text"])
            self.assertIn("F007-P6",[q["para_id"] for q in snap["quotes"]])
            self.assertFalse(any(q["entry_id"]=="F006" for q in snap["quotes"]))
            for entry,status in [("F005","confirmed_none"),("F006","pending_add")]:
                self.assertEqual(db.detail(c,entry)["links"][0]["link_status"],status)
            self.assertEqual([p["photo_id"] for p in db.detail(c,"F001")["photos"]],["FP05"])

    def test_api_relations_and_assets(self):
        app = server.Application("fixture",self.root)
        app.host = "127.0.0.1:31234"
        def get(path):
            s,_,body = invoke(app,path)
            self.assertEqual(s,200)
            return json.loads(body)
        discovery = get("discovery")
        quotes = [row for row in discovery if row["kind"] == "quote"]
        self.assertEqual({q["entry_count"] for q in quotes},{len(get("entries"))})
        self.assertNotIn("F005",{q["entry_id"] for q in quotes})
        for q in quotes:
            entry = get("entries/" + q["entry_id"])
            end = q["char_end"]
            para = next(p for p in entry["paragraphs"] if p["para_id"] == q["para_id"])
            self.assertEqual(para["text_raw"][end-len(q["quote_text"]):end],q["quote_text"])
            self.assertEqual(bool(q["linked"]),any(l["link_status"]=="linked" and l["response_id"] for l in entry["links"]))
        photos = {r["photo_id"]: r for r in discovery if r["kind"]=="photo"}
        self.assertEqual(photos["FP08"]["taken_date_raw"],"2024")
        self.assertIsNone(photos["FP09"]["taken_date_raw"])
        links = get("responses/FR01")
        self.assertEqual([b["type"] for b in links["blocks"]].count("user_followup"),2)
        self.assertTrue(any(b["type"]=="table" and len(b["rows"])==3 for b in links["blocks"]))
        self.assertEqual({l["entry_id"] for l in links["links"]},{"F001","F003"})
        self.assertEqual(get("entries/F004")["links"][0]["response_id"],"FR02")
        self.assertEqual([b["type"] for b in get("responses/FR02")["blocks"]],["paragraph","bullet","rule"])
        self.assertEqual(get("responses/FO01")["links"][0]["link_status"],"orphan_missing_input")
        self.assertEqual(get("responses/FO01")["blocks"][0]["type"],"gap_notice")
        items = get("sets/FS01")["items"]
        self.assertEqual([x["photo_id"] for x in items],[f"FP{i:02}" for i in range(1,7)])
        self.assertEqual(sum(x["has_inner_margin"] for x in items),2)
        for n,(w,h) in enumerate(fixture_seed.SIZES,1):
            key = f"FP{n:02}"
            svg = ElementTree.fromstring(invoke(app,"images/"+key)[2])
            self.assertEqual((int(svg.get("width")),int(svg.get("height"))),(w,h))
            self.assertIn("虚构测试影像","".join(svg.itertext()))
            inner = svg.find("{http://www.w3.org/2000/svg}svg")
            self.assertEqual(int(inner.get("x")),{5:48,6:12}.get(n,0))
        self.assertEqual([get(f"photos/FP0{n}")["date_precision"] for n in (7,8,9)],["exact","year","unknown"])
        self.assertEqual(get("photos/FP08")["taken_date_raw"],"2024")
        self.assertEqual(get("photos/FP07")["links"],[])
        self.assertEqual([p["photo_id"] for p in get("entries/F001")["photos"]],["FP05"])
        self.assertIn("FP03",[p.get("photo_id") for p in get("discovery")])

    def test_deterministic_second_workspace(self):
        second = self.work/"second"
        fixture_seed.seed(second)
        with closing(db.connect(self.root)) as first, closing(db.connect(second)) as other:
            self.assertEqual(backup.snapshot(first),backup.snapshot(other))
        for asset in (self.root/"assets").iterdir():
            self.assertEqual(asset.read_bytes(),(second/"assets"/asset.name).read_bytes())

    def test_sampler_endpoint(self):
        app = server.Application("fixture",self.root)
        app.host = "127.0.0.1:31234"
        for mode in ("equal_entry","mild"):
            s,_,body = invoke(app,"simulate",QUERY_STRING="mode="+mode+"&seed=24")
            self.assertEqual(s,200)
            result = json.loads(body)
            self.assertEqual(sum(result["entries"].values()),1000)
            self.assertEqual(len(result["quotes"]),7)
            self.assertTrue(all(n>0 for n in result["quotes"].values()))
            self.assertEqual(set(result["entries"]),{"F001","F002","F007"})
            print("fixture draws",mode,result["entries"],result["quotes"])

    def test_idempotency_concurrent_and_conflict(self):
        def click(_):
            with closing(db.connect(self.root)) as c:
                return importer.submit(c,"double",PAYLOAD)
        with ThreadPoolExecutor(4) as pool:
            ids = list(pool.map(click,range(4)))
        self.assertEqual(len(set(ids)),1)
        with closing(db.connect(self.root)) as c:
            self.assertEqual(c.execute("SELECT count(*) FROM entries").fetchone()[0],9)
            self.assertEqual(c.execute("SELECT count(*) FROM import_jobs").fetchone()[0],1)
            with self.assertRaises(ValueError):
                importer.submit(c,"double",dict(PAYLOAD,title_raw="另一个标题"))
            self.assertEqual(len(db.detail(c,ids[0])["paragraphs"]),3)
            self.assertEqual(db.search(c,"小船进了棚")[0]["entry_id"],ids[0])

    def test_process_loss_mid_transaction(self):
        code = """import json,os,sys
from pathlib import Path
from studio.backend import db,importer
c=db.connect(Path(sys.argv[1]))
c.create_function('power_loss',0,lambda:os._exit(73))
c.execute('CREATE TEMP TRIGGER cut AFTER INSERT ON paragraphs BEGIN SELECT power_loss(); END')
importer.submit(c,'retry',json.load(sys.stdin))
"""
        proc = subprocess.run([sys.executable,"-B","-X","utf8","-c",code,str(self.root)],input=db.encoded(PAYLOAD),
                              cwd=db.PROJECT,capture_output=True,timeout=15)
        self.assertEqual(proc.returncode,73)
        with closing(db.connect(self.root)) as c:
            self.assertEqual(c.execute("SELECT count(*) FROM entries").fetchone()[0],8)
            self.assertEqual(c.execute("SELECT count(*) FROM import_jobs").fetchone()[0],0)
            key = importer.submit(c,"retry",PAYLOAD)
            self.assertEqual(importer.submit(c,"retry",PAYLOAD),key)
            self.assertEqual(c.execute("SELECT count(*) FROM entries").fetchone()[0],9)
            self.assertEqual(c.execute("SELECT count(*) FROM sources").fetchone()[0],20)
            self.assertFalse(c.execute("PRAGMA foreign_key_check").fetchall())

    def test_curation(self):
        with closing(db.connect(self.root)) as c:
            def send(key,**kw):
                return importer.submit(c,key,dict(label=importer.LABEL,**kw))
            q = send("select",kind="quote",entry_id="F006",para_id="F006-P1",char_start=2,char_end=7,status="ai_candidate")
            self.assertNotIn(q,random_pool.simulate(c,"equal_entry",1)["quotes"])
            send("approve",kind="confirm_quote",quote_id=q)
            self.assertIn(q,random_pool.simulate(c,"equal_entry",1)["quotes"])
            send("append",kind="response",entry_ids=["F006"],title_raw="补记",blocks=[{"type":"paragraph","text":"虚构测试资料"}])
            self.assertEqual([l["link_status"] for l in db.detail(c,"F006")["links"]],["linked"])
            send("collection",kind="photo_set",photo_ids=["FP08","FP07"])
            send("photo",kind="photo_link",confirmed_by_user=True,entry_id="F006",photo_id="FP08",placement="after_paragraph",anchor_para_id="F006-P1")
            self.assertEqual(db.detail(c,"F006")["photos"][0]["photo_id"],"FP08")
            with self.assertRaises(sqlite3.IntegrityError):
                send("bad",kind="photo_link",confirmed_by_user=True,entry_id="F006",photo_id="FP08",placement="after_paragraph",anchor_para_id="F001-P1")
            self.assertFalse(c.execute("SELECT 1 FROM import_jobs WHERE idempotency_key='bad'").fetchone())

    def test_workbench_permissions_and_receipt(self):
        app = server.Application("fixture",self.root)
        app.host = "127.0.0.1:31234"
        good = dict(HTTP_ORIGIN="http://"+app.host,HTTP_X_LA_SESSION_TOKEN=app.token)
        payload = dict(label=importer.LABEL,kind="reminder",entry_id="F008",dismiss_kind="no_quote_ok",dismissed=True)
        body = db.encoded(dict(payload=payload,idempotency_key="reminder"))
        for headers in ({},dict(good,HTTP_ORIGIN="null"),dict(good,HTTP_X_LA_SESSION_TOKEN="wrong")):
            self.assertEqual(invoke(app,"curation","POST",body,**headers)[0],403)
        for _ in range(2):
            self.assertEqual(invoke(app,"curation","POST",body,**good)[0],200)
        queue = json.loads(invoke(app,"curation")[2])
        self.assertEqual(queue["dismissed"],[dict(entry_id="F008",dismiss_kind="no_quote_ok")])
    def test_host_prefix_origin_headers(self):
        app = server.Application("fixture",self.root)
        app.host = "127.0.0.1:31234"
        mode = json.loads(invoke(app,"session")[2])
        self.assertEqual(mode["label"],importer.LABEL)
        body = db.encoded(dict(idempotency_key="network",payload=PAYLOAD))
        token = {"HTTP_X_LA_SESSION_TOKEN":mode["session_token"]}
        for overrides,status in [({"HTTP_HOST":"localhost"},404),({"PATH_INFO":"/session"},404),
                                 ({},403),(token,403),(dict(token,HTTP_ORIGIN="null"),403),
                                 (dict(token,HTTP_REFERER="http://127.0.0.1:32/"),403),
                                 (dict(token,HTTP_ORIGIN="http://"+app.host,HTTP_REFERER="https://outside.invalid"),403),
                                 (dict(token,HTTP_ORIGIN="http://"+app.host),200),
                                 (dict(token,HTTP_REFERER="http://"+app.host+app.prefix),200)]:
            s,h,_ = invoke(app,"imports","POST",body,**overrides)
            self.assertEqual(s,status)
            for k,v in server.HEADERS:
                self.assertEqual(h[k],v)
        for method in ("PATCH","DELETE"):
            self.assertEqual(invoke(app,"imports",method)[0],403)

    def test_bundle_independent_restore(self):
        bundle,dest = self.work/"bundle",self.work/"restored"
        backup.export_backup(self.root,bundle)
        self.root.rename(self.work/"offline")
        backup.restore(bundle,dest)
        self.assertFalse(self.root.exists())
        with closing(db.connect(dest)) as c:
            self.assertEqual(c.execute("PRAGMA journal_mode").fetchone()[0],"wal")
            self.assertEqual(backup.snapshot(c),json.loads((bundle/"snapshot.json").read_bytes()))
            self.assertTrue(db.search(c,"打孔器"))
            self.assertEqual(len(db.detail(c,"F003")["paragraphs"]),5)
            key = importer.submit(c,"restart",PAYLOAD)
        with closing(db.connect(dest)) as c:
            self.assertEqual(importer.submit(c,"restart",PAYLOAD),key)
            self.assertEqual(db.detail(c,key)["title_raw"],PAYLOAD["title_raw"])
            self.assertEqual(c.execute("SELECT count(*) FROM entries").fetchone()[0],9)
        (bundle/"assets/FP03.svg").write_bytes(b"corrupt fixture")
        with self.assertRaisesRegex(ValueError,"fingerprint"):
            backup.restore(bundle,self.work/"bad")
        self.assertFalse((self.work/"bad").exists())

    def test_full_restore_workflow_through_wsgi(self):
        # Exercise the same application requests independently of the HTTP transport.
        @contextmanager
        def application(root):
            app = server.Application("fixture",root)
            app.host = "127.0.0.1:31234"
            def request(url,p=None):
                path,_,query = url.partition("?")
                s,_,body = invoke(app,path,"POST" if p is not None else "GET",db.encoded(p) if p is not None else b"",
                                  QUERY_STRING=query,HTTP_ORIGIN="http://"+app.host,HTTP_X_LA_SESSION_TOKEN=app.token)
                self.assertEqual(s,200)
                return body if path.startswith("images/") else json.loads(body)
            yield request
        bundle,dest = self.work/"bundle",self.work/"restored"
        backup.export_backup(self.root,bundle)
        self.root.rename(self.work/"offline")
        backup.restore(bundle,dest)
        with patch.object(backup,"running",application):
            backup.exercise(dest)
        self.assertFalse(self.root.exists())

    def test_waitress_restore_and_restart(self):
        bundle,dest = self.work/"bundle",self.work/"restored"
        backup.export_backup(self.root,bundle)
        self.root.rename(self.work/"offline")
        backup.verify_restore(bundle,dest)
        self.assertFalse(self.root.exists())

    def test_waitress_host_and_service_restart(self):
        from threading import Thread
        for _ in range(2):
            app = server.Application("fixture",self.root)
            service = server.listener(app)
            thread = Thread(target=service.run,daemon=True)
            thread.start()
            try:
                with closing(HTTPConnection(app.host,timeout=5)) as client:
                    client.request("GET",app.prefix+"session",headers={"Host":"outside.invalid"})
                    self.assertEqual(client.getresponse().status,404)
            finally:
                service.task_dispatcher.shutdown()
                service.close()
                thread.join(8)
                self.assertFalse(thread.is_alive())
            if _ == 0:
                old = (app.prefix,app.token)
            else:
                self.assertNotEqual(old[0],app.prefix)
                self.assertNotEqual(old[1],app.token)

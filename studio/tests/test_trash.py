"""D1 regressions operating exclusively on disposable fictional records and generated pixels."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, nullcontext
import json
from pathlib import Path
import os
import sqlite3
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from studio.backend import archive_trash as trash, backup_restore as backup, db, fixture_seed, importer, photo_import, server
from studio.tests.test_backend import invoke, PAYLOAD
from studio.tests.test_rc2 import picture


class TrashTests(unittest.TestCase):
    def setUp(self):
        area=db.local(db.DATA/"checks")
        area.mkdir(exist_ok=True,parents=True)
        self.temp=tempfile.TemporaryDirectory(dir=area)
        self.addCleanup(self.temp.cleanup)
        self.work=Path(self.temp.name)
        self.root=self.work/"fixture"
        self.app=server.Application("fixture",self.root)
        self.app.host="127.0.0.1:19181"

    def act(self,action,kind,key,stamp=None):
        p={"kind":kind,"id":key}
        if stamp is not None:p["deleted_at"]=stamp
        if action=="purge":p["confirm"]="purge"
        with closing(db.connect(self.root)) as c:
            return trash.change(c,self.root,action,p)

    def get(self,path,**args):
        with closing(db.connect(self.root)) as c:
            return server.fixture_get(c,path,{k:[v] for k,v in args.items()},self.root)

    def upload(self,key,raw=None,root=None):
        root=root or self.root
        raw=picture("PNG") if raw is None else raw
        with closing(db.connect(root)) as c:
            return photo_import.save(c,root,{"key":key,"mode":"single"},[("local.png",raw)])["photo_ids"][0]

    def batch(self,action,payload,status=200):
        response,_,body=invoke(self.app,"trash/"+action,"POST",db.encoded(payload),
                               HTTP_ORIGIN="http://"+self.app.host,HTTP_X_LA_SESSION_TOKEN=self.app.token)
        self.assertEqual(response,status)
        return json.loads(body)

    def test_batch_atomic_validation_and_restore(self):
        photo={"id":"FP01","kind":"photo"}
        for items in ([],[photo,photo],[photo,{"id":"absent","kind":"entry"}],[photo,{"id":"FP02","kind":"bad"}]):
            self.batch("move-batch",{"items":items},400)
            self.assertEqual(len(self.get("photos")),9)
        self.batch("move-batch",{"items":[photo,{"kind":"photo_set","id":"FS01"}]})
        with closing(db.connect(self.root)) as c:
            c.execute("INSERT INTO photo_purges SELECT photo_id,deleted_at FROM photos WHERE photo_id='FP01'")
        self.batch("restore-all",{},400)
        self.assertEqual(self.batch("restore-all",{"confirm":"restore-all"}),{"restored":1,"skipped":1})
        self.assertEqual(len(self.get("sets")),1)
        self.assertEqual(len(self.get("photos")),8)

    def test_bulk_purge_shared_copy_receipts_and_original(self):
        raw=picture("PNG");original=self.work/"external.png";original.write_bytes(raw)
        ids=[self.upload(k,raw) for k in ("a","b","c")]
        copy=self.root/"photos_orig"/(db.digest(raw)+".png")
        self.batch("move-batch",{"items":[{"kind":"photo","id":i} for i in ids[:2]]})
        self.batch("purge-all",{"confirm":"purge-all"})
        self.assertEqual(copy.read_bytes(),raw)
        self.batch("move-batch",{"items":[{"kind":"photo","id":ids[2]},{"kind":"entry","id":"F003"},{"kind":"photo_set","id":"FS01"}]})
        self.batch("purge-all",{"confirm":"no"},400)
        self.assertEqual(self.batch("purge-all",{"confirm":"purge-all"}),{"purged":3})
        self.assertFalse(copy.exists());self.assertEqual(original.read_bytes(),raw)
        with self.assertRaises(ValueError):self.upload("a",raw)
        self.assertNotIn(self.upload("new"),ids)

    def test_batch_protects_historical_paragraphs(self):
        with closing(db.connect(self.root)) as c:
            c.execute("UPDATE sources SET kind='diary_docx' WHERE source_id=(SELECT source_id FROM entries WHERE entry_id='F001')")
            original=db.detail(c,"F001")["paragraphs"]
        self.batch("move-batch",{"items":[{"kind":"entry","id":"F001"},{"kind":"photo","id":"FP01"}]})
        self.batch("purge-all",{"confirm":"purge-all"},400)
        self.assertEqual(self.batch("restore-all",{"confirm":"restore-all"})["restored"],2)
        self.assertEqual(self.get("entries/F001")["paragraphs"],original)

    def test_move_filters_every_read_and_preserves_independent_records(self):
        stamp=self.act("move","entry","F001")["deleted_at"]
        self.assertEqual(self.act("move","entry","F001")["deleted_at"],stamp)
        for route in ("entries","catalog","discovery","search"):
            self.assertNotIn("F001",[r.get("entry_id") for r in self.get(route,q="纸")])
        for field in ("entries","dismissed","candidates"):
            self.assertNotIn("F001",[r["entry_id"] for r in self.get("curation")[field]])
        self.assertNotIn("F001",self.get("simulate")["entries"])
        self.assertEqual(self.get("photos/FP05")["links"],[])
        self.assertEqual([l["entry_id"] for l in self.get("responses/FR01")["links"]],["F003"])
        with self.assertRaises(KeyError):self.get("entries/F001")
        with closing(db.connect(self.root)) as c:
            with self.assertRaises(ValueError):importer.submit(c,"stale",dict(label=importer.LABEL,kind="reminder",entry_id="F001",dismiss_kind="no_quote_ok",dismissed=True))
        self.act("restore","entry","F001",stamp)
        ph=self.act("move","photo","FP05")["deleted_at"]
        group=self.act("move","photo_set","FS01")["deleted_at"]
        for route in ("sets/FS01","images/FP05","photos/FP05"):
            with self.assertRaises(KeyError):self.get(route)
        self.assertEqual(self.get("albums"),[])
        self.assertFalse(self.get("entries/F001")["photos"])
        self.assertNotIn("FP05",[r["photo_id"] for r in self.get("photos")])
        photos=[i for i in self.get("discovery") if i["kind"]=="photo"]
        self.assertTrue(any(i["photo_id"]=="FP03" and i["set_id"] is None for i in photos))
        self.act("restore","photo_set","FS01",group)
        self.assertNotIn("FP05",[p["photo_id"] for p in self.get("sets/FS01")["items"]])
        self.act("restore","photo","FP05",ph)
        self.assertEqual([p["photo_id"] for p in self.get("sets/FS01")["items"]],[f"FP{i:02}" for i in range(1,7)])
        self.assertEqual(self.get("entries/F001")["photos"][0]["photo_id"],"FP05")

    def test_purge_relations_numbers_seed_and_stale_confirmation(self):
        with closing(db.connect(self.root)) as c:
            solo=importer.submit(c,"solo-reply",dict(kind="response",label=importer.LABEL,entry_ids=["F001"],
                 title_raw="虚构的独立回应",blocks=[{"type":"paragraph","text":"虚构测试资料。"}]))
        old=self.act("move","entry","F001")["deleted_at"]
        with self.assertRaises(KeyError):self.get("responses/"+solo)
        self.act("restore","entry","F001",old)
        new=self.act("move","entry","F001")["deleted_at"]
        with self.assertRaises(ValueError):self.act("purge","entry","F001",old)
        with closing(db.connect(self.root)) as c:
            with self.assertRaises(ValueError):trash.change(c,self.root,"purge",{"kind":"entry","id":"F001","deleted_at":new})
        self.act("purge","entry","F001",new)
        self.assertEqual(self.get("responses/"+solo)["links"],[])
        self.assertIn((solo,"当前未关联篇目"),[(r["response_id"],r["note"]) for r in self.get("orphan-responses")])
        for kind,key in [("entry","F008"),("photo","FP09"),("photo_set","FS01")]:
            stamp=self.act("move",kind,key)["deleted_at"];self.act("purge",kind,key,stamp)
        fixture_seed.seed(self.root)
        self.assertTrue((self.root/"assets/FP09.svg").is_file())
        self.assertEqual(len(self.get("entries")),6)
        self.assertEqual(len(self.get("photos")),8)
        self.assertEqual(self.get("sets"),[])
        self.assertEqual(self.get("responses/FR01")["links"][0]["entry_id"],"F003")
        with closing(db.connect(self.root)) as c:
            for t in ["paragraphs","quotes","entry_ai_links","entry_photo_links","curation_dismissals"]:
                self.assertEqual(c.execute(f"SELECT count(*) FROM {t} WHERE entry_id='F001'").fetchone()[0],0)
            self.assertFalse(c.execute("PRAGMA foreign_key_check").fetchall())
            self.assertEqual(importer.submit(c,"new-entry",PAYLOAD),"F009")
        self.assertEqual(self.upload("next-photo"),"FP10")

    def test_shared_copy_only_unlinked_after_last_reference(self):
        raw=picture("PNG");original=self.work/"user-selection.png";original.write_bytes(raw)
        one=self.upload("one",raw);two=self.upload("two",raw)
        copy=self.root/"photos_orig"/(db.digest(raw)+".png")
        for key in (one,two):
            stamp=self.act("move","photo",key)["deleted_at"]
            self.assertEqual(copy.read_bytes(),raw)
            self.act("purge","photo",key,stamp)
            self.assertEqual(copy.is_file(),key==one)
        self.assertEqual(original.read_bytes(),raw)

    def test_copy_path_hash_and_static_resource_boundaries(self):
        key=self.upload("boundary")
        stamp=self.act("move","photo",key)["deleted_at"]
        with closing(db.connect(self.root)) as c:
            real=c.execute("SELECT rel_path FROM sources WHERE source_id=?",(key+"-src",)).fetchone()[0]
            sentinel=self.work/"original.png";sentinel.write_bytes(picture("PNG"))
            for invalid in ("../original.png",str(sentinel),"assets/FP01.svg","photos_orig/../original.png"):
                c.execute("UPDATE sources SET rel_path=? WHERE source_id=?",(invalid,key+"-src"))
                with self.assertRaises(ValueError):self.act("purge","photo",key,stamp)
                self.assertEqual(sentinel.read_bytes(),picture("PNG"))
            c.execute("UPDATE sources SET rel_path=? WHERE source_id=?",(real,key+"-src"))
            local=self.root/real
            local.chmod(stat.S_IREAD|stat.S_IWRITE);local.write_bytes(b"changed")
            with self.assertRaises(ValueError):self.act("purge","photo",key,stamp)
            self.assertEqual(local.read_bytes(),b"changed")
            self.assertFalse(c.execute("SELECT * FROM photo_purges").fetchone())
        self.act("restore","photo",key,stamp)

    def test_durable_purge_resumes_after_unlink_and_interruption(self):
        raw=picture("PNG");key=self.upload("interrupt",raw);copy=self.root/"photos_orig"/(db.digest(raw)+".png")
        stamp=self.act("move","photo",key)["deleted_at"]
        unlink=Path.unlink
        def interrupted(path,*args,**kw):
            unlink(path,*args,**kw)
            if path==copy:raise OSError("simulated interrupted commit")
        with patch.object(Path,"unlink",interrupted), self.assertRaises(OSError):self.act("purge","photo",key,stamp)
        with closing(db.connect(self.root)) as c:
            self.assertEqual(trash.contents(c)[0]["purging"],1)
        with self.assertRaises(ValueError):self.act("restore","photo",key,stamp)
        server.Application("fixture",self.root)
        with closing(db.connect(self.root)) as c:
            self.assertEqual(trash.contents(c),[]);self.assertFalse(c.execute("PRAGMA foreign_key_check").fetchall())
        self.assertFalse(copy.exists())

    def test_transaction_contends_with_import_of_same_bytes(self):
        raw=picture("PNG");key=self.upload("initial",raw);stamp=self.act("move","photo",key)["deleted_at"]
        with ThreadPoolExecutor(2) as pool:
            delete=pool.submit(self.act,"purge","photo",key,stamp)
            new=pool.submit(self.upload,"replacement",raw)
            delete.result();replacement=new.result()
        self.assertEqual(self.get("images/"+replacement),("image/png",raw))

    def test_scope_origin_token_and_confirmation_required(self):
        for route in ("trash/list","trash/move","trash/restore","trash/purge","trash/move-batch","trash/restore-all","trash/purge-all"):
            body=db.encoded({} if route.endswith("list") else {"kind":"entry","id":"F001"})
            good={"HTTP_ORIGIN":"http://"+self.app.host,"HTTP_X_LA_SESSION_TOKEN":self.app.token}
            for bad in ({'HTTP_ORIGIN':'http://other.invalid'},{'HTTP_ORIGIN':''},{'HTTP_X_LA_SESSION_TOKEN':'invalid'}):
                self.assertEqual(invoke(self.app,route,"POST",body,**(good|bad))[0],403)
            self.assertEqual(invoke(self.app,route)[0],404)
        self.assertEqual(len(self.get("entries")),8)

    @staticmethod
    def downgrade(path):
        with closing(sqlite3.connect(path)) as c:
            c.executescript("DROP TABLE photo_purges; DROP TABLE entity_sequences;")
            for table in ("entries","photos","photo_sets"):c.execute(f"ALTER TABLE {table} DROP COLUMN deleted_at")
            c.execute("PRAGMA user_version=1");c.commit()

    def test_v1_migrates_concurrently_without_loss_and_old_bundle_restores(self):
        with closing(db.connect(self.root)) as c:legacy=importer.submit(c,"prior",PAYLOAD)
        bundle=backup.export_backup(self.root,self.work/"old-bundle")
        self.downgrade(bundle/"fixture.sqlite")
        with closing(backup.readonly(bundle/"fixture.sqlite")) as image:
            image.row_factory=sqlite3.Row;old=backup.snapshot(image)
        backup.json_file(bundle/"snapshot.json",old)
        manifest=json.loads((bundle/"manifest.json").read_bytes());manifest["schema_version"]=1
        for name in ("snapshot.json","fixture.sqlite"):manifest["files"][name]=db.digest((bundle/name).read_bytes())
        backup.json_file(bundle/"manifest.json",manifest)
        self.downgrade(self.root/"fixture.sqlite")
        def start(_):
            with closing(db.connect(self.root)) as c:return c.execute("PRAGMA user_version").fetchone()[0]
        with ThreadPoolExecutor(4) as pool:self.assertEqual(list(pool.map(start,range(8))),[db.VERSION]*8)
        restored=backup.restore(bundle,self.work/"old-restored")
        for root in (self.root,restored):
            with closing(db.connect(root)) as c:
                self.assertEqual(db.detail(c,legacy)["title_raw"],PAYLOAD["title_raw"])
                new=backup.snapshot(c)
                for table,records in old.items():
                    self.assertEqual([{k:v for k,v in row.items() if k!="deleted_at"} for row in new[table]],records)
                self.assertEqual(trash.contents(c),[])
        self.assertEqual(db.digest((bundle/"fixture.sqlite").read_bytes()),manifest["files"]["fixture.sqlite"])

    def test_backup_round_trips_bin_media_and_absent_seed(self):
        photo=self.upload("backup")
        stamp=self.act("move","photo",photo)["deleted_at"]
        gone=self.act("move","entry","F003")["deleted_at"];self.act("purge","entry","F003",gone)
        self.act("move","photo_set","FS01")
        bundle=backup.export_backup(self.root,self.work/"backup");dest=self.work/"restored"
        backup.verify_restore(bundle,dest)
        with closing(db.connect(dest)) as c:
            present=trash.contents(c)
            self.assertEqual({r["id"] for r in present},{photo,"FS01"})
            trash.change(c,dest,"restore",{"kind":"photo","id":photo,"deleted_at":stamp})
            self.assertEqual(server.fixture_get(c,"images/"+photo,{},dest)[0],"image/png")
            self.assertFalse(c.execute("SELECT 1 FROM entries WHERE entry_id='F003'").fetchone())
    def test_old_receipts_cannot_recreate_purged_ids_or_groups(self):
        with closing(db.connect(self.root)) as c:
            entry=importer.submit(c,"entry-once",PAYLOAD)
            batch={"mode":"new","key":"group-once"}
            files=[("a.png",picture("PNG")),("b.png",picture("PNG",(21,32)))]
            group=photo_import.save(c,self.root,batch,files)
            for kind,key in [("entry",entry),("photo",group["photo_ids"][0])]:
                when=self.act("move",kind,key)["deleted_at"];self.act("purge",kind,key,when)
                self.assertEqual(self.act("purge",kind,key,when),{"id":key})
            with self.assertRaises(ValueError):importer.submit(c,"entry-once",PAYLOAD)
            with self.assertRaises(ValueError):photo_import.save(c,self.root,batch,files)
            for idempotency in ("entry-once","group-once"):
                self.assertEqual(tuple(c.execute("SELECT status,result_entity_id FROM import_jobs WHERE idempotency_key=?",(idempotency,)).fetchone()),("failed",None))
            members=self.get("sets/"+group["set_id"])["items"]
            self.assertEqual([m["photo_id"] for m in members],group["photo_ids"][1:])

    def test_live_directory_layout_uses_only_its_own_originals(self):
        data=self.work/"disposable-studio-data";live=data/"fixture";other=data/"other"
        raw=picture("PNG");filename=db.digest(raw)+".png"
        with patch.object(db,"DATA",data),patch.object(db,"LIVE",live):
            fixture_seed.seed(live);fixture_seed.seed(other)
            key=self.upload("live-copy",raw,live);self.upload("other-copy",raw,other)
            self.assertFalse((live/"photos_orig"/filename).exists())
            with closing(db.connect(live)) as c:
                when=trash.change(c,live,"move",dict(kind="photo",id=key))["deleted_at"]
                trash.change(c,live,"purge",dict(kind="photo",id=key,deleted_at=when,confirm="purge"))
            self.assertFalse((data/"photos_orig"/filename).exists())
            self.assertEqual((other/"photos_orig"/filename).read_bytes(),raw)

    def test_refuses_multiply_linked_copy_without_touching_either_name(self):
        raw = picture("PNG")
        photo = self.upload("hard-link", raw)
        copy = self.root / "photos_orig" / (db.digest(raw) + ".png")
        alias = self.work / "independent-filename.png"
        mode = stat.S_IMODE(copy.stat().st_mode)
        metadata = nullcontext()
        copy.chmod(mode | stat.S_IWRITE)
        try:
            os.link(copy, alias)
        except PermissionError as error:
            if getattr(error, "winerror", None) != 5:
                raise
            # Restricted Windows runners can deny link creation even for writable fixtures.
            # Supply only the link count. The purge still uses real files and a real database.
            alias.write_bytes(raw)
            original_lstat = Path.lstat

            def lstat_with_two_links(path):
                info = original_lstat(path)
                if path != copy:
                    return info
                return SimpleNamespace(st_mode=info.st_mode, st_nlink=2,
                                       st_file_attributes=getattr(info, "st_file_attributes", 0))

            metadata = patch.object(Path, "lstat", lstat_with_two_links)
            print("hard-link fixture: Windows denied link creation; supplied st_nlink=2 for the import copy")
        else:
            self.assertTrue(copy.samefile(alias))
        finally:
            copy.chmod(mode)

        stamp = self.act("move", "photo", photo)["deleted_at"]
        with metadata:
            self.assertEqual(copy.lstat().st_nlink, 2)
            with self.assertRaisesRegex(ValueError, "^linked storage$"):
                self.act("purge", "photo", photo, stamp)
        self.assertEqual(copy.read_bytes(), raw)
        self.assertEqual(alias.read_bytes(), raw)
        self.assertEqual(stat.S_IMODE(copy.stat().st_mode), mode)
        with closing(db.connect(self.root)) as c:
            self.assertEqual([(r["id"], r["purging"]) for r in trash.contents(c)], [(photo, 0)])

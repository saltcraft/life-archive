"""Release regressions. Every image and text is generated 虚构测试资料."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from io import BytesIO
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from studio.backend import backup_restore, db, fixture_seed, importer, photo_import, server
from studio.tests.test_backend import invoke, PAYLOAD


def picture(fmt, size=(31,17)):
    out = BytesIO()
    Image.new("RGB",size,(67,101,74)).save(out,fmt)
    return out.getvalue()


def form(meta, files):
    boundary=b"LA-Fictional-Form"
    parts=[b'Content-Disposition: form-data; name="metadata"\r\n\r\n'+db.encoded(meta)]
    for name,img in files:
        parts.append(b'Content-Disposition: form-data; name="files"; filename="'+name.encode()+b'"\r\nContent-Type: application/octet-stream\r\n\r\n'+img)
    body=b"".join(b"--"+boundary+b"\r\n"+part+b"\r\n" for part in parts)+b"--"+boundary+b"--\r\n"
    return "multipart/form-data; boundary=LA-Fictional-Form", body


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        folder=db.local(db.DATA/"checks")
        folder.mkdir(exist_ok=True,parents=True)
        temp=tempfile.TemporaryDirectory(dir=folder)
        self.addCleanup(temp.cleanup)
        self.work=Path(temp.name); self.root=self.work/"fixture"
        self.app=server.Application("fixture",self.root)
        self.app.host="127.0.0.1:19844"
    def post(self, path, body, app=None, **headers):
        app=app or self.app
        env={"HTTP_ORIGIN":"http://"+app.host,"HTTP_X_LA_SESSION_TOKEN":app.token}
        return invoke(app,path,"POST",body,**(env|headers))

    def upload(self, meta, files, app=None, **headers):
        typ,body=form(meta,files)
        return self.post("photos/import",body,app,CONTENT_TYPE=typ,**headers)

    def test_sequences_concurrency_legacy_rollback_replay(self):
        def submit(n):
            with closing(db.connect(self.root)) as c:
                return importer.submit(c,str(n),PAYLOAD)
        with closing(db.connect(self.root)) as c:
            with db.transaction(c):
                importer.add_entry(c,PAYLOAD,"F-"+"d"*32,db.now())
            with self.assertRaises(ValueError):
                importer.submit(c,"bad",{**PAYLOAD,"entry_date":"invalid"})
        with ThreadPoolExecutor(max_workers=6) as pool:
            keys=list(pool.map(submit,range(12)))
        self.assertEqual(set(keys),{f"F{i:03}" for i in range(9,21)})
        self.assertEqual(submit(0),keys[0])
        with closing(db.connect(self.root)) as c:
            self.assertTrue(c.execute("SELECT 1 FROM entries WHERE entry_id=?",("F-"+"d"*32,)).fetchone())
            self.assertEqual(importer.submit(c,"q",dict(kind="quote",label=importer.LABEL,entry_id="F001",para_id="F001-P1",
                           char_start=2,char_end=4,status="user_confirmed")),"FQ009")
            self.assertEqual(importer.submit(c,"a",dict(kind="response",label=importer.LABEL,entry_ids=["F001"],
                           title_raw="虚构回应",blocks=[{"type":"paragraph","text":"虚构测试资料"}])),"FR03")

    def test_images_immutable_identity_mime_dimensions_and_groups(self):
        imgs=[("fiction.jpg",picture("JPEG")),("fiction.png",picture("PNG",(17,33)))]
        original=self.work/"fiction.jpg";original.write_bytes(imgs[0][1])
        before=(original.stat().st_mtime_ns,original.read_bytes())
        meta=dict(key="pair",mode="new",title="虚构测试资料",precision="month",date="2026-08",note="虚构图形")
        status,_,body=self.upload(meta,imgs)
        self.assertEqual(status,200);self.assertEqual(json.loads(body),{"photo_ids":["FP10","FP11"],"set_id":"FS02"})
        self.assertEqual(self.upload(meta,imgs)[2],body)
        self.assertEqual(self.upload(meta,list(reversed(imgs)))[0],400)
        self.assertEqual(invoke(self.app,"images/FP01")[1]["Content-Type"],"image/svg+xml")
        for key,(_,raw),mime,sz in zip(["FP10","FP11"],imgs,["image/jpeg","image/png"],[(31,17),(17,33)]):
            status,h,actual=invoke(self.app,"images/"+key)
            self.assertEqual((status,h["Content-Type"],actual),(200,mime,raw))
            row=json.loads(invoke(self.app,"photos/"+key)[2])
            self.assertEqual((row["width"],row["height"]),sz)
            self.assertEqual((row["date_precision"],row["taken_date_raw"]),("month","2026-08"))
            with closing(db.connect(self.root)) as c:
                src=c.execute("SELECT * FROM sources WHERE source_id=?",(row["orig_source_id"],)).fetchone()
            self.assertEqual((src["kind"],src["sha256"],src["readonly_flag"]),("photo_orig",db.digest(raw),1))
            p=db.media_path(self.root,src["rel_path"])
            self.assertFalse(p.stat().st_mode & stat.S_IWRITE)
            self.assertEqual(src["rel_path"],"photos_orig/"+db.digest(raw)+("."+"jpg" if mime=="image/jpeg" else ".png"))
        self.assertEqual((original.stat().st_mtime_ns,original.read_bytes()),before)
        added=self.upload(dict(key="webp",mode="existing",set_id="FS02"),[("test.webp",picture("WEBP"))])
        self.assertEqual(json.loads(added[2])["photo_ids"],["FP12"])
        self.assertEqual(invoke(self.app,"images/FP12")[1]["Content-Type"],"image/webp")
        self.assertEqual([p["photo_id"] for p in json.loads(invoke(self.app,"sets/FS02")[2])["items"]],["FP10","FP11","FP12"])
        self.assertEqual(len(list((self.root/"photos_orig").iterdir())),3)

    def test_atomic_invalid_images_limits_date_and_target(self):
        png=picture("PNG")
        for files in [[("valid.png",png),("wrong.jpg",png)],[("wrong.svg",png)],[("short.png",png[:35])],
                      [("broken.jpg",picture("JPEG")[:-30])],[("empty.png",b"")]]:
            self.assertEqual(self.upload(dict(key="fail",mode="single"),files)[0],400)
        for extra in [dict(precision="month",date="2026-13"),dict(precision="year",date="26"),
                      dict(mode="existing",set_id="FS404"),dict(precision="exact",date="2026-02-30")]:
            self.assertEqual(self.upload(dict(key="fail",mode="single")|extra,[("ok.png",png)])[0],400)
        with patch.object(photo_import,"FILE_LIMIT",8):
            self.assertEqual(self.upload(dict(key="fail",mode="single"),[("ok.png",png)])[0],400)
        self.assertEqual(self.upload(dict(key="fail",mode="single"),[("ok.png",png)]*13)[0],400)
        self.assertEqual(self.post("photos/import",b"test",CONTENT_TYPE="multipart/form-data",
                                  CONTENT_LENGTH=str(photo_import.BODY_LIMIT+1))[0],413)
        with patch.object(importer,"add_set",side_effect=ValueError("interrupted")):
            self.assertEqual(self.upload(dict(key="fail",mode="new"),[("ok.png",png)])[0],400)
        self.assertFalse(list(self.root.glob("photos_orig/*")))
        with closing(db.connect(self.root)) as c:
            self.assertEqual(c.execute("SELECT count(*) FROM photos").fetchone()[0],9)
            self.assertEqual(c.execute("SELECT count(*) FROM import_jobs").fetchone()[0],0)

    def test_photo_concurrent_transactions(self):
        raw=picture("PNG");raw2=picture("PNG",(19,11))
        def insert(index):
            with closing(db.connect(self.root)) as c:
                return photo_import.save(c,self.root,dict(key=str(index),mode="existing",set_id="FS01"),
                                         [("f.png",raw if index%2 else raw2)])["photo_ids"][0]
        with ThreadPoolExecutor(max_workers=6) as pool:
            keys=list(pool.map(insert,[0,1,2,3,4,5,5]))
        self.assertEqual(len(set(keys)),6);self.assertEqual(len(list((self.root/"photos_orig").iterdir())),2)
        with closing(db.connect(self.root)) as c:
            order=[r[0] for r in c.execute("SELECT item_order FROM photo_set_items WHERE set_id='FS01' ORDER BY item_order")]
            self.assertEqual(order,list(range(1,13)))

    def test_reset_denials_and_stale_tokens(self):
        raw=picture("PNG");meta=dict(key="p",mode="single")
        for bad in [dict(HTTP_ORIGIN="http://different.invalid"),dict(HTTP_X_LA_SESSION_TOKEN="invalid"),dict(HTTP_ORIGIN="",HTTP_REFERER="")]:
            self.assertEqual(self.upload(meta,[("t.png",raw)],**bad)[0],403)
            self.assertEqual(self.post("fixture/reset",db.encoded({"confirm":"reset-fixture"}),**bad)[0],403)
            self.assertEqual(self.post("prefs",db.encoded({"font":1,"resume":True}),**bad)[0],403)
        with closing(db.connect(self.root)) as c:
            baseline=backup_restore.snapshot(c)
        self.assertEqual(self.upload(meta,[("t.png",raw)])[0],200)
        before=self.app.token
        self.assertEqual(self.post("fixture/reset",b"{}")[0],400)
        self.assertEqual(invoke(self.app,"images/FP10")[0],200)
        self.assertEqual(self.post("fixture/reset",db.encoded({"confirm":"reset-fixture"}))[0],200)
        self.assertNotEqual(before,self.app.token)
        self.assertEqual(self.upload(meta,[("t.png",raw)],HTTP_X_LA_SESSION_TOKEN=before)[0],403)
        with closing(db.connect(self.root)) as c:
            self.assertEqual(backup_restore.snapshot(c),baseline)
        self.assertEqual(invoke(self.app,"images/FP10")[0],404)
        self.assertEqual(next((self.root/"photos_orig").iterdir()).read_bytes(),raw)

    def test_shared_prefs_across_ports_resets_and_invalid_values(self):
        self.assertEqual(json.loads(invoke(self.app,"prefs")[2]),{"font":0,"resume":True})
        p={"font":2,"resume":False}
        self.assertEqual(self.post("prefs",db.encoded(p))[0],200)
        self.assertEqual(db.prefs_path(db.LIVE),db.DATA/"prefs.json")
        self.assertEqual(json.loads(db.prefs_path(self.root).read_bytes()),p)
        for invalid in [{**p,"font":True},{**p,"font":4},{**p,"resume":1},{**p,"diary":"x"}]:
            self.assertEqual(self.post("prefs",db.encoded(invalid))[0],400)
        other=server.Application("fixture",self.root);other.host="127.0.0.1:19848"
        self.assertEqual(json.loads(invoke(other,"prefs")[2]),p)
        self.assertEqual(self.post("fixture/reset",db.encoded({"confirm":"reset-fixture"}),other)[0],200)
        self.assertEqual(json.loads(invoke(other,"prefs")[2]),p)

    def test_imported_images_survive_independent_backup_restore(self):
        raw=picture("WEBP")
        self.upload(dict(key="backup",mode="new"),[("x.webp",raw)])
        bundle=self.work/"bundle";dest=self.work/"restore"
        backup_restore.export_backup(self.root,bundle)
        backup_restore.restore(bundle,dest)
        copy=server.Application("fixture",dest);copy.host=self.app.host
        self.assertEqual(invoke(copy,"images/FP10")[2],raw)
        self.assertFalse(next((dest/"photos_orig").iterdir()).stat().st_mode & stat.S_IWRITE)
        with closing(db.connect(self.root)) as c,closing(db.connect(dest)) as other:
            self.assertEqual(backup_restore.snapshot(c),backup_restore.snapshot(other))

    def test_live_restore_uses_shared_original_directory(self):
        raw=picture("PNG")
        self.upload(dict(key="live-bundle",mode="single"),[("t.png",raw)])
        bundle=self.work/"archive"
        backup_restore.export_backup(self.root,bundle)
        # Redirect both live paths into the disposable test folder.
        area=self.work/"restored-workspace"
        with patch.object(db,"DATA",self.work), patch.object(db,"LIVE",area):
            backup_restore.restore(bundle,area)
            app=server.Application("fixture",area);app.host=self.app.host
            self.assertEqual(invoke(app,"images/FP10")[2],raw)
            self.assertEqual(next((self.work/"photos_orig").iterdir()).read_bytes(),raw)
            self.assertFalse((area/"photos_orig").exists())

    def test_rotated_jpeg_preserves_encoded_pixels_and_reader_aspect(self):
        data=BytesIO();orientation=Image.Exif();orientation[274]=6
        Image.new("RGB",(62,35),(50,96,102)).save(data,"JPEG",exif=orientation)
        self.assertEqual(self.upload(dict(key="rotated",mode="single"),[("fixture.jpg",data.getvalue())])[0],200)
        with closing(db.connect(self.root)) as c:
            self.assertEqual(tuple(c.execute("SELECT width,height FROM photos WHERE photo_id='FP10'").fetchone()),(62,35))
        item=json.loads(invoke(self.app,"photos/FP10")[2])
        self.assertEqual((item["width"],item["height"],item["encoded_width"],item["encoded_height"]),(35,62,62,35))
        pool=json.loads(invoke(self.app,"discovery")[2])
        self.assertEqual([(p["width"],p["height"]) for p in pool if p.get("photo_id")=="FP10"],[(35,62)])
        self.assertEqual(invoke(self.app,"images/FP10")[2],data.getvalue())

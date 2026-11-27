"""Offline directory bundles. Run python -B -m studio.backend.backup_restore --help."""
import argparse
from contextlib import closing, contextmanager
import json
from pathlib import Path
import re
import shutil
import sqlite3
import stat
from threading import Thread
from time import sleep
from urllib.parse import quote
from http.client import HTTPConnection
from uuid import uuid4

from . import db, photo_import
from .importer import LABEL


def snapshot(c):
    tables = db.BASE_TABLES if c.execute("PRAGMA user_version").fetchone()[0]==1 else db.TABLES
    return {t:db.rows(c,f"SELECT * FROM {t} ORDER BY rowid") for t in tables}


def asset_paths(snap):
    result = {}
    for source in snap["sources"]:
        path = source["rel_path"]
        if path is not None:
            original = photo_import.ORIGINAL.fullmatch(path)
            if not (photo_import.SEED.fullmatch(path) or (original and original[1] == source["sha256"] and source["kind"] == "photo_orig")):
                raise ValueError("asset path")
            result[path] = source["sha256"]
    for photo in snap["photos"]:
        if photo["derived_rel_path"] not in result:
            raise ValueError("missing asset reference")
    return result


@contextmanager
def new_directory(dest):
    dest = db.local(dest)
    if dest.is_relative_to(db.PERSONAL) or dest == db.DATA or (dest.exists() and (not dest.is_dir() or any(dest.iterdir()))):
        raise ValueError("destination must be empty")
    for ancestor in dest.parents:
        if not ancestor.is_relative_to(db.DATA):
            break
        if any(db.local(ancestor / f"{scope}.sqlite").is_file() for scope in ("personal", "fixture")):
            raise ValueError("destination overlaps a workspace")
    dest.parent.mkdir(parents=True,exist_ok=True)
    stage = db.local(dest.with_name("work-"+uuid4().hex))
    stage.mkdir()
    try:
        yield stage
        if dest.exists():
            dest.rmdir()  # Only succeeds when still empty.
        for attempt in range(6):
            try:
                stage.rename(dest)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                sleep(0.05 * 2**attempt)
    finally:
        if stage.exists():
            shutil.rmtree(db.local(stage))


def readonly(path):
    return sqlite3.connect(db.local(path).as_uri()+"?mode=ro&immutable=1",uri=True)


def inspect_image(path, version=db.VERSION):
    with closing(readonly(path)) as c:
        c.row_factory = sqlite3.Row
        if (c.execute("PRAGMA user_version").fetchone()[0] != version
                or c.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
                or c.execute("PRAGMA foreign_key_check").fetchone()):
            raise ValueError("database integrity")
        return snapshot(c)


def json_file(path, obj):
    path.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding="utf-8")


def export_backup(root, dest):
    root,dest = db.local(root),db.local(dest)
    if dest.is_relative_to(root) or root.is_relative_to(dest):
        raise ValueError("separate backup and runtime")
    # Keep the database snapshot and its blob inventory at the same revision during purge/import.
    with new_directory(dest) as stage, closing(db.connect(root)) as lock, db.transaction(lock):
        if lock.execute("SELECT 1 FROM photo_purges").fetchone():
            raise ValueError("finish pending photo cleanup before backup")
        scope = lock.scope
        database = f"{scope}.sqlite"
        image = stage/database
        with closing(db.connect(root)) as live, closing(sqlite3.connect(image)) as copy:
            live.backup(copy)
            copy.execute("PRAGMA journal_mode=DELETE")
        snap = inspect_image(image)
        json_file(stage/"snapshot.json",snap)
        files = {name:db.digest((stage/name).read_bytes()) for name in (database,"snapshot.json")}
        for rel,expected in asset_paths(snap).items():
            data = db.media_path(root,rel).read_bytes()
            if db.digest(data) != expected:
                raise ValueError("asset fingerprint")
            (stage/rel).parent.mkdir(exist_ok=True)
            (stage/rel).write_bytes(data)
            files[rel] = expected
        json_file(stage/"manifest.json",dict(schema_version=db.VERSION,format_version=1,scope=scope,database=database,label=LABEL if scope=="fixture" else None,
                  dependencies=["Python 3.11","SQLite 3.45","waitress==3.0.2","Pillow==12.2.0"],files=files))
    return dest


def verify_tree(root, files):
    found = set()
    def walk(folder):
        for child in folder.iterdir():
            db.local(child)
            if child.is_dir():
                if child not in (root/"assets",root/"photos_orig"):
                    raise ValueError("unexpected backup directory")
                walk(child)
            else:
                found.add(child.relative_to(root).as_posix())
    walk(root)
    if found != set(files) | {"manifest.json"}:
        raise ValueError("backup file inventory")


def restore(bundle, dest, *, scope=None):
    bundle,dest = db.local(bundle),db.local(dest)
    if dest.is_relative_to(bundle) or bundle.is_relative_to(dest):
        raise ValueError("separate restore and bundle")
    manifest = json.loads(db.local(bundle/"manifest.json").read_bytes())
    actual = manifest["scope"]
    if (actual not in ("personal", "fixture") or (scope is not None and scope != actual)
            or manifest["format_version"] != 1 or manifest["schema_version"] not in (1, 2, db.VERSION)):
        raise ValueError("manifest version or scope")
    database = f"{actual}.sqlite"
    if manifest.get("database", database) != database or (dest == db.LIVE and actual != "fixture"):
        raise ValueError("database name or destination scope")
    files = manifest["files"]
    verify_tree(bundle,files)
    with new_directory(dest) as stage:
        for rel,expected in files.items():
            if rel not in (database,"snapshot.json") and not (photo_import.SEED.fullmatch(rel) or photo_import.ORIGINAL.fullmatch(rel)):
                raise ValueError("unexpected bundle path")
            data = db.local(bundle/rel).read_bytes()
            if db.digest(data)!=expected:
                raise ValueError("backup fingerprint")
            (stage/rel).parent.mkdir(exist_ok=True)
            (stage/rel).write_bytes(data)
        snap = inspect_image(stage/database,manifest["schema_version"])
        if any(record.get("dataset_scope", actual) != actual
               for records in snap.values() for record in records):
            raise ValueError("database contents do not match workspace scope")
        if snap.get("photo_purges"):
            raise ValueError("unfinished file cleanup in backup")
        assets = asset_paths(snap)
        if (snap != json.loads((stage/"snapshot.json").read_bytes()) or set(files)!=set(assets)|{database,"snapshot.json"}
                or any(files[name]!=fingerprint for name,fingerprint in assets.items())):
            raise ValueError("snapshot or asset mismatch")
        (stage/"snapshot.json").unlink()
        with closing(db.connect(stage)) as c:
            c.execute("PRAGMA journal_mode=WAL")
        for rel in assets:
            if photo_import.ORIGINAL.fullmatch(rel):
                copy = db.local(stage/rel)
                if dest == db.LIVE:
                    photo_import.store_copy(dest,rel,copy.read_bytes(),[])
                    copy.unlink()
                else:
                    copy.chmod(stat.S_IREAD)
        if dest == db.LIVE and (stage/"photos_orig").is_dir():
            (stage/"photos_orig").rmdir()
    return dest


@contextmanager
def running(root):
    from .server import Application, listener
    app = Application(db.workspace_scope(root), root)
    service = listener(app)
    thread = Thread(target=service.run,daemon=True)
    thread.start()
    def request(path,p=None):
        with closing(HTTPConnection(app.host,timeout=8)) as client:
            headers = {"Origin":"http://"+app.host,"X-LA-Session-Token":app.token,"Content-Type":"application/json"}
            client.request("GET" if p is None else "POST",app.prefix+path,
                           None if p is None else db.encoded(p),headers)
            reply = client.getresponse()
            if reply.status!=200:
                raise ValueError("loopback status "+str(reply.status))
            data = reply.read()
            return data if path.startswith("images/") else json.loads(data)
    try:
        yield request
    finally:
        service.task_dispatcher.shutdown()
        service.close()
        thread.join(8)
        if thread.is_alive():
            raise RuntimeError("service did not stop")


def require(ok):
    if not ok:
        raise ValueError("restore rehearsal check")


def exercise(root):
    """Extend only a disposable rehearsal copy with an idempotent synthetic entry."""
    payload = dict(kind="entry",label=LABEL if db.workspace_scope(root)=="fixture" else None,title_raw="复开的纸棚",entry_date="2026-10-02",
                   paragraphs=["　　虚构测试资料。纸棚的窗今天又能打开了。"])
    post = dict(idempotency_key="restore-rehearsal-"+uuid4().hex,payload=payload)
    with closing(db.connect(root)) as c:
        active = [row[0] for row in c.execute("SELECT entry_id FROM entries WHERE deleted_at IS NULL ORDER BY entry_date,entry_id")]
        sets = [row[0] for row in c.execute("SELECT set_id FROM photo_sets WHERE deleted_at IS NULL ORDER BY date_hint,set_id")]
        bin_ids = {row[0] for table,col in (("entries","entry_id"),("photo_sets","set_id"),("photos","photo_id"))
                   for row in c.execute(f"SELECT {col} FROM {table} WHERE deleted_at IS NOT NULL")}
    with running(root) as get:
        entries = get("entries")
        require([item["entry_id"] for item in entries]==active)
        require([item["set_id"] for item in get("sets")]==sets)
        require({item["id"] for item in get("trash/list",{})}==bin_ids)
        for key in active:
            item = get("entries/"+key)
            para = next((p for p in item["paragraphs"] if p["text_raw"].strip()),None)
            if para:
                require(any(h["para_id"]==para["para_id"] for h in get("search?q="+quote(para["text_raw"][:16]))))
            for link in item["links"]:
                if link["response_id"]:
                    require(any(l["entry_id"]==key for l in get("responses/"+link["response_id"])["links"]))
        for album in sets:
            require(all(p["photo_id"] not in bin_ids for p in get("sets/"+album)["items"]))
        for clue in get("discovery"):
            require(not any(clue.get(k) in bin_ids for k in ("entry_id","photo_id","set_id")))
            if clue["kind"]=="photo":
                require(bool(get("images/"+clue["photo_id"])))
        key = get("imports",post)["id"]
        require(get("imports",post)["id"]==key)
    with running(root) as get:
        require(len(get("entries"))==len(entries)+1)
        require(get("entries/"+key)["paragraphs"][0]["text_raw"]==payload["paragraphs"][0])
        require(get("imports",post)["id"]==key)


def verify_restore(bundle,dest,*,scope=None):
    from waitress import create_server  # Fail before creating the destination if the offline runtime is incomplete.
    restore(bundle,dest,scope=scope)
    exercise(dest)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation",choices=("export_backup","restore","verify_restore"))
    parser.add_argument("bundle",type=Path)
    parser.add_argument("--root",type=Path)
    parser.add_argument("--scope", choices=("personal", "fixture"))
    args = parser.parse_args()
    if args.operation=="export_backup":
        root = args.root or (db.DEMO if args.scope == "fixture" else db.PERSONAL)
        if args.scope and db.workspace_scope(root) != args.scope:
            parser.error("--scope does not match the source workspace")
        export_backup(root,args.bundle)
    else:
        if args.root is None:
            parser.error("--root must name a new or empty rehearsal directory")
        operation = restore if args.operation == "restore" else verify_restore
        operation(args.bundle,args.root,scope=args.scope)
    print(args.operation,"OK")


if __name__=="__main__":
    main()

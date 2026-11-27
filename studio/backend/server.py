"""Run with python -B -m studio.backend.server [--demo] [--no-browser]."""
import argparse
from contextlib import closing
import hmac
import json
import re
import secrets
import socket
import sqlite3
import stat
from threading import Lock
from urllib.parse import parse_qs, urlsplit
from zipfile import BadZipFile

from . import db, fixture_seed, importer, random_pool, photo_import, preferences, archive_trash

CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
       "connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
LIMIT = 256 * 1024
HEADERS = [("Cache-Control","no-store"),("Referrer-Policy","no-referrer"),
           ("X-Content-Type-Options","nosniff"),("Content-Security-Policy",CSP)]

DIST = db.PROJECT / "studio/frontend/dist"


def static_asset(route):
    if route == "":
        path, mime = DIST / "index.html", "text/html; charset=utf-8"
    elif re.fullmatch(r"assets/[A-Za-z0-9_-]+\.(js|css)", route):
        path = DIST / route
        mime = "text/javascript; charset=utf-8" if path.suffix == ".js" else "text/css; charset=utf-8"
    else:
        raise KeyError("asset")
    for part in (path, *path.parents):
        if part == db.PROJECT:
            break
        info = part.lstat()
        if getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT or part.is_symlink():
            raise KeyError("asset")
    if path.stat().st_nlink != 1:
        raise KeyError("asset")
    return mime, path.read_bytes()


def single(c, sql, args):
    data = db.rows(c,sql,args)
    if not data:
        raise KeyError("missing")
    return data[0]


def fixture_get(c, path, args, root):
    value = lambda name, default="": args.get(name,[default])[0]
    if path == "entry-count":
        return c.execute("SELECT count(*) FROM entries WHERE deleted_at IS NULL").fetchone()[0]
    if path in ("entries","catalog"):
        return db.rows(c,"SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY entry_date,entry_id")
    if path == "search":
        phrase = value("q")
        return db.rows(c, """SELECT entry_id,para_id,seq_no,text_raw FROM paragraphs JOIN entries USING(entry_id)
                       WHERE deleted_at IS NULL AND instr(text_raw,?)>0 ORDER BY entry_id,seq_no""",(phrase,)) if phrase else []
    if path == "orphan-responses":
        return db.rows(c,"""SELECT r.response_id,r.title_raw,coalesce(l.note,'当前未关联篇目') AS note FROM ai_responses r
                       LEFT JOIN entry_ai_links l USING(response_id) WHERE l.link_status='orphan_missing_input'
                       OR l.link_id IS NULL ORDER BY r.response_id""")
    if path in ("sets","albums"):
        return db.rows(c,"""WITH members AS (
                    SELECT i.set_id,i.photo_id,count(*) OVER (PARTITION BY i.set_id) AS total,
                           row_number() OVER (PARTITION BY i.set_id ORDER BY i.item_order) AS position
                    FROM photo_set_items i JOIN photos p USING(photo_id) WHERE p.deleted_at IS NULL)
                    SELECT s.*,m.photo_id AS first_photo_id,coalesce(m.total,0) AS photo_count FROM photo_sets s
                    LEFT JOIN members m ON m.set_id=s.set_id AND m.position=1
                    WHERE s.deleted_at IS NULL ORDER BY s.date_hint,s.set_id""")
    if path == "photos":
        return [photo_import.for_display(p) for p in db.rows(c,"SELECT * FROM photos WHERE deleted_at IS NULL ORDER BY photo_id")]
    if path == "curation":
        return dict(entries=db.rows(c, """SELECT e.entry_id,e.title_raw,e.entry_date,
                    EXISTS(SELECT 1 FROM quotes q WHERE q.entry_id=e.entry_id AND q.status='user_confirmed') AS has_quote,
                    EXISTS(SELECT 1 FROM entry_ai_links a WHERE a.entry_id=e.entry_id AND a.link_status='linked') AS has_ai,
                    EXISTS(SELECT 1 FROM entry_ai_links a WHERE a.entry_id=e.entry_id AND a.link_status='confirmed_none') AS confirmed_none
                    FROM entries e WHERE e.deleted_at IS NULL ORDER BY entry_date,entry_id"""),
                    dismissed=db.rows(c,"SELECT entry_id,dismiss_kind FROM curation_dismissals JOIN entries USING(entry_id) WHERE deleted_at IS NULL"),
                    candidates=db.rows(c,"SELECT entry_id,quote_id,quote_text FROM quotes JOIN entries USING(entry_id) WHERE deleted_at IS NULL AND status='ai_candidate' ORDER BY quotes.created_at"))
    if path == "simulate":
        return random_pool.simulate(c,value("mode","equal_entry"),int(value("seed","24")))
    if path == "discovery":
        quotes = db.rows(c,"""SELECT q.quote_id,q.entry_id,q.quote_text,q.para_id,q.char_end,e.entry_date,
                              (SELECT count(*) FROM entries WHERE deleted_at IS NULL) AS entry_count,
                              EXISTS(SELECT 1 FROM entry_ai_links l WHERE l.entry_id=q.entry_id
                                     AND l.link_status='linked' AND l.response_id IS NOT NULL) AS linked,
                              'quote' AS kind FROM quotes q JOIN entries e USING(entry_id)
                              WHERE e.deleted_at IS NULL AND q.status='user_confirmed' ORDER BY q.quote_id""")
        photos = db.rows(c,"""SELECT p.photo_id,i.set_id,p.width,p.height,p.derived_ops_json,p.has_inner_margin,p.taken_date_raw,'photo' AS kind
                              FROM photos p LEFT JOIN (SELECT photo_id,set_id FROM photo_set_items JOIN photo_sets USING(set_id)
                              WHERE deleted_at IS NULL) i USING(photo_id) WHERE p.deleted_at IS NULL ORDER BY p.photo_id,i.set_id""")
        return quotes + [photo_import.for_display(p) for p in photos]
    kind,sep,key = path.partition("/")
    if not sep or "/" in key:
        raise KeyError("route")
    if kind == "entries":
        item = db.detail(c,key)
        item['photos'] = [photo_import.for_display(p) for p in item['photos']]
        return item
    if kind == "responses":
        item = single(c,"""SELECT * FROM ai_responses r WHERE response_id=? AND (
                       NOT EXISTS(SELECT 1 FROM entry_ai_links WHERE response_id=r.response_id) OR
                       EXISTS(SELECT 1 FROM entry_ai_links l LEFT JOIN entries e USING(entry_id)
                              WHERE l.response_id=r.response_id AND e.deleted_at IS NULL))""",(key,))
        item["blocks"] = json.loads(item.pop("blocks_json"))
        item["links"] = db.rows(c,"SELECT l.* FROM entry_ai_links l LEFT JOIN entries e USING(entry_id) WHERE response_id=? AND e.deleted_at IS NULL",(key,))
        return item
    if kind == "sets":
        item = single(c,"SELECT * FROM photo_sets WHERE set_id=? AND deleted_at IS NULL",(key,))
        item["items"] = db.rows(c,"""SELECT p.*,i.item_order FROM photo_set_items i JOIN photos p USING(photo_id)
                                     WHERE set_id=? AND p.deleted_at IS NULL ORDER BY item_order""",(key,))
        item["items"] = [photo_import.for_display(p) for p in item["items"]]
        return item
    if kind == "photos":
        item = single(c,"SELECT * FROM photos WHERE photo_id=? AND deleted_at IS NULL",(key,))
        photo_import.for_display(item)
        item["links"] = db.rows(c,"SELECT entry_id,placement FROM entry_photo_links JOIN entries USING(entry_id) WHERE photo_id=? AND deleted_at IS NULL AND confirmed_by_user=1",(key,))
        return item
    if kind == "images":
        row = single(c,"SELECT derived_rel_path FROM photos WHERE photo_id=? AND deleted_at IS NULL",(key,))
        return photo_import.read_image(root, row["derived_rel_path"])
    raise KeyError("route")


class Application:
    def __init__(self, scope, root=None):
        if scope not in ("personal","fixture"):
            raise ValueError("scope")
        self.scope = scope
        self.root = db.local(root or (db.PERSONAL if scope == "personal" else db.LIVE))
        if (scope != "personal" and self.root == db.PERSONAL) or db.PERSONAL in self.root.parents:
            raise ValueError("workspace scope")
        self.prefix = "/" + secrets.token_urlsafe(24) + "/"
        self.token = secrets.token_urlsafe(32)
        self.host = ""
        self.write_lock = Lock()
        if scope == "fixture":
            fixture_seed.seed(self.root)
        with closing(db.connect(self.root, create=(scope == "personal"), scope=scope)) as c:
            archive_trash.recover(c, self.root)

    def authorized_write(self, env):
        origin = "http://" + self.host
        supplied = env.get("HTTP_ORIGIN")
        referer = env.get("HTTP_REFERER")
        if not (supplied or referer) or (supplied is not None and supplied != origin):
            return False
        if referer is not None:
            parsed = urlsplit(referer)
            if parsed.scheme != "http" or parsed.netloc != self.host:
                return False
        return hmac.compare_digest(env.get("HTTP_X_LA_SESSION_TOKEN","").encode(),self.token.encode())

    def write(self, env, path):
        if not self.authorized_write(env):
            return "403 Forbidden", {}
        if env["REQUEST_METHOD"] != "POST" or (path != "prefs" and (
                (path == "fixture/reset" and self.scope != "fixture") or path not in ("imports","curation","photos/import","fixture/reset",
                    "trash/list","trash/move","trash/restore","trash/purge",
                    "trash/move-batch","trash/restore-all","trash/purge-all"))):
            raise KeyError("route")
        photos = path == "photos/import"
        content_type = env.get("CONTENT_TYPE","")
        expected = "multipart/form-data" if photos else "application/json"
        if content_type.partition(";")[0].strip().lower() != expected:
            return "415 Unsupported Media Type", {}
        size = int(env.get("CONTENT_LENGTH") or 0)
        if not 0 < size <= (photo_import.BODY_LIMIT if photos else LIMIT):
            return "413 Payload Too Large", {}
        raw = env["wsgi.input"].read(size)
        if len(raw) != size:
            raise ValueError("incomplete request")
        try:
            if photos:
                meta, files = photo_import.unpack(content_type, raw)
                with closing(db.connect(self.root)) as c:
                    return "200 OK", photo_import.save(c,self.root,meta,files)
            p = json.loads(raw)
            if path == "prefs":
                return "200 OK", preferences.write(self.root,p)
            with closing(db.connect(self.root)) as c:
                if path == "trash/list" and p == {}:
                    return "200 OK", archive_trash.contents(c)
                if path in ("trash/move-batch","trash/restore-all","trash/purge-all"):
                    return "200 OK", archive_trash.batch(c,self.root,path.removeprefix("trash/"),p)
                if path.startswith("trash/"):
                    return "200 OK", archive_trash.change(c,self.root,path.removeprefix("trash/"),p)
                if path == "fixture/reset":
                    if p != {"confirm":"reset-fixture"}:
                        raise ValueError("reset confirmation")
                    fixture_seed.reset(c,self.root)
                    self.token = secrets.token_urlsafe(32)
                    return "200 OK", {"session_token":self.token}
                if path == "curation" and p["payload"]["kind"] not in ("response","quote","confirm_quote","archive_quote","photo_link","reminder"):
                    raise ValueError("curation action")
                return "200 OK", {"id":importer.submit(c,p["idempotency_key"],p["payload"])}
        except (KeyError,AttributeError,TypeError,ValueError,sqlite3.IntegrityError):
            return "400 Bad Request", {}

    def dispatch(self, env):
        full = env["PATH_INFO"]
        if env.get("HTTP_HOST") != self.host or not full.startswith(self.prefix):
            raise KeyError("route")
        path = full[len(self.prefix):]
        method = env["REQUEST_METHOD"]
        if method in ("POST","PATCH","DELETE","PUT"):
            with self.write_lock:
                return self.write(env, path)
        if method != "GET":
            return "405 Method Not Allowed", {}
        if path == "" or path.startswith("assets/"):
            try:
                return "200 OK", static_asset(path)
            except FileNotFoundError:
                raise KeyError("asset") from None
        if path == "prefs":
            return "200 OK", preferences.read(self.root)
        if path == "session":
            return "200 OK", dict(scope=self.scope,writable=True,session_token=self.token,allow_scope_switch=False,
                                  label=importer.LABEL if self.scope=="fixture" else None)
        with closing(db.connect(self.root)) as c:
            return "200 OK",fixture_get(c,path,parse_qs(env.get("QUERY_STRING","")),self.root)

    def __call__(self, env, start):
        try:
            status, obj = self.dispatch(env)
        except KeyError:
            status,obj = "404 Not Found",{}
        except (ValueError,TypeError):
            status,obj = "400 Bad Request",{}
        except (OSError,sqlite3.Error,BadZipFile):
            status,obj = "503 Service Unavailable",{}
        except Exception:
            status,obj = "500 Internal Server Error",{}
        if isinstance(obj,tuple):
            mime,body = obj
        else:
            mime,body = "application/json; charset=utf-8",db.encoded(obj)
        start(status,HEADERS+[("Content-Type",mime),("Content-Length",str(len(body)))])
        return [body]


def listener(app):
    from waitress import create_server
    sock = socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1",0))
        sock.listen(32)
        app.host = "127.0.0.1:" + str(sock.getsockname()[1])
        return create_server(app,sockets=[sock],expose_tracebacks=False,ident="LA",
                             max_request_body_size=photo_import.BODY_LIMIT+1,inbuf_overflow=photo_import.BODY_LIMIT+1,
                             outbuf_overflow=photo_import.FILE_LIMIT+1,asyncore_loop_timeout=1,clear_untrusted_proxy_headers=True)
    except BaseException:
        sock.close()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope",choices=("personal","fixture"),default="personal")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    static_asset("")
    scope = "fixture" if args.demo else args.scope
    app = Application(scope, db.DEMO if scope == "fixture" else db.PERSONAL)
    server = listener(app)
    try:
        url = "http://" + app.host + app.prefix
        print(url, flush=True)
        if not args.no_browser:
            import webbrowser
            webbrowser.open(url)
        server.run()
    finally:
        server.close()


if __name__ == "__main__":
    main()

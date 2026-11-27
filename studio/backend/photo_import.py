"""Import only selected raster files into the writable workspace."""
from datetime import date
from email import policy
from email.parser import BytesParser
from io import BytesIO
import json
import os
from pathlib import PurePath
import re
import stat
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from . import db, importer

FILE_LIMIT = 12 * 1024 * 1024
BATCH_LIMIT = 24 * 1024 * 1024
BODY_LIMIT = BATCH_LIMIT + 128 * 1024
MAX_FILES = 12
FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}
ORIGINAL = re.compile(r"photos_orig/([0-9a-f]{64})\.(jpg|png|webp)")
SEED = re.compile(r"assets/FP[0-9]+\.svg")


def inspect(name, data):
    if not isinstance(name, str) or not 0 < len(data) <= FILE_LIMIT:
        raise ValueError("image size")
    ext = PurePath(name).suffix.lower().lstrip(".")
    if ext == "jpeg":
        ext = "jpg"
    if ext not in ("jpg", "png", "webp"):
        raise ValueError("image extension")
    try:
        with Image.open(BytesIO(data), formats=tuple(FORMATS)) as im:
            if FORMATS[im.format][0] != ext:
                raise ValueError("image signature")
            w, h = im.size
            if w * h > 40_000_000 or max(w,h) > 32768:
                raise ValueError("image dimensions")
            im.verify()
        # Loading also checks the encoded pixel stream, including truncated JPEGs.
        with Image.open(BytesIO(data), formats=tuple(FORMATS)) as im:
            im.load()
            orientation = im.getexif().get(274, 1)
    except (OSError, SyntaxError, Image.DecompressionBombError, UnidentifiedImageError) as err:
        raise ValueError("invalid image") from err
    operations = [{"op":"exif_orientation","value":orientation}] if orientation in range(2,9) else []
    return ext, w, h, db.encoded(operations).decode()


def unpack(content_type, body):
    if "\r" in content_type or "\n" in content_type:
        raise ValueError("multipart header")
    msg = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + content_type.encode("ascii") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
    if not msg.is_multipart() or msg.defects:
        raise ValueError("multipart")
    files, meta = [], None
    for part in msg.iter_parts():
        if part.is_multipart() or part.defects or part.get_content_disposition() != "form-data":
            raise ValueError("multipart part")
        field = part.get_param("name", header="content-disposition")
        raw = part.get_payload(decode=True)
        if field == "files" and part.get_filename() and len(files) < MAX_FILES:
            files.append((part.get_filename(), raw))
        elif field == "metadata" and meta is None and len(raw) <= 8192:
            meta = json.loads(raw)
        else:
            raise ValueError("multipart field")
    if not isinstance(meta, dict) or not files or sum(len(raw) for _,raw in files) > BATCH_LIMIT:
        raise ValueError("batch")
    return meta, files


def date_value(meta):
    value = meta.get("date") or None
    precision = meta.get("precision", "unknown")
    if precision == "unknown" and value is None:
        return None, precision
    patterns = {"year":r"[0-9]{4}", "month":r"[0-9]{4}-[0-9]{2}", "exact":r"[0-9]{4}-[0-9]{2}-[0-9]{2}"}
    if precision not in patterns or not isinstance(value, str) or not re.fullmatch(patterns[precision], value):
        raise ValueError("date precision")
    date.fromisoformat(value + {"year":"-01-01","month":"-01","exact":""}[precision])
    return value, precision


def store_copy(root, rel, raw, created):
    path = db.media_path(root, rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if db.digest(path.read_bytes()) != ORIGINAL.fullmatch(rel)[1]:
            raise ValueError("stored fingerprint")
        return
    temp = db.local(path.with_name("upload-" + uuid4().hex + ".tmp"))
    try:
        with temp.open("xb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        temp.replace(path)
        created.append(path)
        path.chmod(stat.S_IREAD)
    finally:
        temp.unlink(missing_ok=True)


def save(c, root, meta, files):
    token, mode = meta.get("key"), meta.get("mode")
    if not isinstance(token, str) or not 0 < len(token.strip()) <= 200 or mode not in ("single", "new", "existing"):
        raise ValueError("photo import")
    day, precision = date_value(meta)
    title, note = meta.get("title") or None, meta.get("note") or None
    if any(v is not None and (not isinstance(v,str) or len(v)>2000) for v in (title,note)):
        raise ValueError("photo description")
    if not 0 < len(files) <= MAX_FILES or sum(len(raw) for _,raw in files) > BATCH_LIMIT:
        raise ValueError("batch")
    images = []
    for name, raw in files:
        suffix, width, height, operations = inspect(name, raw)
        sha = db.digest(raw)
        images.append((f"photos_orig/{sha}.{suffix}", sha, width, height, operations, raw))
    fingerprint = db.digest(db.encoded(["photo-import",meta,[i[1] for i in images]]))
    with db.transaction(c):
        receipt = c.execute("SELECT payload_sha256,result_entity_id,status FROM import_jobs WHERE idempotency_key=?", (token,)).fetchone()
        if receipt:
            if receipt[0] != fingerprint or receipt[2]!='committed':
                raise ValueError("idempotency conflict")
            return json.loads(receipt[1])
        group = meta.get("set_id") if mode == "existing" else None
        if mode == "existing" and not c.execute("SELECT 1 FROM photo_sets WHERE set_id=? AND deleted_at IS NULL", (group,)).fetchone():
            raise ValueError("photo set")
        stamp, ids, created = db.now(), [], []
        try:
            for rel, sha, w, h, operations, raw in images:
                store_copy(root, rel, raw, created)
                key = importer.next_id(c, "photo")
                source = key+"-src"
                c.execute("INSERT INTO sources VALUES(?,?,'photo_orig',?,?,1,?)", (source,c.scope,rel,sha,stamp))
                c.execute("INSERT INTO photos(photo_id,dataset_scope,orig_source_id,derived_rel_path,derived_ops_json,width,height,has_inner_margin,taken_date_raw,date_precision,caption_raw,caption_written_at) VALUES(?,?,?,?,?,?,?,0,?,?,?,?)",
                          (key,c.scope,source,rel,operations,w,h,day,precision,note,stamp if note else None))
                ids.append(key)
            if mode == "new":
                group = importer.next_id(c, "photo_set")
                importer.add_set(c, dict(photo_ids=ids,title_raw=title,date_hint=day,set_note_raw=note,
                                         set_note_written_at=stamp[:10] if note else None),group,stamp)
            elif mode == "existing":
                offset = c.execute("SELECT COALESCE(MAX(item_order),0) FROM photo_set_items WHERE set_id=?", (group,)).fetchone()[0]
                c.executemany("INSERT INTO photo_set_items VALUES(?,?,?)", [(group,k,n) for n,k in enumerate(ids,offset+1)])
            result = {"photo_ids":ids,"set_id":group}
            c.execute("INSERT INTO import_jobs VALUES(?,?,?,'committed',?,?,?)",
                      (importer.next_id(c,"job"),token,fingerprint,db.encoded(result).decode(),stamp,stamp))
        except BaseException:
            for path in created:
                path.chmod(stat.S_IWRITE | stat.S_IREAD)
                path.unlink()
            raise
    return result


def for_display(photo):
    """HTML image dimensions follow EXIF. The database retains the encoded pixel matrix."""
    operations = json.loads(photo.get("derived_ops_json") or "[]")
    if any(isinstance(op,dict) and op.get("op")=="exif_orientation" and op.get("value") in (5,6,7,8) for op in operations):
        photo["encoded_width"], photo["encoded_height"] = photo["width"], photo["height"]
        photo["width"], photo["height"] = photo["height"], photo["width"]
    return photo


def read_image(root, rel):
    if SEED.fullmatch(rel):
        return "image/svg+xml", db.media_path(root, rel).read_bytes()
    match = ORIGINAL.fullmatch(rel)
    if not match:
        raise ValueError("image reference")
    data = db.media_path(root, rel).read_bytes()
    if db.digest(data) != match[1]:
        raise ValueError("image fingerprint")
    mime = {ext:mime for ext,mime in FORMATS.values()}[match[2]]
    return mime, data

"""Two-stage removal inside a writable archive. Physical cleanup is limited to registered import copies."""
import json
import stat
from . import db, importer, photo_import

ITEMS = {
    "entry": ("entries", "entry_id", "title_raw"),
    "photo": ("photos", "photo_id", "caption_raw"),
    "photo_set": ("photo_sets", "set_id", "title_raw"),
}


def contents(c):
    result = []
    for kind, (table, key, title) in ITEMS.items():
        pending = "EXISTS(SELECT 1 FROM photo_purges j WHERE j.photo_id=photos.photo_id)" if kind=="photo" else "0"
        original = "EXISTS(SELECT 1 FROM sources s WHERE s.source_id=entries.source_id AND s.kind='diary_docx')" if kind=="entry" else "0"
        result.extend(db.rows(c, f"""SELECT ? AS kind,{key} AS id,{title} AS title,deleted_at,{pending} AS purging,{original} AS protected_history
                              FROM {table} WHERE dataset_scope=? AND deleted_at IS NOT NULL""", (kind,c.scope)))
    return sorted(result, key=lambda row:(row["deleted_at"],row["id"]), reverse=True)


def drop_unused_source(c, source):
    c.execute("""DELETE FROM sources WHERE source_id=? AND dataset_scope=?
                 AND NOT EXISTS(SELECT 1 FROM photos WHERE orig_source_id=sources.source_id)
                 AND NOT EXISTS(SELECT 1 FROM entries WHERE entries.source_id=sources.source_id)
                 AND NOT EXISTS(SELECT 1 FROM ai_responses WHERE ai_responses.source_id=sources.source_id)""", (source,c.scope))


def imported_copy(c, root, photo):
    source = c.execute("SELECT * FROM sources WHERE source_id=?", (photo["orig_source_id"],)).fetchone()
    if not source or source["kind"] != "photo_orig":
        return None
    rel = source["rel_path"]
    match = photo_import.ORIGINAL.fullmatch(rel or "")
    if (not match or source["dataset_scope"]!=c.scope or source["readonly_flag"]!=1 or
            match[1]!=source["sha256"] or rel!=photo["derived_rel_path"]):
        raise ValueError("unverified import copy")
    path = db.media_path(root, rel)
    if path.parent != db.local((db.DATA if root==db.LIVE else root)/"photos_orig"):
        raise ValueError("copy outside archive")
    shared = c.execute("""SELECT EXISTS(SELECT 1 FROM photos WHERE photo_id<>? AND (orig_source_id=? OR derived_rel_path=?))
             OR EXISTS(SELECT 1 FROM sources WHERE source_id<>? AND rel_path=?)
             OR EXISTS(SELECT 1 FROM entries WHERE source_id=?) OR EXISTS(SELECT 1 FROM ai_responses WHERE source_id=?)""",
             (photo["photo_id"],source["source_id"],rel,source["source_id"],rel,source["source_id"],source["source_id"])).fetchone()[0]
    if shared or not path.exists():
        return None
    if not path.is_file() or db.digest(path.read_bytes())!=match[1]:
        raise ValueError("copy fingerprint")
    return path


def retire_receipts(c, kind, key):
    # Preserve idempotency keys, but never replay an ID or batch whose result has been cleared.
    references = {key}
    if kind=="entry":
        references.update(r[0] for r in c.execute("SELECT quote_id FROM quotes WHERE entry_id=?",(key,)))
    if kind in ("photo","entry"):
        column = "photo_id" if kind=="photo" else "entry_id"
        references.update(r[0] for r in c.execute(f"SELECT link_id FROM entry_photo_links WHERE {column}=?",(key,)))
    expired = []
    for job,result in c.execute("SELECT job_id,result_entity_id FROM import_jobs WHERE status='committed'"):
        if result in references:
            expired.append(job)
        elif kind!="entry" and result and result.startswith("{"):
            batch = json.loads(result)
            if (kind=="photo" and key in batch.get("photo_ids",[])) or (kind=="photo_set" and key==batch.get("set_id")):
                expired.append(job)
    c.executemany("UPDATE import_jobs SET status='failed',result_entity_id=NULL,updated_at=? WHERE job_id=?",
                  [(db.now(),job) for job in expired])


def finish_photo(c, root, key, stamp):
    with db.transaction(c):
        photo = c.execute("""SELECT p.* FROM photos p JOIN photo_purges j USING(photo_id)
                       WHERE p.photo_id=? AND p.dataset_scope=? AND p.deleted_at=j.deleted_at AND j.deleted_at=?""",
                       (key,c.scope,stamp)).fetchone()
        if not photo:
            return
        path = imported_copy(c,root,photo)
        retire_receipts(c,"photo",key)
        c.execute("DELETE FROM photo_set_items WHERE photo_id=?", (key,))
        c.execute("DELETE FROM entry_photo_links WHERE photo_id=?", (key,))
        c.execute("DELETE FROM photos WHERE photo_id=?", (key,))
        drop_unused_source(c,photo["orig_source_id"])
        if path:
            # The durable intent survives a failed commit or interruption after unlink.
            # Concurrent SQLite writers cannot attach the same bytes during this transaction.
            db.local(path).chmod(stat.S_IREAD | stat.S_IWRITE)
            try:
                db.local(path).unlink()
            except OSError:
                if path.exists():
                    db.local(path).chmod(stat.S_IREAD)
                raise


def recover(c, root):
    for key,stamp in c.execute("SELECT photo_id,deleted_at FROM photo_purges").fetchall():
        try:
            finish_photo(c,root,key,stamp)
        except (ValueError,OSError):
            # A locked or changed copy stays in the bin for an explicit retry.
            continue


def change(c, root, action, payload):
    kind, key = payload["kind"], payload["id"]
    if kind not in ITEMS or not isinstance(key,str) or not key:
        raise ValueError("archive item")
    table,column,_ = ITEMS[kind]
    with db.transaction(c):
        row = c.execute(f"SELECT * FROM {table} WHERE {column}=? AND dataset_scope=?", (key,c.scope)).fetchone()
        if not row:
            # A prior purge may have committed while its acknowledgement was lost.
            if (action=="purge" and set(payload)=={"kind","id","deleted_at","confirm"}
                    and isinstance(payload["deleted_at"],str) and payload["deleted_at"] and payload["confirm"]=="purge"):
                return {"id":key}
            raise ValueError("missing archive item")
        stamp = row["deleted_at"]
        if action=="move":
            if set(payload)!={"kind","id"}:
                raise ValueError("move fields")
            stamp = stamp or db.now()
            c.execute(f"UPDATE {table} SET deleted_at=? WHERE {column}=?", (stamp,key))
            return {"id":key,"deleted_at":stamp}
        if not stamp or stamp!=payload.get("deleted_at"):
            raise ValueError("stale bin item")
        if action=="restore":
            if set(payload)!={"kind","id","deleted_at"} or (kind=="photo" and
                    c.execute("SELECT 1 FROM photo_purges WHERE photo_id=?", (key,)).fetchone()):
                raise ValueError("restore unavailable")
            c.execute(f"UPDATE {table} SET deleted_at=NULL WHERE {column}=?", (key,))
            return {"id":key}
        if action!="purge" or set(payload)!={"kind","id","deleted_at","confirm"} or payload["confirm"]!="purge":
            raise ValueError("purge confirmation")
        prepare_purge(c,root,kind,key,row,stamp)
    if kind=="photo":
        finish_photo(c,root,key,stamp)
    return {"id":key}


def prepare_purge(c,root,kind,key,row,stamp):
    if kind=="entry" and c.execute("SELECT 1 FROM sources WHERE source_id=? AND kind='diary_docx'",
                                   (row["source_id"],)).fetchone():
        raise ValueError("historical paragraphs protected")
    affected = {"entry":("entry","quote","photo_link"),"photo":("photo","photo_link"),"photo_set":("photo_set",)}
    for seq in affected[kind]:
        importer.reserve(c,seq,importer.sequence_floor(c,seq))
    if kind=="photo":
        imported_copy(c,root,row)
        c.execute("INSERT OR IGNORE INTO photo_purges VALUES(?,?)", (key,stamp))
    elif kind=="entry":
        retire_receipts(c,kind,key)
        for relation in ("entry_photo_links","entry_ai_links","curation_dismissals","quotes"):
            c.execute(f"DELETE FROM {relation} WHERE entry_id=?", (key,))
        c.execute("DELETE FROM entries WHERE entry_id=?", (key,))
        drop_unused_source(c,row["source_id"])
    else:
        retire_receipts(c,kind,key)
        c.execute("DELETE FROM photo_set_items WHERE set_id=?", (key,))
        c.execute("DELETE FROM photo_sets WHERE set_id=?", (key,))

def batch(c, root, action, payload):
    pending = []
    with db.transaction(c):
        if action == "move-batch":
            if set(payload) != {"items"} or not isinstance(payload["items"], list) or not payload["items"]:
                raise ValueError("empty batch")
            seen = set()
            stamp = db.now()
            for item in payload["items"]:
                if not isinstance(item, dict) or set(item) != {"kind","id"}:
                    raise ValueError("archive item")
                kind, key = item["kind"], item["id"]
                if kind not in ITEMS or not isinstance(key,str) or not key or (kind,key) in seen:
                    raise ValueError("invalid batch")
                seen.add((kind,key))
                table, column, _ = ITEMS[kind]
                updated = c.execute(f"UPDATE {table} SET deleted_at=COALESCE(deleted_at,?) WHERE {column}=? AND dataset_scope=?",
                                    (stamp,key,c.scope))
                if updated.rowcount != 1:
                    raise ValueError("missing archive item")
            return {"moved":len(seen)}
        if action not in ("restore-all","purge-all") or payload != {"confirm":action}:
            raise ValueError("batch confirmation")
        items = contents(c)
        skipped = 0
        for item in items:
            kind, key = item["kind"], item["id"]
            table, column, _ = ITEMS[kind]
            if action == "restore-all":
                if item["purging"]:
                    skipped += 1
                else:
                    c.execute(f"UPDATE {table} SET deleted_at=NULL WHERE {column}=?",(key,))
            else:
                row = c.execute(f"SELECT * FROM {table} WHERE {column}=?",(key,)).fetchone()
                prepare_purge(c,root,kind,key,row,item["deleted_at"])
                if kind == "photo":
                    pending.append((key,item["deleted_at"]))
        if action == "restore-all":
            return {"restored":len(items)-skipped,"skipped":skipped}
    for key, stamp in pending:
        finish_photo(c,root,key,stamp)
    return {"purged":len(items)}

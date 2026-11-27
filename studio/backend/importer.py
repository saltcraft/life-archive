"""Atomic archive curation. A receipt and its changes commit in the same transaction."""
from datetime import date
import re

from .db import digest, encoded, now, transaction

LABEL = "虚构测试资料"


# BEGIN IMMEDIATE serializes allocation and insertion across SQLite connections.
SEQUENCES = {"entry":("entries","entry_id","F",3), "quote":("quotes","quote_id","FQ",3),
             "response":("ai_responses","response_id","FR",2), "photo":("photos","photo_id","FP",2),
             "photo_set":("photo_sets","set_id","FS",2), "photo_link":("entry_photo_links","link_id","FL",2),
             "job":("import_jobs","job_id","JOB",3)}


PERSONAL_IDS = {"entry": ("J", 3), "response": ("A", 2), "quote": ("Q", 3),
                "photo": ("P", 3), "photo_set": ("S", 3), "photo_link": ("L", 3)}


def id_format(c, kind):
    if c.scope == "personal" and kind in PERSONAL_IDS:
        return PERSONAL_IDS[kind]
    return SEQUENCES[kind][2:]


def sequence_floor(c, kind):
    if not c.in_transaction:
        raise RuntimeError("sequence requires a write transaction")
    table, column, _, _ = SEQUENCES[kind]
    prefix, _ = id_format(c, kind)
    existing = [r[0] for r in c.execute(f"SELECT {column} FROM {table}")]
    numbers = [int(key[len(prefix):]) for key in existing if re.fullmatch(prefix + r"[0-9]+", key)]
    # Seed quotes predate the FQ sequence and keep their public, paragraph-linked identifiers.
    baseline = sum(bool(re.fullmatch(r"F[0-9]+-Q[0-9]+", k)) for k in existing) if kind == "quote" else 0
    saved = c.execute("SELECT last_number FROM entity_sequences WHERE kind=?", (kind,)).fetchone()
    return max([saved[0] if saved else 0, baseline, *numbers])


def reserve(c, kind, number):
    c.execute("""INSERT INTO entity_sequences VALUES(?,?) ON CONFLICT(kind) DO UPDATE
                 SET last_number=max(last_number,excluded.last_number)""", (kind,number))


def next_id(c, kind):
    prefix, width = id_format(c, kind)
    number = sequence_floor(c, kind) + 1
    reserve(c, kind, number)
    return prefix + str(number).zfill(width)


def require_active(c, kind, key):
    table, column, _, _ = SEQUENCES[kind]
    if not c.execute(f"SELECT 1 FROM {table} WHERE {column}=? AND deleted_at IS NULL", (key,)).fetchone():
        raise ValueError("unavailable archive item")


def text_value(p, name):
    v = p[name]
    if not isinstance(v, str) or not v.strip():
        raise ValueError(name)
    return v


def add_entry(c, p, key, stamp):
    title = text_value(p, "title_raw")
    date.fromisoformat(text_value(p, "entry_date"))
    lines = p["paragraphs"]
    if not isinstance(lines, list) or not all(isinstance(t, str) for t in lines) or not any(t.strip() for t in lines):
        raise ValueError("paragraphs")
    source = key + "-source"
    c.execute("INSERT INTO sources VALUES(?,?,'manual_entry',NULL,?,1,?)", (source, c.scope, digest(encoded(p)), stamp))
    c.execute("INSERT INTO entries(entry_id,dataset_scope,title_raw,entry_date,written_time_raw,backfill_note,source_id,para_start,para_end,created_at) VALUES(?,?,?,?,?,?,?,NULL,NULL,?)",
              (key,c.scope,title,p["entry_date"],p.get("written_time_raw"),p.get("backfill_note"),source,stamp))
    c.executemany("INSERT INTO paragraphs VALUES(?,?,?,?,?,?,?)",
                  [(f"{key}-P{i}",key,i,None,t,int(not t.strip()),t[:len(t)-len(t.lstrip())])
                   for i,t in enumerate(lines,1)])
    c.execute("INSERT INTO entry_ai_links VALUES(?,?,NULL,'unverified',NULL)", (key+"-status",key))


def add_quote(c, p, key, stamp):
    require_active(c,"entry",p["entry_id"])
    row = c.execute("SELECT text_raw FROM paragraphs WHERE entry_id=? AND para_id=?", (p["entry_id"],p["para_id"])).fetchone()
    a,b = p["char_start"],p["char_end"]
    if not row or type(a) != int or type(b) != int or not 0 <= a < b <= len(row[0]):
        raise ValueError("quote location")
    c.execute("INSERT INTO quotes VALUES(?,?,?,?,?,?,?,NULL,?)",
              (key,p["entry_id"],p["para_id"],a,b,row[0][a:b],p["status"],stamp))


def add_response(c, p, key, stamp):
    blocks = p["blocks"]
    if not isinstance(blocks,list) or not blocks or any(not isinstance(b,dict) or b.get("type") not in
            ("paragraph","user_followup","bullet","table","rule","gap_notice") for b in blocks):
        raise ValueError("response structure")
    entries = p["entry_ids"]
    if not isinstance(entries,list) or not entries or len(set(entries)) != len(entries):
        raise ValueError("entry links")
    source = key + "-source"
    c.execute("INSERT INTO sources VALUES(?,?,'manual_entry',NULL,?,1,?)", (source,c.scope,digest(encoded(p)),stamp))
    c.execute("INSERT INTO ai_responses VALUES(?,?,?,?,?,NULL,NULL,?,?)",
              (key,c.scope,text_value(p,"title_raw"),p.get("response_date"),source,encoded(blocks).decode(),stamp))
    for entry in entries:
        require_active(c,"entry",entry)
        c.execute("DELETE FROM entry_ai_links WHERE entry_id=? AND response_id IS NULL", (entry,))
        c.execute("INSERT INTO entry_ai_links VALUES(?,?,?,'linked',NULL)", (key+":"+entry,entry,key))


def add_set(c, p, key, stamp):
    ids = p["photo_ids"]
    if not isinstance(ids,list) or not ids or len(set(ids)) != len(ids):
        raise ValueError("photo order")
    for photo_id in ids:
        require_active(c,"photo",photo_id)
    c.execute("INSERT INTO photo_sets(set_id,dataset_scope,title_raw,date_hint,set_note_raw,set_note_written_at,created_at) VALUES(?,?,?,?,?,?,?)",
              (key,c.scope,p.get("title_raw"),p.get("date_hint"),p.get("set_note_raw"),p.get("set_note_written_at"),stamp))
    c.executemany("INSERT INTO photo_set_items VALUES(?,?,?)", [(key,k,i) for i,k in enumerate(ids,1)])


def photo_link(c, p, key, stamp):
    require_active(c,"entry",p["entry_id"])
    require_active(c,"photo",p["photo_id"])
    confirmed = p["confirmed_by_user"]
    if type(confirmed) != bool:
        raise ValueError("confirmation")
    previous = c.execute("""SELECT link_id FROM entry_photo_links WHERE entry_id=? AND photo_id=?
                          AND placement=? AND anchor_para_id IS ?""",
                         (p["entry_id"],p["photo_id"],p["placement"],p.get("anchor_para_id"))).fetchone()
    if previous:
        c.execute("UPDATE entry_photo_links SET confirmed_by_user=?,confirmed_at=? WHERE link_id=?",
                  (confirmed,stamp if confirmed else None,previous[0]))
        return previous[0]
    c.execute("INSERT INTO entry_photo_links VALUES(?,?,?,?,?,?,?)",
              (key,p["entry_id"],p["photo_id"],p["placement"],p.get("anchor_para_id"),confirmed,stamp if confirmed else None))


def confirm_quote(c, p, key, stamp):
    if c.execute("UPDATE quotes SET status='user_confirmed' WHERE quote_id=? AND status!='archived' AND entry_id IN (SELECT entry_id FROM entries WHERE deleted_at IS NULL)", (p["quote_id"],)).rowcount != 1:
        raise ValueError("quote")
    return p["quote_id"]


def archive_quote(c, p, key, stamp):
    if not isinstance(p.get("quote_id"), str) or not p["quote_id"]:
        raise ValueError("quote id")
    changed = c.execute("""UPDATE quotes SET status='archived'
                        WHERE quote_id=? AND status='user_confirmed' AND entry_id IN
                        (SELECT entry_id FROM entries WHERE dataset_scope=? AND deleted_at IS NULL)""",
                        (p["quote_id"], c.scope))
    if changed.rowcount != 1:
        raise ValueError("inactive quote")
    return p["quote_id"]


def reminder(c, p, key, stamp):
    entry, kind = p["entry_id"], p["dismiss_kind"]
    if kind not in ("no_quote_ok", "no_ai_ok") or type(p["dismissed"]) != bool:
        raise ValueError("reminder")
    require_active(c,"entry",entry)
    if p["dismissed"]:
        c.execute("INSERT OR IGNORE INTO curation_dismissals VALUES(?,?,?)", (entry,kind,stamp))
    else:
        c.execute("DELETE FROM curation_dismissals WHERE entry_id=? AND dismiss_kind=?", (entry,kind))
    return entry


def submit(c, token, p):
    if not isinstance(token,str) or not 0 < len(token.strip()) <= 200 or p.get("label") != (LABEL if c.scope == "fixture" else None):
        raise ValueError("workspace import")
    handlers = {"entry":add_entry,"quote":add_quote,"response":add_response,"photo_set":add_set,
                "photo_link":photo_link,"confirm_quote":confirm_quote,"archive_quote":archive_quote,"reminder":reminder}
    handler = handlers[p["kind"]]
    fingerprint = digest(encoded(p))
    with transaction(c):
        previous = c.execute("SELECT * FROM import_jobs WHERE idempotency_key=?", (token,)).fetchone()
        if previous:
            if previous["payload_sha256"] != fingerprint or previous["status"]!="committed":
                raise ValueError("idempotency conflict")
            return previous["result_entity_id"]
        stamp = now()
        job = next_id(c, "job")
        key = next_id(c, p["kind"]) if p["kind"] in SEQUENCES else None
        c.execute("INSERT INTO import_jobs VALUES(?,?,?,'pending',NULL,?,?)", (job,token,fingerprint,stamp,stamp))
        key = handler(c,p,key,stamp) or key
        c.execute("UPDATE import_jobs SET status='committed',result_entity_id=?,updated_at=? WHERE job_id=?", (key,now(),job))
        return key

"""Local SQLite workspaces and guarded archive paths."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat

PROJECT = Path(__file__).resolve().parents[2]
_configured_data = os.environ.get("LIFE_ARCHIVE_DATA_DIR")
DATA = Path(_configured_data).expanduser().resolve() if _configured_data else PROJECT / "data"
LIVE = DATA / "fixture"
DEMO = DATA / "demo" / "fixture"
PERSONAL = DATA / "personal"
SCHEMA = Path(__file__).with_name("schema.sql")
BASE_TABLES = ("sources", "entries", "paragraphs", "quotes", "ai_responses", "entry_ai_links",
          "photos", "photo_sets", "photo_set_items", "entry_photo_links", "curation_dismissals", "import_jobs")

TABLES = (*BASE_TABLES, "entity_sequences", "photo_purges")
VERSION = 3


class ArchiveConnection(sqlite3.Connection):
    scope: str


def local(path):
    path = Path(path).absolute()
    if not path.is_relative_to(DATA) or ".." in path.parts:
        raise ValueError("storage boundary")
    for part in (*reversed(path.parents), path):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if (part.is_symlink() or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
                or (stat.S_ISREG(info.st_mode) and info.st_nlink != 1)):
            raise ValueError("linked storage")
    return path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def now():
    return datetime.now(timezone.utc).isoformat()


def workspace_scope(root):
    root = local(root)
    available = [scope for scope in ("personal", "fixture")
                 if local(root / f"{scope}.sqlite").is_file()]
    if len(available) > 1:
        raise ValueError("ambiguous workspace")
    if root == PERSONAL:
        if available and available != ["personal"]:
            raise ValueError("workspace scope")
        return "personal"
    return available[0] if available else "fixture"


def connect(root=None, *, create=False, scope=None):
    root = local(LIVE if root is None else root)
    actual = workspace_scope(root)
    if scope is None:
        scope = actual
    elif scope not in ("personal", "fixture") or (scope != actual and (
            root == PERSONAL or (root / f"{actual}.sqlite").exists())):
        raise ValueError("workspace scope")
    path = local(root / (scope + ".sqlite"))
    for suffix in ("-wal", "-shm", "-journal"):
        local(str(path) + suffix)
    if create:
        root.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path.as_uri() + ("?mode=rwc" if create else "?mode=rw"), uri=True,
                          timeout=15, isolation_level=None, factory=ArchiveConnection)
    con.scope = scope
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA foreign_keys=ON")
        version = con.execute("PRAGMA user_version").fetchone()[0]
        if version == 0 and create:
            con.executescript(SCHEMA.read_text(encoding="utf-8"))
            version = con.execute("PRAGMA user_version").fetchone()[0]
        if version in (1, 2):
            migrate(con)
        elif version != VERSION:
            raise ValueError("schema version")
        return con
    except BaseException:
        con.close()
        raise


@contextmanager
def transaction(con):
    con.execute("BEGIN IMMEDIATE")
    try:
        yield
        con.commit()
    except BaseException:
        con.rollback()
        raise


def migrate(con):
    # Rebuild the parent table under a single write lock. Child FK declarations keep
    # their original target; checking them before commit catches a broken migration.
    con.execute("PRAGMA foreign_keys=OFF")
    try:
        with transaction(con):
            version = con.execute("PRAGMA user_version").fetchone()[0]
            if version == VERSION:
                return
            if version == 1:
                for table in ("entries", "photos", "photo_sets"):
                    con.execute(f"ALTER TABLE {table} ADD COLUMN deleted_at TEXT")
                con.execute("CREATE TABLE entity_sequences (kind TEXT PRIMARY KEY NOT NULL, last_number INTEGER NOT NULL)")
                con.execute("""CREATE TABLE photo_purges (photo_id TEXT PRIMARY KEY NOT NULL
                               REFERENCES photos(photo_id) ON DELETE CASCADE, deleted_at TEXT NOT NULL)""")
            schema = SCHEMA.read_text(encoding="utf-8")
            definition = schema.split("CREATE TABLE IF NOT EXISTS sources (", 1)[1].split(");", 1)[0]
            con.execute("CREATE TABLE new_sources (" + definition + ")")
            con.execute("INSERT INTO new_sources SELECT * FROM sources")
            con.execute("DROP TABLE sources")
            con.execute("ALTER TABLE new_sources RENAME TO sources")
            if con.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("migration foreign keys")
            con.execute(f"PRAGMA user_version={VERSION}")
    finally:
        con.execute("PRAGMA foreign_keys=ON")


def rows(con, sql, args=()):
    return [dict(row) for row in con.execute(sql, args)]


def detail(con, entry):
    data = rows(con, "SELECT * FROM entries WHERE entry_id=? AND deleted_at IS NULL", (entry,))
    if not data:
        raise KeyError(entry)
    return dict(data[0], paragraphs=rows(con, "SELECT * FROM paragraphs WHERE entry_id=? ORDER BY seq_no", (entry,)),
                photos=rows(con, """SELECT p.*,l.placement,l.anchor_para_id FROM entry_photo_links l
                           JOIN photos p USING(photo_id) WHERE entry_id=? AND p.deleted_at IS NULL AND confirmed_by_user=1 ORDER BY l.link_id""", (entry,)),
                links=rows(con, "SELECT * FROM entry_ai_links WHERE entry_id=?", (entry,)))


def search(con, phrase):
    return rows(con, """SELECT entry_id,para_id,seq_no FROM paragraphs JOIN entries USING(entry_id)
                WHERE deleted_at IS NULL AND instr(text_raw,?)>0 ORDER BY entry_id,seq_no""", (phrase,)) if phrase else []

def media_path(root, rel):
    """Preserve the original shared media location of the legacy fixture."""
    area = DATA if root == LIVE and rel.startswith("photos_orig/") else root
    return local(area / rel)


def prefs_path(root):
    area = root if workspace_scope(root) == "personal" else DATA if root == LIVE else root.parent
    return local(area / "prefs.json")

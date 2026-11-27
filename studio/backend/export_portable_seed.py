"""Export only a freshly generated fictional archive to stdout as UTF-8 JSON."""
import base64
from contextlib import closing
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

from . import db, fixture_seed


def export():
    area = db.local(db.DATA / "checks")
    area.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=area, prefix="portable-seed-") as directory:
        root = Path(directory)
        fixture_seed.seed(root)
        with closing(db.connect(root)) as con:
            data = {table: db.rows(con, f"SELECT * FROM {table} ORDER BY rowid") for table in db.TABLES}
            for table in ("sources", "entries", "photos", "ai_responses", "photo_sets"):
                if con.execute(f"SELECT 1 FROM {table} WHERE dataset_scope <> 'fixture'").fetchone():
                    raise ValueError("fixture scope")
            for photo in data["photos"]:
                path = db.local(root / photo.pop("derived_rel_path"))
                if path.parent != root / "assets" or path.suffix != ".svg":
                    raise ValueError("fixture image")
                photo["url"] = "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
            for reply in data["ai_responses"]:
                reply["blocks"] = json.loads(reply.pop("blocks_json"))
            return data


if __name__ == "__main__":
    sys.stdout.buffer.write(db.encoded(export()))

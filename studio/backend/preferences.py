"""Local reading preferences shared by the two workspace capabilities."""
import json
import os
from uuid import uuid4

from . import db


DEFAULTS = {"font": 0, "resume": True}


def validate(p):
    if (not isinstance(p, dict) or p.keys() != DEFAULTS.keys()
            or type(p["font"]) is not int or not 0 <= p["font"] <= 3
            or type(p["resume"]) is not bool):
        raise ValueError("reading preferences")
    return p


def read(root):
    path = db.prefs_path(root)
    if not path.exists():
        return DEFAULTS.copy()
    stored = json.loads(path.read_bytes())
    if not isinstance(stored, dict):
        raise ValueError("reading preferences")
    stored.pop("stage_motion", None)
    stored.pop("book_breath", None)
    return validate({**DEFAULTS, **stored})


def write(root, p):
    validate(p)
    path = db.prefs_path(root)
    path.parent.mkdir(exist_ok=True,parents=True)
    temp = db.local(path.with_name("prefs-"+uuid4().hex+".tmp"))
    try:
        with temp.open("xb") as f:
            f.write(db.encoded(p))
            f.flush()
            os.fsync(f.fileno())
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)
    return p

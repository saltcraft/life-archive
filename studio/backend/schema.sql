PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS sources (
 source_id TEXT PRIMARY KEY NOT NULL, dataset_scope TEXT NOT NULL CHECK(dataset_scope IN ('fixture','personal')),
 kind TEXT NOT NULL CHECK(kind IN ('diary_docx','ai_docx','photo_orig','manual_entry','fixture_asset')),
 rel_path TEXT, sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 readonly_flag INTEGER NOT NULL DEFAULT 1 CHECK(readonly_flag IN (0,1)), registered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
 entry_id TEXT PRIMARY KEY NOT NULL, dataset_scope TEXT NOT NULL, title_raw TEXT NOT NULL,
 entry_date TEXT NOT NULL, written_time_raw TEXT, backfill_note TEXT,
 source_id TEXT REFERENCES sources, para_start INTEGER, para_end INTEGER, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS paragraphs (
 para_id TEXT PRIMARY KEY NOT NULL, entry_id TEXT NOT NULL REFERENCES entries ON DELETE CASCADE,
 seq_no INTEGER NOT NULL CHECK(seq_no>0), source_para_idx INTEGER, text_raw TEXT NOT NULL,
 is_blank INTEGER NOT NULL DEFAULT 0 CHECK(is_blank IN (0,1)), indent_raw TEXT DEFAULT '',
 UNIQUE(entry_id,seq_no), UNIQUE(entry_id,para_id)
);
CREATE TABLE IF NOT EXISTS quotes (
 quote_id TEXT PRIMARY KEY NOT NULL, entry_id TEXT NOT NULL REFERENCES entries ON DELETE CASCADE,
 para_id TEXT NOT NULL REFERENCES paragraphs, char_start INTEGER NOT NULL CHECK(char_start>=0),
 char_end INTEGER NOT NULL CHECK(char_end>char_start), quote_text TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ai_candidate','user_confirmed','archived')),
 weight_override REAL CHECK(weight_override>0), created_at TEXT NOT NULL,
 FOREIGN KEY(entry_id,para_id) REFERENCES paragraphs(entry_id,para_id)
);
CREATE TABLE IF NOT EXISTS ai_responses (
 response_id TEXT PRIMARY KEY NOT NULL, dataset_scope TEXT NOT NULL, title_raw TEXT NOT NULL,
 response_date TEXT, source_id TEXT REFERENCES sources, para_start INTEGER, para_end INTEGER,
 blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entry_ai_links (
 link_id TEXT PRIMARY KEY NOT NULL, entry_id TEXT REFERENCES entries, response_id TEXT REFERENCES ai_responses,
 link_status TEXT NOT NULL CHECK(link_status IN ('linked','confirmed_none','pending_add','unverified','orphan_missing_input','unopened_scope')),
 note TEXT, UNIQUE(entry_id,response_id),
 CHECK((link_status='linked' AND entry_id IS NOT NULL AND response_id IS NOT NULL)
 OR (link_status='orphan_missing_input' AND entry_id IS NULL AND response_id IS NOT NULL)
 OR (link_status NOT IN ('linked','orphan_missing_input') AND entry_id IS NOT NULL AND response_id IS NULL))
);
CREATE TABLE IF NOT EXISTS photos (
 photo_id TEXT PRIMARY KEY NOT NULL, dataset_scope TEXT NOT NULL, orig_source_id TEXT REFERENCES sources,
 derived_rel_path TEXT, derived_ops_json TEXT, width INTEGER CHECK(width>0), height INTEGER CHECK(height>0),
 has_inner_margin INTEGER DEFAULT 0 CHECK(has_inner_margin IN (0,1)), taken_date_raw TEXT,
 date_precision TEXT NOT NULL CHECK(date_precision IN ('exact','month','year','unknown')), caption_raw TEXT, caption_written_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS photo_sets (
 set_id TEXT PRIMARY KEY NOT NULL, dataset_scope TEXT NOT NULL, title_raw TEXT, date_hint TEXT,
 set_note_raw TEXT, set_note_written_at TEXT, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS photo_set_items (
 set_id TEXT NOT NULL REFERENCES photo_sets, photo_id TEXT NOT NULL REFERENCES photos,
 item_order INTEGER NOT NULL CHECK(item_order>0), PRIMARY KEY(set_id,photo_id), UNIQUE(set_id,item_order)
);
CREATE TABLE IF NOT EXISTS entry_photo_links (
 link_id TEXT PRIMARY KEY NOT NULL, entry_id TEXT NOT NULL REFERENCES entries, photo_id TEXT NOT NULL REFERENCES photos,
 placement TEXT NOT NULL CHECK(placement IN ('entry_level','hero_before_text','after_paragraph')),
 anchor_para_id TEXT REFERENCES paragraphs, confirmed_by_user INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_by_user IN (0,1)),
 confirmed_at TEXT, FOREIGN KEY(entry_id,anchor_para_id) REFERENCES paragraphs(entry_id,para_id),
 CHECK((placement='after_paragraph')=(anchor_para_id IS NOT NULL)), CHECK(confirmed_by_user=0 OR confirmed_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS curation_dismissals (
 entry_id TEXT NOT NULL REFERENCES entries, dismiss_kind TEXT NOT NULL CHECK(dismiss_kind IN ('no_quote_ok','no_ai_ok')),
 dismissed_at TEXT NOT NULL, PRIMARY KEY(entry_id,dismiss_kind)
);
CREATE TABLE IF NOT EXISTS import_jobs (
 job_id TEXT PRIMARY KEY NOT NULL, idempotency_key TEXT UNIQUE NOT NULL, payload_sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','committed','failed')), result_entity_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_sequences (kind TEXT PRIMARY KEY NOT NULL, last_number INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS photo_purges (
 photo_id TEXT PRIMARY KEY NOT NULL REFERENCES photos(photo_id) ON DELETE CASCADE, deleted_at TEXT NOT NULL
);
PRAGMA user_version = 3;
COMMIT;

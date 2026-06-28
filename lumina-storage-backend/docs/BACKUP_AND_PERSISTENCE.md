# Backup & Persistence Runbook

Scope: production data that must survive a host failure or an operator mistake.

## What lives where

| Store           | Contents                                  | RPO (target) | RTO (target) |
| --------------- | ----------------------------------------- | ------------ | ------------ |
| PostgreSQL      | Users, documents, folders, chats, jobs    | 5 min        | 30 min       |
| Qdrant          | Document chunk embeddings (vectors)       | 24 h         | 2 h          |
| Redis (ARQ)     | Pending/in-flight job queue + cron locks  | <1 s         | n/a          |
| Storage backend | Uploaded source files (local / S3 / GDrive) | depends    | depends      |

## Redis — pending jobs

The compose file now starts redis with `--appendonly yes --appendfsync everysec`.
That gives at most ~1 second of lost work on a hard restart, vs. the previous
"all queued jobs disappear" failure mode.

For HA proper you want Redis Sentinel or Redis Cluster — that's an infra change,
not a code change. Sketch:
- 1 primary + 2 replicas
- 3 sentinels (quorum = 2) for failover
- Update `REDIS_HOST` to the sentinel-aware client URL

Until then, AOF is the cheap durability win.

## PostgreSQL — daily logical + WAL archive

Two layers:

1. **Daily logical backup** (cheap, simple restore)
   ```bash
   pg_dump --format=custom --no-acl --no-owner \
       --dbname="$DATABASE_URL" \
       --file=/backups/lumina-$(date +%F).dump
   ```
   Retention: 14 days local + push to S3 (or any object store) with lifecycle.

2. **Continuous WAL archive** (small RPO when you need it)
   - `archive_mode = on`
   - `archive_command = 'aws s3 cp %p s3://bucket/wal/%f'`
   - Combined with a weekly base backup (`pg_basebackup`), you can do PITR.

Restore drill (run quarterly):
```bash
pg_restore --clean --if-exists --no-owner \
    --dbname="$STAGING_URL" /backups/lumina-YYYY-MM-DD.dump
```

## Qdrant — snapshots

Qdrant supports server-side snapshots per collection:

```bash
curl -X POST "$QDRANT_URL/collections/$QDRANT_COLLECTION/snapshots"
```

Push the resulting tarball to the same backup bucket. Embeddings are
re-derivable from source files, so this is "nice to have" — when it's missing,
re-ingest from `documents_document` rows is the cold path.

Cron suggestion: weekly snapshot + retain 4.

## Storage backend

- **Local volume**: `./uploads` is volume-mounted into both `app` and `worker`.
  Back the host volume with the rest of the disk backup. If the storage backend
  is the LocalStorage path on the same host, you're trading durability for
  simplicity; switch to S3 when this becomes load-bearing.
- **S3**: enable bucket versioning; set a lifecycle to expire delete markers
  after 30 days. The application uses soft-delete for documents, so deletes
  here should be rare.
- **GDrive**: relies on Google's durability — no extra action needed.

## What's NOT backed up

- The `.venv` (rebuilt from `uv.lock`)
- Skills marketplace cache (re-syncable from MCP)
- Langfuse traces (separate Langfuse instance — owns its own backup)

## Verifying a backup

A backup is only real if you've restored from it once. Add this to the rotation:

1. Every quarter, restore the latest `pg_dump` into a staging DB.
2. Run `alembic upgrade head` against it.
3. Boot the app pointed at staging + the matching Qdrant snapshot.
4. Smoke test: log in, list documents, do a RAG search.

If any of those fail, the backup is dead and we need to fix it before the
next outage forces us to find out.

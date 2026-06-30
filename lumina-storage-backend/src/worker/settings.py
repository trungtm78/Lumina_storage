import logging

from arq.connections import RedisSettings
from arq.cron import cron

from src.core.config import get_settings

from src.core.logging import configure_worker_logging
configure_worker_logging()  # Phase 8 T3: log worker gắn request_id (correlation propagate)
from src.worker.context import shutdown, startup
from src.worker.tasks.agent_state_cleanup import cleanup_agent_state_task
from src.worker.tasks.demo import long_running_task, ping_task
from src.worker.tasks.document import cleanup_deleted_document_task, extract_template_task, extract_template_draft_task, ingest_document_task
from src.worker.tasks.reconcile import reconcile_stale_tasks
from src.worker.tasks.skill_cleanup import cleanup_skill_temp_task
from src.worker.tasks.thumbnail import generate_thumbnail_task

_settings = get_settings()


class WorkerSettings:
    functions = [
        ping_task,
        long_running_task,
        ingest_document_task,
        generate_thumbnail_task,
        cleanup_deleted_document_task,
        extract_template_task,
        extract_template_draft_task,
        cleanup_skill_temp_task,
        cleanup_agent_state_task,
        reconcile_stale_tasks,
    ]
    cron_jobs = [
        # Run daily at 03:15 UTC — strip stale agent skill_state to keep JSONB lean
        cron(cleanup_agent_state_task, hour=3, minute=15, run_at_startup=False),
        # Run hourly at :05 — purge skill temp files older than 24h
        cron(cleanup_skill_temp_task, minute=5, run_at_startup=False),
        # Phase 8 T2 — DLQ: mỗi 15' gỡ BackgroundTask kẹt 'running' do worker crash.
        cron(reconcile_stale_tasks, minute={0, 15, 30, 45}, run_at_startup=False),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
    max_jobs = 20
    job_timeout = 1800  # 30 minutes — đủ cho file xlsx lớn (3000+ chunks)
    retry_jobs = True
    max_tries = 3
    keep_result = 3600  # giữ kết quả 1 giờ để debug
    health_check_interval = 30

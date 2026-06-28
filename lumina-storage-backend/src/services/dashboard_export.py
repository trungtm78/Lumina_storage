"""HTML report builder for dashboard PDF export."""
from __future__ import annotations

import html as html_lib
from datetime import datetime, timezone


def _esc(text: str | None) -> str:
    return html_lib.escape(str(text or ""), quote=True)


def _fmt_bytes(n: int) -> str:
    if n >= 1_073_741_824:
        return f"{n / 1_073_741_824:.1f} GB"
    if n >= 1_048_576:
        return f"{n / 1_048_576:.1f} MB"
    if n >= 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n} B"


def _status_color(status: str) -> str:
    return {
        "running": "#d97706",
        "pending": "#6b7280",
        "success": "#16a34a",
        "failure": "#dc2626",
        "revoked": "#9ca3af",
    }.get(status, "#6b7280")


def _status_label(status: str) -> str:
    return {
        "running": "Processing",
        "pending": "Queued",
        "success": "Completed",
        "failure": "Failed",
        "revoked": "Revoked",
    }.get(status, status)


def build_dashboard_report_html(
    stats: dict,
    recent_files: list[dict],
    processing_data: list[dict],
    shared_files: list[dict],
    user_name: str,
) -> str:
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    storage = stats.get("storage", {})
    used_bytes: int = storage.get("used_bytes", 0)
    max_gb: int = storage.get("max_gb", 100)
    used_gb = used_bytes / 1_073_741_824
    pct = min(100, round(used_gb / max_gb * 100)) if max_gb else 0
    breakdown = storage.get("breakdown", {})

    processing = stats.get("processing", {})
    shared = stats.get("shared", {})
    documents = stats.get("documents", {})
    activity = stats.get("activity", {})

    # ── stat card helper ───────────────────────────────────────────────────────
    def stat_card(label: str, value: str, sub: str, color: str) -> str:
        return f"""
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;flex:1;min-width:160px;">
          <p style="margin:0 0 4px;font-size:11px;color:#6b7280;font-weight:500;">{_esc(label)}</p>
          <p style="margin:0 0 2px;font-size:22px;font-weight:700;color:{color};">{_esc(value)}</p>
          <p style="margin:0;font-size:10px;color:#9ca3af;">{_esc(sub)}</p>
        </div>"""

    # ── breakdown bar ──────────────────────────────────────────────────────────
    def breakdown_item(label: str, bytes_val: int, color: str) -> str:
        p = round(bytes_val / used_bytes * 100) if used_bytes > 0 else 0
        return f"""
        <div style="flex:1;min-width:120px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <div style="width:8px;height:8px;border-radius:50%;background:{color};flex-shrink:0;"></div>
            <span style="font-size:10px;color:#6b7280;">{_esc(label)}</span>
          </div>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#111827;">{_fmt_bytes(bytes_val)}</p>
          <div style="height:4px;background:#f3f4f6;border-radius:4px;">
            <div style="height:4px;background:{color};border-radius:4px;width:{p}%;"></div>
          </div>
        </div>"""

    # ── table helpers ──────────────────────────────────────────────────────────
    def table_header(*cols: str) -> str:
        cells = "".join(
            f'<th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:600;'
            f'text-transform:uppercase;letter-spacing:.05em;color:#6b7280;">{_esc(c)}</th>'
            for c in cols
        )
        return f'<tr style="border-bottom:1px solid #f3f4f6;background:#f9fafb;">{cells}</tr>'

    def table_row(*cells: str, last: bool = False) -> str:
        border = "" if last else "border-bottom:1px solid #f9fafb;"
        tds = "".join(
            f'<td style="padding:9px 12px;font-size:12px;color:#374151;{border}">{c}</td>'
            for c in cells
        )
        return f"<tr>{tds}</tr>"

    # ── recent files rows ──────────────────────────────────────────────────────
    recent_rows = ""
    for i, f in enumerate(recent_files):
        ext = _esc((f.get("extension") or "").upper().lstrip("."))
        recent_rows += table_row(
            _esc(f.get("title", "—")),
            ext or "—",
            _esc(f.get("owner_name") or "—"),
            _esc(f.get("updated_at", "")[:10]),
            last=(i == len(recent_files) - 1),
        )

    # ── processing rows ────────────────────────────────────────────────────────
    proc_rows = ""
    for i, f in enumerate(processing_data):
        status = f.get("status", "")
        badge = (
            f'<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
            f'font-size:10px;font-weight:600;color:{_status_color(status)};'
            f'background:{_status_color(status)}1a;">{_status_label(status)}</span>'
        )
        proc_rows += table_row(
            _esc(f.get("file_name", "—")),
            _esc((f.get("extension") or "").upper().lstrip(".") or "—"),
            badge,
            _esc(f.get("created_at", "")[:10]),
            last=(i == len(processing_data) - 1),
        )

    # ── shared files rows ──────────────────────────────────────────────────────
    shared_rows = ""
    for i, f in enumerate(shared_files):
        ext = _esc((f.get("extension") or "").upper().lstrip("."))
        shared_rows += table_row(
            _esc(f.get("title", "—")),
            ext or "—",
            _esc(f.get("owner_name") or "—"),
            _esc(f.get("updated_at", "")[:10]),
            last=(i == len(shared_files) - 1),
        )

    def section(title: str, body: str) -> str:
        return f"""
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:24px;overflow:hidden;">
          <div style="padding:14px 20px;border-bottom:1px solid #f3f4f6;">
            <p style="margin:0;font-size:14px;font-weight:600;color:#111827;">{_esc(title)}</p>
          </div>
          {body}
        </div>"""

    def table(header_row: str, body_rows: str, empty_msg: str = "No data") -> str:
        inner = body_rows or (
            f'<tr><td colspan="10" style="padding:24px;text-align:center;'
            f'font-size:12px;color:#9ca3af;">{_esc(empty_msg)}</td></tr>'
        )
        return f'<table style="width:100%;border-collapse:collapse;"><thead>{header_row}</thead><tbody>{inner}</tbody></table>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lumina Dashboard Report</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #f8fafc; color: #111827; -webkit-print-color-adjust: exact; }}
  @page {{ margin: 16mm 14mm; }}
</style>
</head>
<body style="padding:32px 36px;">

  <!-- Header -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;">
    <div>
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin-bottom:4px;">Dashboard Report</h1>
      <p style="font-size:12px;color:#6b7280;">Lumina Storage &nbsp;·&nbsp; {_esc(user_name)}</p>
    </div>
    <p style="font-size:11px;color:#9ca3af;text-align:right;margin-top:4px;">{_esc(generated_at)}</p>
  </div>

  <!-- Summary cards -->
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
    {stat_card("Storage Used", f"{used_gb:.1f} GB", f"of {max_gb} GB total · {pct}%", "#3b82f6")}
    {stat_card("Total Documents", str(documents.get("total", 0)), f"+{documents.get('added_this_month', 0)} this month", "#111827")}
    {stat_card("Processing Jobs", str(processing.get("total", 0)), f"{processing.get('processing', 0)} running · {processing.get('failed', 0)} failed", "#d97706")}
    {stat_card("Shared Files", str(shared.get("total", 0)), f"By me: {shared.get('shared_by_me', 0)} · With me: {shared.get('shared_with_me', 0)}", "#8b5cf6")}
    {stat_card("Activity Today", str(activity.get("total_today", 0)), f"↑{activity.get('uploaded_today', 0)} uploaded · 👁 {activity.get('viewed_today', 0)} viewed", "#10b981")}
  </div>

  <!-- Storage breakdown -->
  {section("Storage Breakdown", f"""
    <div style="padding:16px 20px;">
      <div style="height:8px;background:#f3f4f6;border-radius:8px;overflow:hidden;margin-bottom:16px;">
        <div style="height:8px;background:linear-gradient(90deg,#60a5fa,#3b82f6);border-radius:8px;width:{pct}%;"></div>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        {breakdown_item("Documents", breakdown.get("documents_bytes", 0), "#60a5fa")}
        {breakdown_item("Spreadsheets", breakdown.get("spreadsheets_bytes", 0), "#4ade80")}
        {breakdown_item("Presentations", breakdown.get("presentations_bytes", 0), "#fb923c")}
        {breakdown_item("Other", breakdown.get("other_bytes", 0), "#c084fc")}
      </div>
    </div>
  """)}

  <!-- Recent Files -->
  {section(f"Recent Files ({len(recent_files)})", table(
      table_header("Name", "Type", "Owner", "Last Modified"),
      recent_rows,
      "No recent files",
  ))}

  <!-- Processing Data -->
  {section(f"Processing Jobs ({len(processing_data)})", table(
      table_header("File Name", "Type", "Status", "Created"),
      proc_rows,
      "No processing jobs",
  ))}

  <!-- Shared Files -->
  {section(f"Shared Files ({len(shared_files)})", table(
      table_header("Name", "Type", "Shared By", "Last Modified"),
      shared_rows,
      "No shared files",
  ))}

</body>
</html>"""

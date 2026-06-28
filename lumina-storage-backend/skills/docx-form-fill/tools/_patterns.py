"""Shared blank-detection patterns for docx-form-fill skill.

All tools in this skill import patterns from here to stay consistent.
"""

from __future__ import annotations

import re

# ── Primary blank pattern ─────────────────────────────────────────────
# Detects fillable blanks in Vietnamese document templates:
#   {{field_name}}  - placeholder fields
#   ☐ / ☑          - checkboxes
#   [ ]             - bracket checkbox (but NOT [text] or [0])
#   ………… or .....   - dot blanks (3+ chars)
#   ___________     - underscore blanks (3+ chars)
#   -----------     - dash blanks (3+ chars)

BLANK_PAT = re.compile(
    r'(\{\{[\w\s]+\}\})'       # {{field_name}}
    r'|([☐☑])'                 # checkbox characters
    r'|(\[\s*\])'              # [] or [ ] empty brackets
    r'|(\[\*\])'               # [*] checkbox-style
    r'|([.…]{3,})'             # dot/ellipsis blanks
    r'|(_{3,})'                # underscore blanks
    r'|(-{3,})',               # dash blanks
    re.UNICODE,
)

# ── Normalisation patterns (for fuzzy matching in apply_edits) ────────
NORM_BLANK = re.compile(r'[.…_\-]{2,}', re.UNICODE)
NORM_SPACE = re.compile(r'\s+')


def normalise(text: str) -> str:
    """Normalise text for fuzzy blank matching."""
    s = NORM_BLANK.sub('___', text)
    s = NORM_SPACE.sub(' ', s)
    return s.strip()

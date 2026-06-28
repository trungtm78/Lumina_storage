Design a modern "Documents" page for an existing admin system called "Lumina Storage".

## Context

* The system is based on Paperless-ngx (documents, tags, correspondents, document types).
* Current UI already exists for Dashboard and other admin pages.
* We ONLY redesign the "Documents" page.
* Sidebar, header, and global layout MUST remain unchanged.

---

## Important Rule

⚠️ Do NOT redesign the whole app
⚠️ Only redesign the Documents page content area

---

## Goal

Transform the Documents page UX to feel like Google Drive, while keeping all Paperless functionalities.

---

## Existing System Style (MUST MATCH)

* Soft red primary color (#ef4444)
* Clean admin layout
* Rounded cards
* Light shadows
* Spacious layout
* Typography similar to Inter

👉 The new design MUST visually match the existing Lumina UI.

---

## Documents Page Requirements

### 1. Keep Existing Layout

* Keep LEFT SIDEBAR unchanged
* Keep TOP HEADER unchanged

👉 Only redesign the MAIN CONTENT AREA

---

### 2. Replace Current Layout

Current:

* Small document cards
* Top filter buttons (Tags, Correspondent, etc.)

Replace with:

---

## 3. New Layout (Google Drive style)

### A. Top Toolbar

* Search input (large, modern)
* Filter chips (instead of buttons):

  * Tags
  * Correspondent
  * Document Type
  * Date
* View toggle:

  * Grid view
  * Table view
* Upload button (primary red)

---

### B. Document Grid (Default View)

* Large cards (Google Drive style)
* Each card includes:

  * Thumbnail preview
  * File name
  * Created date
  * Tags (chips)

👉 On hover:

* Show actions:

  * Preview
  * Download
  * More (3 dots)

---

### C. Table View (Optional toggle)

Columns:

* Name
* Tags
* Correspondent
* Document Type
* Date

---

### D. Right Side Preview Panel

When user clicks a document:

Open a side panel:

* Document preview (PDF/image)
* Metadata:

  * Tags
  * Correspondent
  * Document Type
  * Date
* Actions:

  * Edit metadata
  * Download
  * Delete

---

## 4. UX Improvements

* Replace old filter buttons → modern filter chips
* Reduce visual clutter
* Add hover interactions
* Add quick preview panel (no page reload)

---

## 5. Performance UX (IMPORTANT)

* Design for large datasets (1000+ documents)
* Fast filtering experience
* Minimal clicks to access metadata

---

## 6. Visual Style

* MUST match Lumina Admin UI
* DO NOT use Google colors
* Use Lumina red tone (#ef4444)
* Background: light gray
* Card radius: 12px
* Soft shadows

---

## Visual References

Use these images:

1. Current Lumina Documents UI (for structure reference)
2. Lumina Admin UI (for visual style)
3. Google Drive UI (for layout & UX inspiration)

---

## Output

Generate:

* Redesigned Documents page ONLY
* Grid view
* Table view
* Right preview panel
* Filter chips system

---

Style direction:
👉 Google Drive UX + Lumina Design System

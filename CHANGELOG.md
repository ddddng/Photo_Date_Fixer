# Changelog

## 1.0.0 — Stable release

- Replaced repeated ExifTool process launches with a persistent, hidden worker
  to improve batch performance and eliminate flashing Windows console windows.
- Added a synthetic-image integration test for consecutive EXIF reads and writes
  using the same ExifTool process.
- Switched application source to GPL-3.0-or-later; documented third-party
  licenses, contribution requirements and privacy expectations.
- Shipped full source, Windows packages and Linux packages with an offline
  ExifTool distribution.

## 0.2.1 — EXIF write preview

- Added EXIF DateTimeOriginal / CreateDate / ModifyDate writes, with
  readback verification and on-device original-file backups for undo.
- Built-in filename rule for `20991231-235959.png`.
- Preserved more precise filesystem modification time only when it agrees
  with the winning date rule.
- Unified result browsing and precision/status filtering.

## 0.1.0 — Initial preview

- First GUI for local media scanning, date matching, rule editing,
  timestamp corrections, filtering and operation history.

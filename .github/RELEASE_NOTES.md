# Photo Date Fixer — Preview

This is an early preview of the offline media timestamp recovery application.

## Included packages

- Windows x64: portable ZIP, NSIS EXE installer, and MSI installer.
- Linux x86-64: AppImage and Debian/Ubuntu DEB package.
- SHA256SUMS.txt: checksums for verifying the downloaded packages.

## Available functionality

- Scan media files without modifying them.
- Match dates from filenames or enclosing date folders.
- Prioritize second, minute, hour, then day precision.
- Inspect match results, unmatched files, and conflicting candidates in a unified filtered workspace.
- Apply changes to the matching selection only, with local undo journals.

## Current limitations

- Embedded EXIF / QuickTime metadata is not yet inspected; files with embedded timestamps may be displayed differently by photo library software.
- Full real-device desktop usability testing is not complete.
- Preview the results and start with copied sample files before processing a full library.

No personal photographs, machine telemetry, or scan reports are bundled with this release.

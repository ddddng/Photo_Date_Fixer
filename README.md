# Photo Date Fixer

An offline GUI tool for reconstructing photo capture dates from filenames and
folder names, then writing the resulting dates into **EXIF metadata**.
Built with Tauri 2, React, TypeScript and Rust.

**Stable release: v1.0.0 — GNU GPL v3 or later.**

## Features

- Recursive read-only scanning of image and video collections.
- Filename and directory parsing rules, with
  **second > minute > hour > day** precision priority.
- Built-in patterns including `20991231-235959.png` and
  `IMG_20200111_143025.jpg`.
- Optional precision refinement from the original modification timestamp
  **only when it agrees with the rule's date/time prefix**, enabled by default.
- Review matched, unmatched and conflicting files with precision filters.
- Write embedded EXIF `DateTimeOriginal`, `CreateDate`, and `ModifyDate`
  to supported images using ExifTool. Existing EXIF dates remain unchanged
  unless the user enables overwriting them.
- **Fast, invisible ExifTool worker**: one persistent process per repair batch
  instead of repeated command launches per photo.
- Preserve the original photo bytes in a private on-device backup before
  writing; restore the original bytes and modification time from the operation
  history.
- Windows portable ZIP, EXE installer and MSI; Linux AppImage and DEB.
- No accounts, photo uploads, telemetry or machine fingerprinting.

## Download

Download the latest stable version from
[GitHub Releases](https://github.com/ddddng/Photo_Date_Fixer/releases).

## Development

Install Node.js, Rust, and your platform's Tauri 2 development dependencies.
ExifTool is required when writing EXIF data. Packaging CI retrieves and
verifies ExifTool before embedding it into installers.

```sh
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

To exercise the persistent Rust ExifTool test with a local installed binary:

```sh
PHOTO_DATE_FIXER_TEST_EXIFTOOL=/usr/bin/exiftool cargo test --manifest-path src-tauri/Cargo.toml persistent_session_writes_and_reads_two_generated_photos
```

The test creates synthetic PNG images rather than using personal photographs.

## Notes

- EXIF writing is supported for common photo formats (JPG/JPEG, PNG, HEIC/HEIF,
  DNG, TIFF and WebP). ExifTool may not be able to modify every image variant.
- MP4/MOV video files use QuickTime metadata instead of EXIF, and are currently
  skipped during writing.
- Undo backs up the **entire original image**, so it needs available disk space.
  Backups and journal files stay on the user's machine.
- For large libraries, use the GUI's preview and try a few synthetic or copied
  files before applying a batch.

## Privacy, contributions and licensing

Do not submit personal photos, local paths, IP addresses, hardware/software
profiles, log files or any information identifying a user into source control.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) and
[SECURITY.md](.github/SECURITY.md) for the contribution and disclosure process.

Photo Date Fixer is distributed under **GPL-3.0-or-later**.
Third-party components retain their licenses: see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
ExifTool is available under the same terms as Perl itself (Artistic or GPL).

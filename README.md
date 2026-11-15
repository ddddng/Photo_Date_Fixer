# Photo Date Fixer

**English** | [简体中文](README.zh-CN.md)

Photo Date Fixer is an offline desktop application that reconstructs capture
dates from photo filenames and folders, then writes the chosen dates into
embedded **EXIF metadata**. It uses Tauri 2, React, TypeScript and Rust.

[Download the latest release](https://github.com/ddddng/Photo_Date_Fixer/releases)
· **GPL-3.0-or-later** · Windows and Linux

## Features

- **Four-level precision:** second → minute → hour → day. More precise dates
  always win; rules of equal precision use their explicit priorities.
- **Built-in filename patterns:** for example `20991231-235959.png`,
  `IMG_20200111_143025.jpg`, and folders named `YYYY-MM-DD`.
- **Modification-time refinement:** when the original file modification time
  agrees with a matched date at its known precision, use its finer time
  fields. This option is enabled by default.
- **Preview before writing:** filter by precision, matching status and name,
  inspect all candidates, and review unmatched or conflicting files.
- **Real EXIF writing:** writes `DateTimeOriginal`, `CreateDate`, and
  `ModifyDate` into supported images. An existing capture date is preserved
  by default unless overwriting is explicitly enabled.
- **Full undo:** the original image bytes are saved locally before editing;
  undo restores the original bytes and file modification time with verification.
- **Parallel EXIF processing:** a configurable pool of 1–8 workers, each
  reusing its own hidden ExifTool process. The default is 4. This removes
  the previous one-file-at-a-time bottleneck without skipping backups or
  verification. Real throughput varies with file size, format and storage.
- **English and 简体中文 interface:** English is the initial language; switch
  languages in the sidebar. The choice is saved locally on this device.
- Fully offline photo operations: no accounts, uploads, telemetry or hardware
  identification.

## Downloads

GitHub Releases provides:

| Platform | Packages |
| --- | --- |
| Windows x64 | Portable ZIP, EXE installer (NSIS), MSI installer |
| Linux x86-64 | AppImage, Debian/Ubuntu DEB |

ExifTool is bundled with release packages.

## Using the application

1. Select a photo folder and run a **read-only scan**.
2. Adjust filename or folder matching rules. Choose between 1 and 8
   **parallel EXIF workers** in Matching rules → EXIF and performance settings.
3. Review each precision tier and any unmatched or conflicting results.
4. Confirm EXIF writing. Full original-file backups stay in your local
   application-data folder and can occupy as much space as the originals.
5. Use **History & undo** to restore the original files if needed.

Image formats include JPG/JPEG, PNG, HEIC/HEIF, DNG, TIFF and WebP (subject
to ExifTool format support). MP4 and MOV use QuickTime rather than photo EXIF
dates; writing those video metadata fields is not yet supported.

## Build from source

Install Node.js, Rust and your platform's [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).
ExifTool must be available when editing images; packaging CI includes it.

```sh
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

The automated ExifTool integration tests use **synthetically generated PNG
images**, not personal photographs. To run the persistent-worker test locally
on Linux:

```sh
PHOTO_DATE_FIXER_TEST_EXIFTOOL=/usr/bin/exiftool cargo test --manifest-path src-tauri/Cargo.toml persistent_session_writes_and_reads_two_generated_photos
```

## Contributing and privacy

Contributions and bug reports should use fabricated paths and synthetic image
data. Do not submit real photos, private EXIF, device details, local paths,
network addresses, credentials or logs that may identify users.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md),
[SECURITY.md](.github/SECURITY.md), [CHANGELOG.md](CHANGELOG.md),
[LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Project code: **GPL-3.0-or-later**. Dependencies retain their upstream
licenses; ExifTool is offered under Perl's Artistic or GPL terms.

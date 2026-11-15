# Contributing to Photo Date Fixer

Contributions are welcome. Please use the existing Tauri 2 + Rust backend and
React + TypeScript frontend.

## Working locally

```sh
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

You may install ExifTool locally, or let the CI packaging workflow bundle a
verified upstream distribution.

## Privacy before submitting a PR

**Do not commit or paste real photos, real EXIF values from users' photos,
absolute user file paths, IP addresses, machine or OS fingerprints, host names,
performance recordings from a personal machine, operation journals, original
file backups, local logs, API tokens, credentials or environment snapshots.**

Use only synthetic images and fabricated paths in test cases, including issue
reports. For failing cases, write the smallest synthetic reproducer instead of
uploading private samples.

## Code and review standards

- Include regression tests for date matching, batch EXIF writing and undo.
- Keep EXIF operations local and preserve existing metadata unless the user
  explicitly asks to overwrite it.
- Prefer one persistent ExifTool process per batch; do not create visible
  Windows command windows.
- Update docs and third-party notices if a dependency or distributable changes.
- New original contributions are submitted under the project's
  GPL-3.0-or-later license. The rights to third-party works remain theirs.

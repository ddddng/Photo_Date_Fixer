# Photo Date Fixer 1.0.0

First stable version of the local photo EXIF date recovery application.

## Highlights
- Persistent ExifTool worker: much faster repeated EXIF operations.
- No Windows command prompt windows flashing for each photo.
- Embedded EXIF DateTimeOriginal and related date tags; optional protection for
  images that already have EXIF.
- Date extraction, second/minute/hour/day precision priority, precision
  refinement when the existing modification time agrees, interactive filtering.
- Complete original-file backups and verified undo.
- GPL-3.0-or-later open-source licensing, with dependency notices and
  contribution/privacy guidelines.
- Windows portable ZIP / EXE / MSI; Linux AppImage / DEB.

## Important notes
- ExifTool uses the Artistic or GPL licenses of Perl. License notices are in
  the repository.
- MP4 and MOV video metadata is distinct from photo EXIF and not written in
  this version.
- Backups are stored locally and may use as much disk space as the edited
  photos. They support complete rollback.

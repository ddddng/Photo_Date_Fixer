# Third-party notices

Photo Date Fixer application code is licensed under **GPL-3.0-or-later**.
The upstream libraries and externally packaged tools below retain their
respective licenses and copyright notices. This file records attribution; it
does **not** relicense third-party components.

## ExifTool
- Author and copyright: Phil Harvey and contributors
- Project: https://exiftool.org/
- Source: https://github.com/exiftool/exiftool
- License: same terms as Perl itself, **Perl Artistic License or GNU GPL**
- This app invokes the bundled command-line ExifTool without modifying its
  source. Windows packages also include the runtime accompanying its official
  stand-alone distribution; Linux packages contain the distro-provided script
  and modules. Preserve the upstream distribution's license documents and
  credit when redistributing it.
- License and attribution: https://github.com/exiftool/exiftool/blob/master/README

## Tauri, Tauri Plugin Dialog, Tauri JS API
- https://github.com/tauri-apps/tauri
- Code licenses: MIT and/or Apache-2.0, depending on component.
- Original copyright and license notices remain in upstream packages.

## React and React DOM
- https://github.com/facebook/react
- License: MIT.

## Lucide / lucide-react
- https://github.com/lucide-icons/lucide
- License: ISC. Some icons derived from Feather Icons also carry MIT notices.
- Preserve the Lucide and Feather copyright notices.

## Rust libraries and build dependencies
The Rust application depends on `chrono`, `filetime`, `regex`,
`serde`, `serde_json`, `sha2`, `uuid`, `walkdir`, Tauri and
supporting transitive dependencies. Each retains its own upstream license
(MIT, Apache-2.0 or other compatible permissions, according to the exact
package). Package-specific licenses are distributed in their corresponding
upstream repositories and package metadata.

## JavaScript toolchain
The source build uses TypeScript, Vite, `@vitejs/plugin-react`,
React type declarations, and other development dependencies. Their licenses
continue to apply independently to the toolchain.

The full GPL-3.0-or-later text for Photo Date Fixer is in
[`LICENSE`](LICENSE).

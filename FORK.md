# BARI fork of ScreenTinker

Upstream: https://github.com/screentinker/screentinker (MIT). This fork adds one feature.

## PowerPoint upload

Drop a `.pptx` (also `.ppt`, `.ppsx`, `.pps`, `.pptm`, `.potx`, `.odp`) into the Content Library
like any other file. It becomes one 1920 px image per slide, in a folder and a playlist named after
the file — exactly what a PDF upload does.

How: the server converts the deck to PDF with LibreOffice headless (`server/lib/office-convert.js`,
`POST /api/content/convert-office`) and hands the PDF back; the dashboard then runs its existing
PDF import. Nothing new is stored server-side, and the content allowlist is unchanged.

- Animations, transitions, videos and audio inside the deck are not carried over.
- Fonts: Carlito/Caladea/Liberation/Noto are in the image. A deck that uses a company font renders
  with a substitute unless that font is installed in the image.
- One conversion runs at a time (up to 5 queued); a single file may take at most 180 s.

| Env | Default | Meaning |
|---|---|---|
| `OFFICE_CONVERT` | on if LibreOffice is installed | `false` turns the feature off |
| `OFFICE_CONVERT_TIMEOUT_MS` | `180000` | per-file time budget |
| `SOFFICE_PATH` | autodetect | path to the `soffice` binary |

## Image

`.github/workflows/fork-image.yml` builds and pushes `ghcr.io/bumay/screentinker:latest` (plus a
`sha-<commit>` tag) on every push to `main`.

## Pulling upstream updates

```sh
git remote add upstream https://github.com/screentinker/screentinker.git   # once
git fetch upstream
git merge upstream/main        # conflicts, if any, are in the few files listed in this fork's commit
git push origin main           # → new image is built
```

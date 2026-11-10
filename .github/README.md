# ScreenTinker + PowerPoint upload

This is a fork of [ScreenTinker](https://github.com/screentinker/screentinker), the open-source,
self-hosted digital signage software. It adds one feature and is otherwise identical to the original:

**Upload PowerPoint presentations directly.** Drop a `.pptx` into the Content Library like any other
file. Every slide becomes an image, collected in a folder and a playlist named after the
presentation, ready to assign to a screen.

The fork pulls in every change from the original automatically each night, and a fresh Docker
image is built from it. For the full ScreenTinker documentation, see the
[original README](../README.md) or [screentinker.com](https://screentinker.com).

> Not affiliated with or supported by the ScreenTinker project. Please report problems with the
> PowerPoint upload [in this fork](https://github.com/Bumay/screentinker/issues), not in the original repository.

## How it works

1. The server converts the presentation to PDF with LibreOffice (headless).
2. The dashboard then runs ScreenTinker's existing PDF import: one image per page, a folder and a
   playlist.

Nothing new is stored on the server, and the screens and players need no changes. Supported formats
are `.pptx`, `.ppt`, `.ppsx`, `.pps`, `.pptm`, `.potx` and `.odp`.

**Resolution:** set it under *Settings → Documents → PDF import resolution*, for example to 4K
(3840 px) for 4K screens. Slides are rendered from vector data, so text stays sharp.

**Limitations:**
- Animations, transitions, and embedded video or audio are not carried over.
- Fonts: the image includes metric-compatible substitutes for Calibri, Cambria, Arial, Times and
  Courier. Other fonts, such as a corporate typeface, fall back to a similar font.
- One conversion runs at a time, and each file has a 3-minute time limit.

## Docker

Use this image instead of `ghcr.io/screentinker/screentinker`. Everything else, including your
existing data, stays the same:

```yaml
services:
  screentinker:
    image: ghcr.io/bumay/screentinker:latest
    # ... the rest of your existing configuration ...
```

Then run `docker compose pull && docker compose up -d`.

The image is about 400 MB larger than the original because it includes LibreOffice. To pin a
version, use a `sha-…` tag from the [package page](https://github.com/Bumay/screentinker/pkgs/container/screentinker)
instead of `latest`.

| Environment variable | Default | Meaning |
|---|---|---|
| `OFFICE_CONVERT` | on | `false` turns the PowerPoint upload off |
| `OFFICE_CONVERT_TIMEOUT_MS` | `180000` | time limit per presentation, in milliseconds |

## Credit and license

All credit for ScreenTinker goes to its authors. Like the original, this fork is
[MIT licensed](../LICENSE). The technical details of the fork are in [FORK.md](../FORK.md).

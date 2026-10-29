# DownToRead

DownToRead is a cross-platform, view-only Electron reader for local Markdown. It renders GitHub-Flavored Markdown, local SVG/PNG/JPEG/WebP/GIF images, and fenced Mermaid diagrams without running embedded HTML or scripts.

## Features

- Open `.md` and `.markdown` from the native **File → Open…** menu, drag and drop onto the application window, a shell command, an operating-system file association, macOS Finder, or a second application launch.
- GitHub-Flavored Markdown including tables, task lists, autolinks, and strikethrough.
- Relative and absolute local SVG/PNG/JPEG/WebP/GIF images plus fenced `mermaid` diagrams. Local images are decoded before rendering is reported complete; missing or invalid images retain descriptive fallback text.
- Navigation between local Markdown files through relative links, repository-root links such as `/docs/setup.md`, and same-repository GitHub `blob` URLs. Heading fragments are supported.
- Native application menus for Open, Print, Zoom In, Zoom Out, Actual Size, and Check for Updates. There is no document toolbar, editor, sidebar, search, tabs, or local server.
- Native printing with print-focused reading styles.

## Clone and install

Prerequisites:

- Git
- Node.js 22 or newer and npm
- Platform build tools required by `electron-builder`
- On Linux packaging hosts, standard AppImage/deb tooling; no root permission is needed for the unpacked build

```sh
git clone https://github.com/tseiman/DownToRead.git
cd DownToRead
npm ci
```

The application only needs read permission for the Markdown documents and referenced local image files. Building needs write permission in the repository's `dist/` directory. Do not run npm or DownToRead as root.

## Commands

Run in development:

```sh
npm start
```

Open a document from the command line:

```sh
npm start -- /absolute/path/to/document.md
```

Run unit and contract tests:

```sh
npm test
```

Run JavaScript syntax checks:

```sh
npm run lint
```

Run the Electron smoke test (it reports a truthful skip when `xvfb-run` is unavailable):

```sh
npm run test:smoke
```

Regenerate all icon formats from `assets/icon.svg`:

```sh
npm run icons
```

Create an unpacked Linux application:

```sh
npm run pack:linux
```

Create Linux AppImage and deb installers:

```sh
npm run dist:linux
```

Create all host-supported targets:

```sh
npm run dist
```

## File associations

Installers register `.md` and `.markdown` as documents DownToRead can view. At runtime, cold-start arguments, Electron's macOS `open-file` event, and second-instance arguments all pass through the same extension and filesystem validation. One running process owns the viewer; later launches hand their document to it.

Dropping exactly one `.md` or `.markdown` file onto the application window uses the same validated main-process open path. Other file types and multi-file drops are not treated as documents.

## Local repository navigation

Links ending in `.md` or `.markdown` open in the existing viewer window. Relative paths are resolved from the current document. Paths beginning with `/` are resolved from the nearest Git checkout root. DownToRead discovers that root and the GitHub `origin` repository name from `.git` metadata; matching `https://github.com/<owner>/<repository>/blob/<ref>/...` links are therefore mapped back to the local checkout. Links to another repository remain external and open in the system browser.

## Security model

DownToRead treats every document as untrusted:

- Electron uses `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- The preload exposes only document-ready, validated Markdown-navigation, local-image-resolution, and external-link operations.
- A restrictive Content Security Policy blocks remote scripts, network connections, plugins, frames, and forms.
- Marked is configured to escape raw HTML; DOMPurify sanitizes the generated DOM as defense in depth.
- Mermaid runs with `securityLevel: "strict"`.
- Only supported local image extensions can be read through the private asset protocol.
- Renderer navigation and new windows are denied. Local Markdown targets are extension- and existence-checked in the main process; only validated `http:` and `https:` links are delegated to the system browser.
- IPC inputs are type-, length-, scheme-, extension-, and existence-checked in the main process.

DownToRead is a viewer, not a Markdown sandbox for arbitrary active content. Keep Electron and its rendering dependencies updated.

## Updates

Packaged builds use `electron-updater` with the GitHub provider `tseiman/DownToRead`. DownToRead checks shortly after launch and also offers **Help → Check for Updates…**. Downloads and installation require explicit native-dialog confirmation; updates never install silently. GitHub Releases must contain the installers, blockmaps, and `latest*.yml` metadata emitted by `electron-builder`.

## Releases

Pushing a `v*` tag, or manually dispatching `.github/workflows/release.yml`, runs tests and builds on real GitHub-hosted Windows, macOS, and Ubuntu runners. A dependent release job collects the platform artifacts and publishes the installers and update metadata to the tag release through `GITHUB_TOKEN`.

Windows produces an NSIS `.exe`; macOS produces separate Intel x64 and Apple Silicon arm64 `.dmg` and `.zip` packages; Linux produces `.AppImage` and `.deb`.

### Optional macOS signing and notarization

Configure these GitHub Actions secrets to sign and notarize macOS artifacts:

- `MAC_CERTIFICATE`: base64-encoded Developer ID Application certificate (`CSC_LINK`)
- `MAC_CERTIFICATE_PASSWORD`: certificate password
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

When signing secrets are absent, the macOS runner intentionally produces unsigned artifacts. Unsigned downloads may require users to approve the app in macOS Privacy & Security. Windows signing is not configured in the initial release.

## Icons

`assets/icon.svg` is the original source artwork: a folded Markdown document and an eye/reading motif. `npm run icons` creates committed PNG sizes, Windows ICO, and macOS ICNS files used by packaging.

## Licenses

DownToRead is MIT licensed. Runtime and build dependency notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Installed packages retain their own license files in `node_modules` and packaged application resources.

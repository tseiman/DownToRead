# DownToRead

DownToRead is a cross-platform, view-only Electron reader for local Markdown. It renders GitHub-Flavored Markdown, sanitized non-active HTML structures, local SVG/PNG/JPEG/WebP/GIF images, and fenced Mermaid diagrams without running embedded scripts.

## Features

- Open Markdown, readable UTF-8/UTF-16 text files, and supported images from the native **File → Open…** menu or by dragging one file onto the application window. Markdown file associations, macOS Finder, shell launches, and second application launches remain supported.
- GitHub-Flavored Markdown including tables, task lists, autolinks, and strikethrough.
- Relative and absolute local SVG/PNG/JPEG/WebP/GIF images plus fenced `mermaid` diagrams. Local images are decoded before rendering is reported complete; missing or invalid images retain descriptive fallback text.
- Navigation to local Markdown, text, source-code, and image files through relative or parent-relative links, repository-root links such as `/docs/setup.md`, file URLs, and same-repository GitHub `blob` URLs. Heading fragments are supported.
- Safe inline HTML such as `<details>`, `<summary>`, and `<a>` is rendered after sanitization instead of appearing as source text.
- Native context-menu commands copy selected text, links, and decoded images. Standard **Copy**, **Paste**, and **Select All** roles use `Ctrl` shortcuts on Windows/Linux and `Command` shortcuts on macOS.
- Native application menus for Open, Print, Zoom In, Zoom Out, Actual Size, text clipboard roles, and Check for Updates. There is no document toolbar, editor, sidebar, search, tabs, or local server.
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

The application only needs read permission for opened documents and referenced local files. Building needs write permission in the repository's `dist/` directory. Do not run npm or DownToRead as root.

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

Readable local links open in the existing viewer window. Markdown is rendered, images are decoded as images, and ASCII/UTF-8/UTF-16 text and source files are shown as plain text. Relative and parent-relative paths are resolved from the current document; paths beginning with `/` are resolved from the nearest Git checkout root. DownToRead discovers that root and the GitHub `origin` repository name from `.git` metadata, so matching `https://github.com/<owner>/<repository>/blob/<ref>/...` links map back to local files. Links inside the current repository (or, for standalone documents, the current document folder) open without interruption; links outside that trusted root require an explicit **No/Yes** privacy warning. Normal HTTPS links open in the system browser. Unencrypted or non-HTTPS protocols and unrecognized binary documents also require an explicit **No/Yes** warning; **No** is the default. Known code-execution protocols, executable binaries, and installers are never opened or run. Readable scripts are displayed as plain text rather than executed.

## Security model

DownToRead treats every document as untrusted:

- Electron uses `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- The preload exposes only document-ready, validated file-navigation, local-image-resolution, context-menu, and clipboard operations.
- A restrictive Content Security Policy blocks remote scripts, network connections, plugins, frames, and forms.
- Marked accepts GitHub-style inline HTML, then DOMPurify removes scripts, event handlers, forms, frames, plugins, and other active content before it reaches the DOM.
- Mermaid runs with `securityLevel: "strict"`.
- Only supported local image extensions can be read through the private asset protocol.
- Renderer navigation and new windows are denied. Local targets are existence-, type-, size-, encoding-, and executable-signature-checked in the main process. Readable content stays inside the viewer.
- HTTPS links are delegated to the system browser. Riskier protocols and unknown binary file types require explicit confirmation, while `javascript:`, `data:`, `blob:`, executable binaries, and installers remain blocked.
- IPC inputs are type-, length-, scheme-, size-, extension-, and existence-checked in the main process.

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

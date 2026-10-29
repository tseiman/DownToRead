# Third-Party Notices

DownToRead is distributed under the MIT License. It uses the following direct third-party packages; each remains subject to its own license:

| Package | Purpose | License |
| --- | --- | --- |
| Electron | Desktop runtime | MIT |
| electron-builder | Installer and update-metadata generation | MIT |
| electron-updater | GitHub update client | MIT |
| Marked | GitHub-Flavored Markdown parsing | MIT |
| DOMPurify | Rendered HTML sanitization | MPL-2.0 OR Apache-2.0 |
| Mermaid | Diagram rendering | MIT |
| Sharp | Icon rasterization during development | Apache-2.0 |
| png-to-ico | Windows icon generation | MIT |
| png2icons | macOS icon generation | MIT |


The full transitive dependency tree and exact resolved versions are recorded in `package-lock.json`. License texts shipped by npm packages are available in their package directories and must be preserved when redistributing those packages.

The reading and print stylesheet was newly authored for DownToRead while adapting general layout ideas (bounded reading width, responsive tables, print page-break rules, and scalable Mermaid diagrams) from the separately maintained `secure-docsify-nginx` project. No third-party Docsify/Paged.js runtime is bundled.

# TDD Log

DownToRead was developed in vertical RED → GREEN slices. The commands below were executed against this working tree.

| Slice | RED evidence | GREEN evidence |
| --- | --- | --- |
| Path, launch, and asset policy | `npm test` failed because `src/path-policy.cjs` did not exist; a follow-up test exposed an incorrectly accepted `https:` image | `npm test` passed 4/4 after scheme validation |
| Markdown policy | `npm test` failed because `src/markdown-policy.cjs` did not exist | `npm test` passed 6/6 with GFM, raw-HTML escaping, Mermaid fencing, and link classification |
| Menu and updater | `npm test` failed because `src/menu.cjs` did not exist | `npm test` passed 8/8 with native commands and explicit updater behavior |
| Electron security/application contract | `npm test` failed because main, preload, and HTML application files did not exist | `npm test` passed 11/11 after the sandboxed application path was implemented |
| Packaging, workflow, and icon structures | `npm test` failed on missing source/PNG/ICO/workflow artifacts; icon generation then exposed a CommonJS default-export mismatch | icon generation was corrected and structural tests passed after assets were generated |
| Pre-ready second-instance handoff | focused application contract test failed because the event opened a `BrowserWindow` before Electron readiness | the handler now queues the validated path until `app.whenReady()` |
| Quiet automatic update checks | focused updater test showed the startup check displayed “up to date” and network-error dialogs | background checks now suppress no-update/network noise while still prompting when an update exists |
| Exact-tree review corrections | focused tests failed for incomplete native macOS roles, unsafe default update action, ambiguous startup handoff, and an unnecessary CSP source | standard macOS roles/window menu, safe update default, explicit last-request-wins handoff, and narrower image CSP now pass |
| First release matrix | Windows CI exposed a platform-specific hard-coded file URL; macOS exposed that empty signing-secret environment variables are not equivalent to absent variables | portable file-URL fixtures and separate signed/unsigned macOS build paths now pass contract tests |
| Release publication | the successful `v0.1.1` matrix produced workflow artifacts but `electron-builder --publish always` left the GitHub Release with source archives only | platform jobs now build with `--publish never`; one dependent release job downloads all three artifacts and uploads them atomically |

Final verification results are intentionally obtained from the actual commands after the last edit rather than recorded in advance here.

# Revokeproof verification

## Independent folder split — 5 November 2026

The implementation moved from the lab's workspace into its own sibling project folder. It has its own package manifest, frozen npm lockfile, source, tests, examples, license, operating rules and development scripts. Package identity and public APIs are unchanged. No project imports another project or the lab at runtime.

Verification passed from an unrelated temporary source copy with no lab or sibling source/dependency access. The copy installed only this project's frozen lockfile and ran its own commands:

| Gate | Observed result |
| --- | --- |
| Frozen clean source install | Passed, no workspace links |
| `npm run check` | 19 behavior tests passed, zero failures or skips; JavaScript syntax passed; strict public TypeScript consumer passed |
| `npm run pack:check` | Passed tarball allowlist, fresh independent npm consumer and public imports |
| `npm run test:integration` | Passed on macOS arm64 using the synthetic loopback browser fixture |
| Optional lab aggregate check and comparison | Passed from the new sibling roots |

Six actual Chromium HTTP/WebSocket cases matched their expected broken/fixed/dead-source outcomes with the helper and plain Playwright baseline. Local per-step logs and `summary.json` are retained in this project's ignored `artifacts/separation/`; temporary source copies and packed-consumer projects were removed. No runtime implementation or public API was changed during separation. No failed prerequisite was converted to a skip or pass.

```sh
npm ci --ignore-scripts
npm run check
npm run pack:check
npm run test:integration
npm run measure
```

Node 24.22.1 is selected in `.node-version`; the manifest retains its existing Node >=22 range. A version range is not evidence that every runtime/platform was tested. Use OrbStack and the README's explicit compatible-client configuration for container gates. Revokeproof uses only its synthetic loopback server and an explicitly installed Playwright browser.

Historical combined evidence remains in the optional research folder at [developer-pain-lab](https://github.com/CVamsi27/developer-pain-lab/blob/HEAD/docs/verification.md). This project does not need that folder to install or run. Adoption remains unvalidated; no publication or outreach occurred.

## Public alpha release checks

Public GitHub distribution is explicitly authorized after source, package and real-runtime gates pass. Pinned hosted CI is a separate observation from the local macOS/OrbStack run. A manual self-hosted OrbStack workflow requires a dedicated runner and remains unexecuted remotely until a maintainer configures one. No runner or production service is provisioned by this source release.

Frozen source installs, project checks and tarball consumers are rerun for release. Final results and hosted CI links are recorded with the public release. Independent adoption and retained use remain unvalidated; GitHub availability alone establishes neither.

Release source/package checks passed with 19 behavior tests and zero skipped tests. Fresh packed consumers and relevant real integration passed. Publint 0.3.25 passed; workflow syntax passed Actionlint 1.7.12. The ordinary Playwright example also passed. ATTW 0.18.5 passed for the intentional ESM-only type profile; this does not promise CommonJS compatibility. Hosted CI is a separate gate visible from the repository workflow page.

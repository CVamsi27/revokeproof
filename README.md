# Revokeproof

Test whether an already-open connection still receives protected events after the application revokes access.

[![CI](https://github.com/CVamsi27/revokeproof/actions/workflows/ci.yml/badge.svg)](https://github.com/CVamsi27/revokeproof/actions/workflows/ci.yml)

Public alpha for synthetic/local testing. Use Node 24.22.1 (`.node-version`). Installation from source and local tarballs is supported; the scoped package names are not published to npm. [GitHub releases](https://github.com/CVamsi27/revokeproof/releases) provide verified alpha tarballs when a release is available.

## Try the installed GitHub package

Use Node 24.22.1 in a test project with `"type": "module"`.

```sh
npm install --save-dev --ignore-scripts https://github.com/CVamsi27/revokeproof/releases/download/v0.1.0-alpha.1/developer-pain-lab-revokeproof-0.1.0-alpha.1.tgz @playwright/test@1.64.1 ws@8.22.1
npx --no-install playwright install chromium
node node_modules/@developer-pain-lab/revokeproof/examples/demo.js fixed
```

Run the same demo with `broken` to observe a violation and exit 1, or `dead-source` to observe incomplete evidence and exit 3. The fixed case exits 0. The example uses Chromium and a synthetic loopback server.

Copy the ordinary Playwright test into a new folder in your test project:

```sh
test ! -e ./revocation-example && cp -R node_modules/@developer-pain-lab/revokeproof/examples ./revocation-example
npx --no-install playwright test --config ./revocation-example/playwright.config.js
```

Use your own setup and cleanup callbacks when adapting this test. The fixture uses `ws`. See [the pilot guide](docs/pilot.md) and [contributor checks](CONTRIBUTING.md).

## Run the synthetic proof

From this standalone project folder:

```sh
npm run check
npm run pack:check
npm run test:integration
npm run example
npm run measure
```

`test:integration` uses actual Chromium pages and WebSockets for six cases: helper and plain Playwright baseline against broken, fixed, and dead-source applications. It exits `2` if Chromium cannot launch. No browser gate is silently skipped.

```sh
node examples/demo.js fixed         # exit 0: observed pass
node examples/demo.js broken        # exit 1: retained socket receives the event
node examples/demo.js dead-source   # exit 3: control never receives the post-revoke event
```

The synthetic fixture binds only to `127.0.0.1` on an ephemeral port. It uses fake identities, has no database or production configuration, and terminates its sockets and server after every case. Its administrative header is deliberately synthetic and must never be copied into a real application's authentication design.

For the copied test, `REVOKEPROOF_SYNTHETIC_MODE=broken` or `dead-source` makes the passing assertion fail. The report attachment explains the violation or missing observation. The integration suite verifies all three expected outcomes.

## Application-owned callbacks

```js
import {
  rehearseRevocation,
  playwrightWebSocketCapability,
  revocationExitCode,
} from '@developer-pain-lab/revokeproof';
```

`rehearseRevocation(options)` accepts:

| Option | Contract |
| --- | --- |
| `acquire(signal)` | Return `{subject, control}` once. Each is a distinct original capability with `readHttp(signal)` and `subscribe(onEventId, signal)`. |
| `readHttp(signal)` | Perform a fresh authenticated HTTP probe and return its numeric status. Before revocation both must return a 2xx response. Afterwards subject must return 401 or 403 and control must remain 2xx. |
| `subscribe(onEventId, signal)` | Subscribe to the original connection and return an async unsubscribe function. Forward only the ID of the observed event. Never reconnect to obtain a new capability. |
| `revoke(signal)` | Perform the application-owned revoke action and return `true` only after its declared acknowledgement boundary. |
| `emit(id, signal)` | Create a test-only event with exactly this ID and return `true` when accepted. Deliver it through the application's real event path. |
| `cleanup(signal)` | Close all acquired resources, including those created before a partial setup failure. Required and always attempted. |
| `deadlineMs` | Declared grace period after revoke acknowledgement, 0–60,000 ms. This is application policy, not a universal security requirement. |
| `observationMs` | Each before/after canary window, 1–10,000 ms; default 250 ms. |
| `operationTimeoutMs` | Bound per adapter/cleanup operation, 1–60,000 ms; default 5,000 ms. |

The helper first proves HTTP and stream access for both identities. Only then does it revoke, wait the declared grace period, probe HTTP again, and emit a **new** post-deadline canary. It observes the entire window even if the control receives immediately. A silent source, wrong event ID, unavailable HTTP response, unacknowledged revoke, timeout, or failed cleanup cannot pass.

`playwrightWebSocketCapability({socket, readHttp, eventId})` adapts the exact Playwright `WebSocket` object captured with `page.waitForEvent('websocket')`. `eventId(payload)` maps a received frame to the application's event ID. Unrecognized frames establish no evidence. This adapter does not take a URL or reconnect factory. See `examples/synthetic.js` for a complete application-owned setup using real pages and sockets.

Every callback should respect its supplied `AbortSignal`. A JavaScript promise cannot forcibly stop arbitrary user code that ignores cancellation; application-owned cleanup must still close its resources. The helper bounds its own waiting and reports missing evidence instead of passing.

## Evidence and failure semantics

`deadlineMs` is the grace period after the revoke acknowledgment. The timeline records when the HTTP probe starts and when canary emission starts. The two observations may occur at different times. A pass applies to the sampled responses and canary window.

A report keeps execution, observations, assertions, and cleanup separate. It contains generated canary IDs, receipt flags, HTTP statuses, policy durations, and a bounded fixed-label timeline. It excludes frame bodies, URLs, cookies, credentials, and callback exception text.

| Exit via `revocationExitCode(report)` | Meaning |
| --- | --- |
| 0 | Both baseline capabilities established; supported HTTP denial and live post-revoke control observed; no subject canary within the window; cleanup completed. |
| 1 | An observed HTTP or retained-connection violation. It remains visible even if other evidence is incomplete. |
| 2 | Adapter interruption or cleanup failure. |
| 3 | Incomplete observations or timeout. |

The canary window closes before asynchronous cleanup. Later events cannot mutate a completed report. A pass describes **sampled HTTP behavior and the declared event/window only**, not continuous absence of access or an entire provider's authorization implementation. There is no claim about signed URLs, all subscriptions, other transports, or production readiness.

## Comparison and validation

[WSHawk](https://github.com/regaan/wshawk) already provides WebSocket security workflows, identity-aware replay, authorization matrices, race operations, and browser-assisted evidence. Revokeproof does not claim those capabilities are absent. Its hypothesis is that a small helper inside an ordinary Playwright test removes repeated lifecycle/control/reporting work.

`examples/baseline.js` is a plain Playwright implementation of the same three synthetic scenarios and observation windows. `npm run measure` launches one Chromium, uses a fresh server and two browser contexts per sample, alternates execution order, and emits JSON with actual wall time, observation/cleanup duration, launch cost, versions, and expected/observed verdicts. Browser download and human setup time are excluded. No speed advantage or setup saving is inferred from these fixture timings.

Implemented checks have been exercised locally on macOS/arm64 with Node 23.7.0 and Playwright 1.64.1. Node >=22 is the declared engine range; current public-alpha profiles are listed below; other combinations remain unverified. Promotion requires independent developers to integrate a real test and retain it on a later change. Independent developer trials and retained use remain unvalidated; no outreach occurred. Source/release distribution is separate from npm registry publication.

## Standalone project

This folder owns its source, tests, examples, TypeScript consumer check, npm lockfile and development scripts. It needs no lab checkout or sibling package. Browser installation is explicit (`npx playwright install chromium`). See [verification](docs/verification.md) and the [validation plan](docs/validation-plan.md).

## Verified alpha profiles

| Profile | Verified scope |
| --- | --- |
| Ubuntu 24.04, Node 24.22.1, hosted GitHub CI | Source checks and independent packed consumers |
| macOS arm64, Node 24.22.1, Chromium | Local synthetic HTTP/WebSocket integration described in verification |

Actual Chromium helper/baseline cases and the ordinary Playwright example also passed on that hosted Linux runner. See [public alpha readiness](docs/public-alpha.md) for immutable CI evidence, distribution and remaining gates. Other runtime/OS/engine combinations remain unverified.

# Access is revoked, but the original WebSocket still receives events

This walkthrough uses Revokeproof alpha.1, Chromium, and a synthetic loopback application. Two test users open the same protected stream. After one user's access is revoked, a fresh HTTP request for that user returns 403. In the broken fixture, their original socket stays subscribed and receives a new protected event.

## How the test distinguishes denial from a quiet stream

1. Open the subject's and unaffected control's original WebSockets. Confirm both users can read over HTTP and receive the same uniquely identified baseline event.
2. Revoke the subject's access through the application and wait for its acknowledgement and the declared grace period.
3. Probe HTTP again and emit a different event through the same protected path. Observe both original sockets for the whole window.

The control proves that an event was available to receive. The report captures the HTTP responses, receipt flags and when each post-revocation probe starts. The grace period determines when sampling begins. The result covers the sampled responses and observation window.

| Mode | Subject HTTP after revoke | Subject's original socket receives event | Control receives event | Exit |
| --- | --- | --- | --- | --- |
| `broken` | 403 | Yes | Yes | 1 |
| `fixed` | 403 | No | Yes | 0 |
| `dead-source` | 403 | No | No | 3 |

The broken report includes `retained-capability-received-event`. In the fixed case the application closes the affected socket. In the dead-source case the report marks the evidence incomplete because the control never receives the post-revoke event.

## Reproduce it and keep it in Playwright

Use Node 24.22.1 in a new empty directory. The commands use fake identities and run the example against its own loopback server.

```sh
npm init -y
npm pkg set type=module
npm install --save-dev --ignore-scripts https://github.com/CVamsi27/revokeproof/releases/download/v0.1.0-alpha.1/developer-pain-lab-revokeproof-0.1.0-alpha.1.tgz @playwright/test@1.64.1 ws@8.22.1
npx --no-install playwright install chromium
node node_modules/@developer-pain-lab/revokeproof/examples/demo.js fixed
```

Run the last command separately with `broken` and `dead-source` to see the expected nonzero results. Copy the test into a new folder to keep a passing control in your suite.

```sh
test ! -e ./revocation-example && cp -R node_modules/@developer-pain-lab/revokeproof/examples ./revocation-example
npx --no-install playwright test --config ./revocation-example/playwright.config.js
```

For your own application test, use two test identities that can access the same resource. Adapt `acquire`, `revoke`, `emit` and `cleanup` in the [synthetic adapter](../examples/synthetic.js). Keep the original Playwright socket objects and map incoming frames to the unique event ID. The copied test attaches the report and requires a passing result. See the [callback contracts](../README.md#application-owned-callbacks) and [verification record](verification.md).

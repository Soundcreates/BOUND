# Connection score v1

The connection gate uses `client/extension/connection-score.mjs`. Each check adds its weight when passed, subtracts it when failed, and contributes zero when unavailable. The total is clamped to 0–100. The default allow threshold is **80**, inclusive. These weights are a conservative initial policy, not a calibrated probability of safety.

Edit the `BOUND_CONNECTION_*` and `BOUND_TX_*` values in the project `.env`; the available names and defaults are in `.env.example`. Run `node client/extension/build.mjs` and reload the extension in `chrome://extensions` to apply changes. Chrome extensions cannot read the local `.env` at runtime, so the build writes only validated scoring settings into `dist/score-settings.mjs`. Shell environment variables take precedence over `.env`; secrets are not copied into the extension.

Connection weights must add up to 100 and the threshold must be 1–100. Transaction verdict cutoffs must satisfy `red < amber < green`; amber must be at least 40 and green at least 66 so existing untrusted-address caps cannot become green. The build rejects invalid configuration. The core score caps, explicit hard blockers, decoder caps, and unrelated operational timeouts are not controlled by these variables.

| Check | Weight | Evidence |
|---|---:|---|
| Supported origin | 10 | HTTPS, or loopback HTTP for the local demo. This does not constitute a DNS/TLS scan. |
| Current verified snapshot | 25 | Extension-owned ENS pointer and Arkiv snapshot verification. |
| Exact domain and port | 20 | Exact host scope appears in the verified snapshot. |
| Arkiv watcher lookup | 10 | Reader returns a valid record array. Lookup success alone does not prove normal status. |
| Current normal watcher status | 25 | Fresh, expected-owner status records for the scoped site. Missing, conflicting, or expired normal status earns zero. A confirmed incident or drift fails this check. |
| Wallet state | 10 | Valid bounded chain identifier and account list from the provider state check. |

A supported origin, available wallet state, and no current confirmed incident or drift are also required. An incident or drift cannot be offset by other positive checks. Page and requesting-frame scopes are scored individually; the lowest scope score governs the connection, so a trusted top page cannot compensate for an unverified requesting frame.

With the default values: all checks pass = 100 and allow; watcher status unavailable with the other five checks passing = 75 and block; current incident with the other checks passing = 50 and block. Lowering the connection threshold may allow a connection with unavailable evidence. The current reader obtains lookup and status evidence together, so some theoretical score combinations cannot occur in practice.

Connection requests and account-disclosure calls use this score. The extension's transaction evaluator retains its existing counterparty checks, signature handling, and trust caps. Collected source/network hashes earn no points until they can be compared against authenticated release evidence.

The popup's **Recent checks on this site** displays the score, threshold, and expandable per-origin list of points and outcomes. Details remain local. The existing wallet interception coverage limitations still apply: a provider path that bypasses the hook cannot be stopped or scored by this gate.

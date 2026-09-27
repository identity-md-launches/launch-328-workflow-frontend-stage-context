# Frontend validation

Worker report, 27 September 2026. **Frontend implementation and checks complete. In-place Git commit blocked by read-only repository metadata.** The source and export remain in the workspace for publisher collection. The documentation-path exception and live-transaction limitations are below. These are worker observations, not independent control-plane certification.

## Scope and assumptions

Implemented Vite + React + TypeScript source in `web/`, static output ready for collection in root `dist/`, and documentation/evidence in `docs/`. The approved workflow requests mint, list/unlist, rent with a separate approval, and 25 sequential token IDs per page from contract views. It explicitly excludes an in-page swap; the page explains the Sepolia ETH → LEAS launch pool and displays configured pool/token details. Advanced owner controls cover free user assignment and NFT transfer; rental allowance can be revoked.

The root `DESIGN.md` criterion conflicts with the higher-priority instruction allowing writes only under `web/`, `dist/`, and `docs/` (plus explicitly budgeted `web/.gitignore`). The complete design document is therefore [docs/DESIGN.md](DESIGN.md). Root configuration, contract source, ABI source exports, libraries and workflow files remain untouched.

One light theme, English UI, system fonts, injected browser wallet. No backend, indexer, log scan, remote asset dependency, WalletConnect ID, privileged key, deployment or publication. All displayed collection rows come from views at a shared block; no log queries need chunking.

## Commands and outcomes

Commands were run from `web/` unless stated otherwise.

| Check | Actual outcome |
| --- | --- |
| `npm install --no-audit --no-fund --cache /tmp/lease-npm-cache` | Installed frontend dependencies and generated `web/package-lock.json`; caches stayed outside the submission. |
| `npm run build` | Passed: `tsc --noEmit`, production Vite compilation (424 modules), ABI export and final manifest generation. Final runtime export: 517,395 bytes including configuration. |
| `npm run verify` | Passed: six assets, complete SHA-256 inventory, relative HTML assets, exact pinned ABI bytes, canonical Keccak hashes, unchanged network and wallet-add-chain configuration, handoff identifiers and full contract set. |
| `taskset -c 0,1 env CHROMIUM_PATH=/opt/imd-worker/local/imd-browser-tool/ms-playwright/chromium-1246/chrome-linux64/chrome npm test` | **15 passed**, approximately two minutes. [Raw Playwright result](evidence/interactions.json). |
| `npm run check:rpc` | All three supplied public RPCs passed read-only chain, code and token-binding checks. [RPC evidence](evidence/rpc-check.json). |
| Browser-tool final export inspection | Live RPC reads at block **11,791,681**, no console exceptions or failed resources, no page overflow at 390px; missing-wallet error displayed correctly. [Recorded observations](evidence/live-browser.json). |
| `git diff --check` | Passed; an isolated temporary Git copy checks all new files because in-place staging is read-only. Submission size recorded in [submission evidence](evidence/submission.json). |

Initial Playwright attempts failed before test execution because Chromium exhausted the worker's thread budget. Restricting CPU affinity to two CPUs resolved that environment issue. The final suite ran against the final build at `/lease/`, exercising static hosting below a path prefix. The temporary server and browser were stopped after validation.

## Meaningful interactions

Tests in [`web/tests/market.spec.ts`](../web/tests/market.spec.ts) use the exported ABI arrays to encode RPC responses and decode every submitted transaction. Mock return values and fake receipts do not establish deployed contract execution semantics; they establish frontend controls, guards, calldata and recovery behavior.

1. Disconnected reads; exactly 25 token IDs; page 2 contains ID 26; missing-wallet recovery.
2. Wrong chain blocks signing; 4902 prompts the exact supplied `wallet_addEthereumChain` object, then switches again.
3. Mint confirms, refreshes supply/account state and disables a fourth lifetime mint.
4. Listing rejects excess decimal precision; owner updates/unlists while retaining an active user's rights in the fixture.
5. Three days at 10 LEAS generates `approve(RentableNFT, 30e18)`, then `rent(1, 3, 10e18)`; balance and allowance refresh.
6. A listing price increase after approval cannot silently increase the user's reviewed maximum; review resets approval eligibility.
7. Days 0, 31 and 1.5, insufficient LEAS, self-rental and an active user block payment.
8. Wallet rejection and failed simulation show distinct recoverable errors; no mock broadcast occurs.
9. Wrong RPC chain, missing code, wrong payment token and modified ABI content disable actions.
10. An account change invalidates selected-key and approval state.
11. Owner free-access assignment and transfer require acknowledgement; transfer retains usage and clears listing in the fixture; revoke sets allowance to zero.
12. Empty collection presents a mint-oriented explanation and disables pagination.
13. A failed first RPC falls back; a complete outage disables actions against stale state; retry restores fresh state.
14. Keyboard-only Tab/Enter flow connects, selects, approves and rents with the expected two-day calldata.
15. Desktop/mobile rendering, resource errors, axe scans, keyboard focus, reduced motion, text enlargement and computed contrast.

Transactions recheck wallet identity/chain, RPC chain, code and token binding and simulate before requesting a signature. There are no production test bypasses. The test wallet exists only in Playwright's page initialization.

## Better Interface consolidated review

Read the pinned workflow, all six domain core sections and the design-documentation section, then applied the relevant checks during implementation. Coverage is **Checked** for all six domains; individual omissions are listed explicitly.

| Domain | Coverage and evidence | Remaining limits |
| --- | --- | --- |
| Accessibility | Native controls, labels, landmarks, table headers/caption, stable status/error regions, focus, accessible full addresses, disabled prerequisites, 44px main/mobile row targets. Keyboard-only paying flow passed. Axe WCAG 2 A/AA, 2.1 AA and 2.2 AA scans: zero violations at all four widths. [Focus screenshot](evidence/keyboard-focus.png), [rental form](evidence/rental-review.png). | No screen-reader session, physical touch device, exhaustive focus-background combination or Windows forced-colors session. Automated scans do not prove full compliance. |
| Layout | Inspected actual screenshots at 1440, 768, 390 and 320px. No page overflow; table overflow is confined to its labeled scroll region. Selected controls scroll into view. Header/card grids wrap at 200% root text size. [Text resize](evidence/text-resize.png). | Root text resizing is not native 200% browser zoom. RTL/localization is not implemented or tested. |
| Writing | Reviewed action labels, mint limits, units, price cap, gas, two-step approval, no-wallet/wrong-chain/RPC errors, no-in-page-swap explanation and rental-preserving transfer deviation. Errors say what can be retried or changed. | English only; no formal content-comprehension study. |
| Typography | Checked serif/sans hierarchy, 12px caption floor, 16px fields, long-address exposure, exact decimals, tabular numerals and wrapping across viewports. | System-font metrics/weights differ by operating system; no remote fonts are used or claimed loaded. |
| Colors | Tokens reviewed; text status accompanies color. Measured computed rendered pairs: main text 13.18:1, muted hero/labels 5.21:1, mint action 9.85:1, mint note 7.67:1, table status 5.69:1. [Computed pair data](evidence/contrast.json). Focus uses a light separation ring. | Single light theme. Disabled text is exempt from active text thresholds; not every possible custom OS color was measured. |
| UI details | Inspected enabled/disabled/selected/empty/loading/error/confirmed states. Native disclosures, inline SVG key icons, clear control borders and flat surfaces. Reduced-motion emulation removes button transitions (`0s`). | No overlay dialogs, theme switch, media or entrance animations; those guide sections are not applicable. No animation-panel slow-motion session. |

### Findings fixed and rechecked

| Severity / domain | Final source location | Observed issue → correction and recheck |
| --- | --- | --- |
| Medium / writing | `web/src/chain.ts:52` | Broad matching of “rejected” misclassified a simulation revert as wallet rejection. Match EIP-1193 code/user-rejection identity instead. Rejection and revert test now passes. |
| Medium / layout | `web/src/styles.css:179`, `:234` | 200% text produced a measured 845px body at a 768px viewport. Constrain hero columns with `minmax(0, …)` and allow header/card labels to wrap. Final measured body is 768px. |
| Medium / accessibility + layout | `web/src/App.tsx:310`, `:602` | Mobile table actions required scrolling to a trailing column, with no visible explanation. Make the key number the action, add a scroll hint, bring the editor into view and focus it. Keyboard flow and narrow screenshots rechecked. |
| Low / typography | `web/src/styles.css:187`, `:384`, `:406` | Several dense labels were below 12px. Raise them to 0.75rem and recheck wrapping at 320–1440px. |
| Low / UI | `web/src/App.tsx:22` | Font-dependent key glyph rendered inconsistently. Replace it with a local decorative SVG; final populated and live empty screenshots inspected. |
| Medium / observability | `web/src/App.tsx:279`, `web/src/chain.ts:254` | Status could keep asking for a signature after a rejection or claim fresh reads before completion. Clear pre-broadcast status on error, preserve submitted hash on receipt failure, and distinguish receipt confirmation from read status. Final rejection/confirmation flows pass. |
| Low / accessibility | `web/src/styles.css:785` | A single colored focus perimeter did not provide consistent separation from dark surfaces. Add a 3px light ring; keyboard and rental-form screenshots show the resulting visible indicator. |

No known blocking finding remains within the tested frontend scope. Minor shared inline validation messaging for the advanced owner fields has not been exhaustively exercised with assistive technology; the first invalid field is focused and the alert remains visible.

## Screenshots and live evidence

- Final real-RPC, empty collection: [desktop 1440px](evidence/live-desktop.png), [mobile 390px](evidence/live-mobile.png). The deployed collection had `totalMinted() == 0` during the read-only check.
- Final mocked collection: [1440px](evidence/market-1440.png), [768px](evidence/market-768.png), [390px](evidence/market-390.png), [320px](evidence/market-320.png).
- [Reviewed three-day rental](evidence/rental-review.png), [keyboard focus](evidence/keyboard-focus.png), [200% text](evidence/text-resize.png).
- [Browser summary](evidence/browser-summary.json), [contrast](evidence/contrast.json), [15-test report](evidence/interactions.json), [RPC checks](evidence/rpc-check.json).

Both implementation-derived ABI hashes match the supplied handoff: LaunchToken `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee`; RentableNFT `2e7a828875e7623282fa816ce978501cb67a9d5556b6f17c705273cd5b1a894e`. They are exported from source commit `e9b02461322a84124803061b0fcba94ad863dace`. All three live RPCs returned chain 11155111, 1,722 bytes of LaunchToken code and 6,676 bytes of RentableNFT code, with the correct `token()` address.

## Untested behavior and delivery boundary

No real wallet signatures, token approval, mint, list, rent, transfer, user assignment or swap were broadcast. Real wallet-extension UX, funded live-chain transaction execution, gas estimation variability, receipt replacement/reorgs, hardware wallets, Safari/Firefox and physical mobile devices remain untested. The worker did not rerun Solidity tests or change deployed code. Existing contract tests are inputs to understanding behavior, not newly claimed frontend results.

The browser checks verify the static export and its interactions. They do not certify contract security. The read-only RPC code check establishes nonempty code, not runtime-bytecode equivalence to the source. The manifest binds implementation ABIs to the attested handoff; publication/CID/named-entrypoint checks are subsequent control-plane work and are not claimed complete here.

The attempted `git add web dist docs` failed with `Unable to create .git/index.lock: Read-only file system`. No in-place commit is claimed. A temporary repository under the explicitly permitted `test/scratch/` area was used only to validate a complete candidate commit/bundle and allowed paths; it is not part of the deliverable and does not modify protected repository metadata. The publisher can collect the finished workspace files.

# Lease frontend

A single static page for the deployed Lease Keys rental market. Source, dependencies and frontend configuration stay in `web/`; the publishable export is `../dist/`. Node 22.12+ (validated with Node 24) is required.

## Install, build and serve

```sh
cd web
npm ci
npm run build
npm run preview -- --port 4173
```

The build runs TypeScript checking, Vite with relative base `./`, and the deployment exporter **in that order**. Keep the whole `dist/` directory together. Serve it with any static HTTP server, including beneath a gateway path. No backend, rewrites, indexer, remote font, or asset CDN is required. Opening `index.html` with `file://` is not supported because the app fetches its configuration and ABIs.

For source development, run `npm run dev` after the first build. Its development middleware serves the same generated manifest and ABI files from `dist/`; it does not create a second deployment configuration.

## Deployment configuration

`config/deployment.json` and `config/network.json` preserve the supplied handoff as build inputs. There are no private credentials. The exporter obtains the raw implementation ABI files using `git show <sourceCommit>:docs/abi/<Contract>.json`, then verifies their canonical Keccak-256 hashes (recursively sorted object keys; array order retained). The source commit must be available in Git when rebuilding. Existing deployed Solidity and compiler settings are untouched.

The browser's only deployment source is `dist/imd-deployment.json`. `src/config.ts` loads it and the ABI files at its relative `abiPath` values. It validates ABI hashes and network consistency. The manifest retains the exact contracts, identifiers, unchanged `network` block and supplied `walletAddChain`. After the final export it inventories every other exported file with SHA-256; it excludes itself. Run `npm run build` again after any source or export change. Do not hand-edit the export.

Public RPCs use the manifest's order, followed by an injected wallet fallback only on the right chain. Reads check chain ID, nonempty contract code and `RentableNFT.token()` against the attested token. Account balances, allowances and token amounts use the contract's `decimals()`. No alternate address/ABI map is compiled into the app. The handoff pool is native ETH / LEAS, fee 3000, tick spacing 60, hookless; the approved workflow explicitly requests **no in-page swap**. The page explains how LEAS is obtained and shows the configured PoolManager and token addresses.

## Wallet and transaction behavior

The injected EIP-1193 browser-wallet connector requires no WalletConnect project ID. A wallet browser or browser extension is supported; WalletConnect QR/mobile deep links and an EIP-6963 wallet chooser are not implemented. Adding those later requires explicit public connector configuration and additional tests.

- A wrong-chain wallet gets one switch control. Unknown-chain error 4902 (including nested error and unknown-chain messages) triggers `wallet_addEthereumChain` with the supplied parameters, followed by another switch.
- The collection comes exclusively from `totalMinted()` and views: sequential IDs, 25 per page, with owner, live listing price, active user and last recorded expiry. Reads use one block per snapshot and refresh every 30 seconds or on request. No historical logs are queried, so deployment-block log chunking is not needed.
- Mint is free apart from gas. The contract's supply and lifetime wallet limits determine eligibility.
- Owners list, update and unlist. Advanced controls also expose `setUser` and the safe NFT transfer, with explicit acknowledgement. Transfers preserve active usage; unlike the ERC-4907 reference, they never shorten a paid rental. Unlisting and relisting also preserve access.
- Rent is an explicit two-transaction flow: approve the exact reviewed maximum total to RentableNFT, then rent with the frozen `maxPricePerDay`. A price increase requires a new review and approval. Every new rental requires the approval step even if an old allowance exists. Existing approval can be revoked from deployment details.
- Every write rechecks chain/account and deployment, then simulates before requesting a signature. Rejections and reverts are shown. Transaction hashes link to the explorer. A confirmed receipt refreshes reads; an RPC error disables further actions. One confirmation is used; chain reorgs and dropped/replaced transactions may require checking the explorer and refreshing.

## Validation

```sh
npm run typecheck
npm run build
npm run verify
npx playwright install chromium
npm test
npm run check:rpc
```

`CHROMIUM_PATH` can point to an existing Chromium executable. On this worker, Chromium's default thread count exceeded the process budget. Tests run with CPU affinity limited to two CPUs:

```sh
taskset -c 0,1 env CHROMIUM_PATH=/opt/imd-worker/local/imd-browser-tool/ms-playwright/chromium-1246/chrome-linux64/chrome npm test
```

Playwright starts and stops a static server itself, testing the export at `/lease/`. Tests mock wallet/RPC responses, ABI-encode actual return values and decode submitted transaction calldata. They never broadcast to Sepolia. The separate RPC check performs only chain ID, code and view requests. See `../docs/VALIDATION.md`, `../docs/evidence/` and `../docs/DESIGN.md` for results, screenshots and limitations.

No deployment, publication, IPFS pinning or site naming is performed by this worker. Those are subsequent control-plane steps. Node modules, caches, browser binaries and temporary test output are not part of the submission. The explicit ignore-file path budget is `web/.gitignore` only; its directory-name rules exclude dependencies and caches at every depth within `web/`.

## Design attribution and scope

The pinned Better Interface guide (Jakub Krehel, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`) informed the six-domain review. The design documentation method is adapted from Paul Bakaus's Impeccable (Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). No upstream guide source is redistributed. The requested root `DESIGN.md` conflicts with the assignment's explicit write allowlist; the implementation document is delivered at `docs/DESIGN.md` instead.

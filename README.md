# Lease contracts

Lease is a Sepolia NFT rental market using LEAS. This contribution delivers the
contracts, offline dependencies, Foundry tests, and ABI exports. The separate
manifest assignment produces `launch.json`; an independent contributor reviews
accepted source and manifest before services publish, attest, admit, and deploy.
The live website follows deployment. No deployment transactions are performed here.

## Build and verify

Use Foundry with Solidity **0.8.26**, pinned by version in `foundry.toml`.
Dependencies are vendored as ordinary source files; compilation and testing need
no network once the compiler and Foundry are installed. There are no submodules,
FFI, filesystem cheatcode permissions, private keys, RPC calls, or environment
variables required by these tests.

```sh
forge build
forge test
forge fmt --check
python3 scripts/export_abis.py --check
```

`python3 scripts/export_abis.py` regenerates both delivered ABI arrays. Python is
only needed for that helper. See [ABI reference](docs/ABI.md) and
[dependency provenance and licenses](lib/DEPENDENCIES.md). The compiler uses the
Cancun target, optimizer with 200 runs, and `bytecode_hash = "none"`.

## Behavior

`LaunchToken` is an OpenZeppelin ERC-20 named **Lease**, symbol **LEAS**, with 18
decimals and exactly **1,000,000,000 LEAS (10^27 minor units)** minted once to the
deployer. Its constructor has no arguments. It exposes no external mint, burn,
owner, fee, pause, blocklist, or upgrade mechanism.

`RentableNFT` is an OpenZeppelin ERC-721 named **Lease Keys**, symbol **LKEY**.
`mint()` is free and safe-mints one sequential ID, starting at 1, to its caller.
Each address can mint at most three NFTs over its lifetime, and total supply is
at most 3,000. Transfers never restore mint allowance. Receiving transfers does
not consume allowance. There is no burn path. The per-address cap is not a
per-person restriction: users can create more wallets. No artwork or metadata
URI was specified; inherited `tokenURI` returns an empty string for existing IDs.

An NFT owner may list or replace a positive daily price in LEAS minor units, or
unlist. ERC-721 approvals do **not** authorize listing or unlisting. The offer
remains open after a rental and its expiry. An actual ownership change deletes
the offer and emits `Unlisted`; transferring away and back cannot revive it.
Self-transfers preserve offers because ownership has not changed. A new owner
must create their own offer. Unlisting an already unlisted NFT is harmless.

A renter calls `LEAS.approve(RentableNFT, cost)`, then
`rent(tokenId, rentalDays, maxPricePerDay)`, with 1–30 days and a price limit.
The NFT must have a live listing, its current user must be zero, and the renter
must differ from its current owner. A price increase above the caller's limit
reverts. A lower price charges the current price. Cost is `pricePerDay * rentalDays`;
there is no rounding, proration, fee, or additional deposit. Overflow reverts.

`SafeERC20.safeTransferFrom` moves the entire cost **directly from the renter to
the NFT owner at the time of rent**. Nothing is paid to the application. A later
NFT sale does not move already earned rent to the buyer. Failed payment reverts
the usage assignment and all balance/allowance changes. There is no escrow,
payout, withdrawal, cancellation, refund, early termination, or renewal while
active. Both mint and rent guard against reentrancy; rental state is written
before payment and rolls back with a failed payment.

The new user's expiry is the transaction's block timestamp plus `rentalDays *
86,400` seconds. `userOf` returns the recorded user strictly **before** expiry,
and zero **at or after** expiry. `userExpires` retains the last recorded expiry.
No keeper or transaction is needed to expire a rental. Availability views for
unknown IDs return zero; listing and state-changing token operations require an
existing token. Expiries fit `uint64`, and rent explicitly rejects a timestamp
that would overflow that type.

## ERC-4907 compatibility and permissions

The contract exposes `setUser`, `userOf`, `userExpires`, `UpdateUser`, and ERC-165
interface `0xad092b5c`. The following intentional differences from the
[ERC-4907 reference implementation](https://eips.ethereum.org/EIPS/eip-4907)
protect the agreed rental terms:

- **Transfers never clear a user or expiry.** All transfer overloads preserve the
  usage right, including transfers to the renter and transfers through receiver
  callbacks. Buyers acquire NFTs subject to existing usage rights.
- `setUser` is restricted to the owner, token-approved address, or approved
  operator, and only succeeds when `userOf == address(0)`. No authorized caller
  can clear, replace, shorten, or extend an active assignment.
- Expiry is exclusive: `expires <= block.timestamp` means inactive.

The same protection applies to a free `setUser` assignment. This is the chosen
interpretation of “only while no rental is active”: a nonzero, unexpired user
locks further assignments until expiry regardless of whether payment occurred.
Owners/operators should not assign a far-future expiry unless they intend that
irrevocable term; the 30-day cap applies to paid `rent`, not manual `setUser`.
Zero-user or already expired assignments do not block renting. Listing,
unlisting, changing price, and transferring may happen during a rental but never
alter its user or expiry. The renter receives no ERC-721 transfer or approval
authority just by being the user.

There is no project owner/admin, pause, rescue, or upgrade role. Standard ERC-721
owners and approved operators retain their usual NFT transfer powers. There is
no privileged beneficiary or hidden initialization step.

## Deployment parameters and responsibilities

Only **Sepolia, chain ID 11155111**, is approved for launch. Services must enforce
the network and canonical policy; the contracts themselves have no chain-ID
gate. Deploy through ProjectFactory in this order:

| Artifact | Constructor arguments | Result |
| --- | --- | --- |
| `src/LaunchToken.sol:LaunchToken` | none | All `10^27` minor units belong to the deploying factory |
| `src/RentableNFT.sol:RentableNFT` | `address leas`: `constructorArgs ["$token"]` | `token()` is the deployed LEAS; no application funding or initialization |

Both constructors are nonpayable. The NFT's constructor checks that the token
address has code; it does not authenticate arbitrary token economics. The
manifest and independent reviewer must bind it to **this LaunchToken**. Neither
contract grants administrative power to constructor `msg.sender`; minting the
fixed supply to the factory is the launch token's only such use.

The manifest contributor selects the accepted artifacts and token dependency.
Policy, signed artifact linkage, distribution, liquidity, source publication,
attestation, admission, and deployment are service responsibilities. The
application must receive no LEAS allocation at deployment and never needs one.
Users obtain LEAS by swapping Sepolia ETH in the service-created ETH/LEAS launch
pool. Record both deployed addresses and deployment block for the frontend.
Network, deployed addresses, block, and policy artifacts are service outputs,
not guessed constants or prerequisites of this source assignment.

The website contributor uses `token()` to discover LEAS, reads wallet balances
and allowances, offers Approve before rent, and displays IDs 1 through
`totalMinted()` in pages of 25 with owner, offer price, current user and expiry.
Use these views plus chunked event queries starting at the deployment block;
no backend/indexer is needed. Explain the external ETH/LEAS swap, without an
in-page swap. The later site label is `lab-rentable-nft`, with `dist/index.html`
as the static export.

## Assumptions and review handoff

Payment correctness assumes the specified immutable, exact-transfer LEAS token.
Fee-on-transfer, rebasing, dishonest, or callback-bearing replacement currencies
are not supported deployment choices. Payment mocks test rollback and callback
defenses; they do not broaden this trust assumption. Usage is an on-chain record;
any off-chain access system must honor `userOf` and expiry, including after NFT
ownership changes. Block timestamps determine term boundaries.

All intended application flows leave its LEAS and ETH balances zero. No payable
function, receive, or fallback exists. Like any address, however, it cannot
prevent unsolicited ERC-20 transfers or protocol-forced ETH. Such assets would
be stranded because there is deliberately no rescue/payout authority. Do not
send assets directly to the application.

The tests cover mint caps, authorization, stale and round-trip listings, pricing
front-running, exact payments to the correct owner, every transfer overload,
active-user protection, free assignments, expiry boundaries, payment failures,
arithmetic limits, receiver rejection, and callback reentrancy. Three fuzz tests
run 512 cases each. The stateful suite runs 128 sequences of 64 calls, tracking
payment balances and promised rental users/expiries across listing, unlisting,
renting, transferring, attempted revocation, and time changes. A local CREATE2
constructor probe also checks supply retention, runtime limits, forbidden
runtime opcodes, and lack of initialization/funding requirements.

These are contributor tests, **not an independent security review**. The later
reviewer must inspect the actual accepted source and manifest, especially
attempted owner/operator revocation through `setUser`, transfers and callbacks,
unlist/relist, stale listings, price changes, correct payment recipients, and the
`$token` constructor binding. The local constructor probe is not a deployment or
integration test of the protocol's ProjectFactory. Independent review,
manifest/policy checks, service deployment, pool operation, and frontend/live
integration remain their respective stage responsibilities.

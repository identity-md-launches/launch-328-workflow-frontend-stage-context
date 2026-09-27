# Contract ABI reference

Complete compiler-generated ABI arrays:

- [`LaunchToken.json`](abi/LaunchToken.json)
- [`RentableNFT.json`](abi/RentableNFT.json)

Regenerate with `python3 scripts/export_abis.py`; verify without writing with
`python3 scripts/export_abis.py --check`. All amounts and prices below are
integers in LEAS minor units (18 decimals). Expiries are Unix seconds. None of
the constructors or callable methods accepts ETH.

## LaunchToken

Constructor: `constructor()`.

Standard ERC-20 views are `name()`, `symbol()`, `decimals()`, `totalSupply()`,
`balanceOf(address)`, and `allowance(address,address)`. Transactions are
`transfer(address,uint256)`, `approve(address,uint256)`, and
`transferFrom(address,address,uint256)`, returning `bool`. Standard `Transfer`
and `Approval` events and OpenZeppelin ERC-6093 custom errors are in the JSON.
No mint/admin/permit extensions are exposed.

## RentableNFT

Constructor: `constructor(address leas)`. Resolve `leas` from `$token`.

| Method | Returns / behavior |
| --- | --- |
| `token()` | `address`, immutable payment token |
| `mint()` | `uint256 tokenId`; safe mint to caller |
| `totalMinted()` | `uint256`, IDs are `1..totalMinted` |
| `mintedBy(address)` | `uint256`, lifetime mints by address |
| `MAX_SUPPLY()` | `uint256`, 3,000 |
| `MAX_MINTS_PER_ADDRESS()` | `uint256`, 3 |
| `MAX_RENTAL_DAYS()` | `uint256`, 30 |
| `list(uint256 tokenId,uint256 pricePerDay)` | Owner only; replace offer with positive price |
| `unlist(uint256 tokenId)` | Owner only; delete offer, including during rental |
| `listing(uint256 tokenId)` | `(address lister,uint256 pricePerDay)`; `(0,0)` if unlisted; reverts for missing token |
| `rent(uint256 tokenId,uint256 rentalDays,uint256 maxPricePerDay)` | 1–30 days; charge current daily price, capped by caller's maximum |
| `setUser(uint256 tokenId,address user,uint64 expires)` | Owner/approved address; only while no active user |
| `userOf(uint256 tokenId)` | `address`; zero at or after expiry and for unknown IDs |
| `userExpires(uint256 tokenId)` | `uint256`; last recorded expiry, zero before any assignment |
| `supportsInterface(bytes4)` | `bool`; ERC-165, ERC-721, ERC-721 metadata, ERC-4907 |

Inherited ERC-721 ownership, approvals, both `safeTransferFrom` overloads,
`transferFrom`, and metadata methods are fully included in the JSON. There is
no enumerable extension: use sequential IDs. `tokenURI` is empty for minted
tokens. NFT buyers must inspect `userOf` and `userExpires` because a sale
preserves existing usage rights.

## Application events

```solidity
event Listed(uint256 indexed tokenId, address indexed lister, uint256 pricePerDay);
event Unlisted(uint256 indexed tokenId, address indexed lister);
event UpdateUser(uint256 indexed tokenId, address indexed user, uint64 expires);
event Rented(
    uint256 indexed tokenId,
    address indexed renter,
    address indexed owner,
    uint256 rentalDays,
    uint256 cost,
    uint64 expires
);
```

`Unlisted` is also emitted when an ownership change invalidates a live offer.
Rental emits `UpdateUser`, the LEAS payment emits ERC-20 `Transfer`, then the
application emits `Rented`. A reverting payment reverts the entire transaction,
including all these logs. `setUser` emits `UpdateUser` without `Rented` because
no payment occurs. Natural expiry emits no event; read current views/time.
Transfer preserves user data and emits no artificial user-clearing event.

## Application errors

All application errors have no arguments:

| Error | Meaning |
| --- | --- |
| `InvalidToken()` | Constructor argument has no code |
| `MintLimitReached()` | Caller already minted three NFTs |
| `SoldOut()` | 3,000 NFTs have been minted |
| `NotTokenOwner()` | Listing/unlisting caller is not the NFT owner |
| `InvalidPrice()` | Zero listing price |
| `InvalidDays()` | Paid rental duration outside 1–30 days |
| `NotListed()` | No current-owner offer |
| `TokenInUse()` | An unexpired nonzero user blocks rent/setUser |
| `SelfRental()` | Renter is the NFT owner |
| `PriceAboveMaximum()` | Current daily price exceeds renter's limit |
| `ExpiryOverflow()` | Timestamp plus duration cannot fit `uint64` |

Inherited ERC-721 errors report missing tokens, unauthorized calls, invalid
receivers, and invalid approvals. `ReentrancyGuardReentrantCall()` rejects nested
mint/rent calls. LEAS errors (such as insufficient allowance/balance) bubble
from payment; `SafeERC20FailedOperation(address)` handles false-return tokens.
Checked price multiplication can revert with Solidity panic `0x11`.

For a quote of `p` over `d` days, approve `p*d` LEAS to the RentableNFT address,
then call `rent(id,d,p)`. Read or refresh the quote immediately before approval;
the price ceiling is still enforced if the owner changes the offer while either
transaction is pending. A stale quote can revert and leave an unused allowance;
the wallet can revoke that allowance through LEAS `approve(app,0)`.

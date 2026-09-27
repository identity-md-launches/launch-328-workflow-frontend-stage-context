// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC4907} from "./interfaces/IERC4907.sol";

/// @notice Free Lease Keys with noncustodial, fixed-duration rentals paid in LEAS.
/// @dev Unlike the ERC-4907 reference implementation, transfers never clear user assignments.
/// Active assignments cannot be changed, including assignments made without payment via setUser.
contract RentableNFT is ERC721, IERC4907, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Listing {
        address lister;
        uint256 pricePerDay;
    }

    struct UserInfo {
        address user;
        uint64 expires;
    }

    uint256 public constant MAX_SUPPLY = 3_000;
    uint256 public constant MAX_MINTS_PER_ADDRESS = 3;
    uint256 public constant MAX_RENTAL_DAYS = 30;

    IERC20 public immutable token;
    uint256 public totalMinted;
    mapping(address account => uint256 count) public mintedBy;

    mapping(uint256 tokenId => Listing) private _listings;
    mapping(uint256 tokenId => UserInfo) private _users;

    error InvalidToken();
    error MintLimitReached();
    error SoldOut();
    error NotTokenOwner();
    error InvalidPrice();
    error InvalidDays();
    error NotListed();
    error TokenInUse();
    error SelfRental();
    error PriceAboveMaximum();
    error ExpiryOverflow();

    event Listed(uint256 indexed tokenId, address indexed lister, uint256 pricePerDay);
    event Unlisted(uint256 indexed tokenId, address indexed lister);
    event Rented(
        uint256 indexed tokenId,
        address indexed renter,
        address indexed owner,
        uint256 rentalDays,
        uint256 cost,
        uint64 expires
    );

    /// @param leas The previously deployed LaunchToken ($token), never an arbitrary payment token.
    constructor(address leas) ERC721("Lease Keys", "LKEY") {
        if (leas.code.length == 0) revert InvalidToken();
        token = IERC20(leas);
    }

    /// @notice Mint one NFT, counting against the caller's lifetime allowance even after transfer.
    function mint() external nonReentrant returns (uint256 tokenId) {
        if (mintedBy[msg.sender] == MAX_MINTS_PER_ADDRESS) revert MintLimitReached();
        if (totalMinted == MAX_SUPPLY) revert SoldOut();
        ++mintedBy[msg.sender];
        tokenId = ++totalMinted;
        _safeMint(msg.sender, tokenId);
    }

    /// @notice Create or replace an offer. Existing usage rights are unaffected.
    function list(uint256 tokenId, uint256 pricePerDay) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (pricePerDay == 0) revert InvalidPrice();
        _listings[tokenId] = Listing(msg.sender, pricePerDay);
        emit Listed(tokenId, msg.sender, pricePerDay);
    }

    /// @notice Remove an offer without changing an existing user's rights. Idempotent.
    function unlist(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        delete _listings[tokenId];
        emit Unlisted(tokenId, msg.sender);
    }

    /// @notice Return the live offer, or (0, 0). Reverts for an unminted token.
    function listing(uint256 tokenId) external view returns (address lister, uint256 pricePerDay) {
        address owner = ownerOf(tokenId);
        Listing memory offer = _listings[tokenId];
        if (offer.lister == owner) return (offer.lister, offer.pricePerDay);
        return (address(0), 0);
    }

    /// @notice Pay the current owner directly and obtain usage for 1-30 whole days.
    /// @param maxPricePerDay The highest per-day price the renter consents to, in LEAS minor units.
    function rent(uint256 tokenId, uint256 rentalDays, uint256 maxPricePerDay) external nonReentrant {
        if (rentalDays == 0 || rentalDays > MAX_RENTAL_DAYS) revert InvalidDays();
        address owner = ownerOf(tokenId);
        Listing memory offer = _listings[tokenId];
        if (offer.lister != owner || offer.pricePerDay == 0) revert NotListed();
        if (userOf(tokenId) != address(0)) revert TokenInUse();
        if (msg.sender == owner) revert SelfRental();
        if (offer.pricePerDay > maxPricePerDay) revert PriceAboveMaximum();

        uint256 cost = offer.pricePerDay * rentalDays;
        uint256 duration = rentalDays * 1 days;
        if (block.timestamp > type(uint64).max - duration) revert ExpiryOverflow();
        // The preceding bound makes this narrowing conversion exact.
        uint64 expires = uint64(block.timestamp + duration);

        // Establish the usage right before the only external call; a payment failure reverts it.
        _users[tokenId] = UserInfo(msg.sender, expires);
        emit UpdateUser(tokenId, msg.sender, expires);
        token.safeTransferFrom(msg.sender, owner, cost);
        emit Rented(tokenId, msg.sender, owner, rentalDays, cost, expires);
    }

    /// @notice Owners and approved operators can assign users only while the NFT is available.
    /// @dev A nonzero user with a future expiry is irrevocable until expiry, even if assigned free.
    function setUser(uint256 tokenId, address user, uint64 expires) external override {
        address owner = _requireOwned(tokenId);
        _checkAuthorized(owner, msg.sender, tokenId);
        if (userOf(tokenId) != address(0)) revert TokenInUse();
        _users[tokenId] = UserInfo(user, expires);
        emit UpdateUser(tokenId, user, expires);
    }

    /// @notice Return zero at and after expiry, or when no user has been assigned.
    function userOf(uint256 tokenId) public view override returns (address) {
        UserInfo memory info = _users[tokenId];
        return info.expires > block.timestamp ? info.user : address(0);
    }

    /// @notice Last recorded expiry, including after it has elapsed; zero if never assigned.
    function userExpires(uint256 tokenId) external view override returns (uint256) {
        return _users[tokenId].expires;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC4907).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @dev Invalidate offers on every ownership change, including transfers away and back.
    /// No user write: sales and receiver callbacks cannot shorten paid usage.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && from != to && _listings[tokenId].lister != address(0)) {
            delete _listings[tokenId];
            emit Unlisted(tokenId, from);
        }
    }
}

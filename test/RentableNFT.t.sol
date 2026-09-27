// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {IERC20Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {RentableNFT} from "../src/RentableNFT.sol";
import {IERC4907} from "../src/interfaces/IERC4907.sol";

contract RentableNFTTest is Test {
    LaunchToken internal token;
    RentableNFT internal nft;
    address internal constant OWNER = address(0xA11CE);
    address internal constant RENTER = address(0xB0B);
    address internal constant BUYER = address(0xCAFE);
    address internal constant OPERATOR = address(0xD00D);
    uint256 internal constant FUNDS = 1e25;
    uint256 internal constant PRICE = 2 ether;

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

    function setUp() public {
        vm.warp(1_800_000_123);
        token = new LaunchToken();
        nft = new RentableNFT(address(token));
        token.transfer(RENTER, FUNDS);
        token.transfer(BUYER, FUNDS);
        vm.prank(RENTER);
        token.approve(address(nft), type(uint256).max);
        vm.prank(BUYER);
        token.approve(address(nft), type(uint256).max);
        vm.prank(OWNER);
        nft.mint();
    }

    function _list(uint256 price) internal {
        vm.prank(nft.ownerOf(1));
        nft.list(1, price);
    }

    function _rent(uint256 rentalDays) internal {
        _list(PRICE);
        vm.prank(RENTER);
        nft.rent(1, rentalDays, PRICE);
    }

    function _assertListing(address expectedOwner, uint256 expectedPrice) internal view {
        (address lister, uint256 price) = nft.listing(1);
        assertEq(lister, expectedOwner);
        assertEq(price, expectedPrice);
    }

    function _assertRental(uint256 expires) internal view {
        assertEq(nft.userOf(1), RENTER);
        assertEq(nft.userExpires(1), expires);
        assertEq(token.balanceOf(address(nft)), 0);
    }

    function test_metadataInterfacesAndInitialState() public view {
        assertEq(nft.name(), "Lease Keys");
        assertEq(nft.symbol(), "LKEY");
        assertEq(address(nft.token()), address(token));
        assertEq(nft.totalMinted(), 1);
        assertEq(nft.mintedBy(OWNER), 1);
        assertEq(nft.ownerOf(1), OWNER);
        assertEq(nft.userOf(1), address(0));
        assertEq(nft.userExpires(1), 0);
        assertEq(nft.userOf(3001), address(0));
        assertEq(nft.userExpires(3001), 0);
        assertEq(nft.tokenURI(1), "");
        assertEq(type(IERC4907).interfaceId, bytes4(0xad092b5c));
        assertTrue(nft.supportsInterface(0xad092b5c));
        assertTrue(nft.supportsInterface(0x80ac58cd));
        assertTrue(nft.supportsInterface(0x01ffc9a7));
        assertTrue(nft.supportsInterface(0x5b5e139f));
        assertFalse(nft.supportsInterface(0xffffffff));
        assertEq(token.balanceOf(address(nft)), 0);
        assertEq(address(nft).balance, 0);
        _assertListing(address(0), 0);
    }

    function test_constructorRejectsZeroAndNoncontractToken() public {
        vm.expectRevert(RentableNFT.InvalidToken.selector);
        new RentableNFT(address(0));
        vm.expectRevert(RentableNFT.InvalidToken.selector);
        new RentableNFT(OWNER);
    }

    function test_freeSequentialMintsAndLifetimeLimitAfterTransfer() public {
        vm.startPrank(OWNER);
        assertEq(nft.mint(), 2);
        assertEq(nft.mint(), 3);
        nft.transferFrom(OWNER, BUYER, 1);
        nft.transferFrom(OWNER, BUYER, 2);
        nft.transferFrom(OWNER, BUYER, 3);
        vm.expectRevert(RentableNFT.MintLimitReached.selector);
        nft.mint();
        vm.stopPrank();
        assertEq(nft.mintedBy(OWNER), 3);
        assertEq(nft.balanceOf(OWNER), 0);
        assertEq(nft.mintedBy(BUYER), 0);
        vm.prank(BUYER);
        assertEq(nft.mint(), 4);
        assertEq(nft.balanceOf(BUYER), 4);
    }

    function test_globalSupplyCap() public {
        for (uint256 i = 1; i <= 2999; ++i) {
            vm.prank(address(uint160(0x100000 + i / 3)));
            assertEq(nft.mint(), i + 1);
        }
        assertEq(nft.totalMinted(), 3000);
        assertEq(nft.ownerOf(3000), address(uint160(0x100000 + uint256(2999) / 3)));
        vm.expectRevert(RentableNFT.SoldOut.selector);
        vm.prank(BUYER);
        nft.mint();
        assertEq(nft.mintedBy(BUYER), 0);
    }

    function test_listingEventsReplacementAndIdempotentUnlist() public {
        vm.expectEmit(true, true, false, true, address(nft));
        emit Listed(1, OWNER, PRICE);
        _list(PRICE);
        _assertListing(OWNER, PRICE);
        _list(PRICE + 1);
        _assertListing(OWNER, PRICE + 1);
        vm.expectEmit(true, true, false, true, address(nft));
        emit Unlisted(1, OWNER);
        vm.startPrank(OWNER);
        nft.unlist(1);
        nft.unlist(1);
        vm.stopPrank();
        _assertListing(address(0), 0);
    }

    function test_onlyOwnerCanListOrUnlistEvenWithApproval() public {
        _list(PRICE);
        vm.prank(OWNER);
        nft.approve(OPERATOR, 1);
        vm.startPrank(OPERATOR);
        vm.expectRevert(RentableNFT.NotTokenOwner.selector);
        nft.list(1, PRICE);
        vm.expectRevert(RentableNFT.NotTokenOwner.selector);
        nft.unlist(1);
        vm.stopPrank();
        vm.prank(OWNER);
        nft.setApprovalForAll(OPERATOR, true);
        vm.expectRevert(RentableNFT.NotTokenOwner.selector);
        vm.prank(OPERATOR);
        nft.list(1, PRICE);
        vm.expectRevert(RentableNFT.NotTokenOwner.selector);
        vm.prank(RENTER);
        nft.unlist(1);
        _assertListing(OWNER, PRICE);
    }

    function test_zeroPriceAndNonexistentTokenRevert() public {
        vm.expectRevert(RentableNFT.InvalidPrice.selector);
        vm.prank(OWNER);
        nft.list(1, 0);
        bytes memory missing = abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 99);
        vm.startPrank(OWNER);
        vm.expectRevert(missing);
        nft.list(99, PRICE);
        vm.expectRevert(missing);
        nft.unlist(99);
        vm.expectRevert(missing);
        nft.setUser(99, RENTER, 1);
        vm.expectRevert(missing);
        nft.listing(99);
        vm.expectRevert(missing);
        nft.rent(99, 1, PRICE);
        vm.stopPrank();
    }

    function test_rentEventsExactPaymentAndPersistentListing() public {
        _list(PRICE);
        uint64 expires = uint64(vm.getBlockTimestamp() + 3 days);
        vm.expectEmit(true, true, false, true, address(nft));
        emit UpdateUser(1, RENTER, expires);
        vm.expectEmit(true, true, true, true, address(nft));
        emit Rented(1, RENTER, OWNER, 3, PRICE * 3, expires);
        vm.prank(RENTER);
        nft.rent(1, 3, PRICE);
        _assertRental(expires);
        _assertListing(OWNER, PRICE);
        assertEq(token.balanceOf(OWNER), PRICE * 3);
        assertEq(token.balanceOf(RENTER), FUNDS - PRICE * 3);
    }

    function test_unlistedAndExplicitlyUnlistedCannotRent() public {
        vm.expectRevert(RentableNFT.NotListed.selector);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        _list(PRICE);
        vm.prank(OWNER);
        nft.unlist(1);
        vm.expectRevert(RentableNFT.NotListed.selector);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        assertEq(token.balanceOf(RENTER), FUNDS);
    }

    function test_zeroAnd31DaysRevert() public {
        _list(PRICE);
        vm.startPrank(RENTER);
        vm.expectRevert(RentableNFT.InvalidDays.selector);
        nft.rent(1, 0, PRICE);
        vm.expectRevert(RentableNFT.InvalidDays.selector);
        nft.rent(1, 31, PRICE);
        vm.expectRevert(RentableNFT.InvalidDays.selector);
        nft.rent(1, type(uint256).max, PRICE);
        vm.stopPrank();
    }

    function test_selfRentReverts() public {
        _list(PRICE);
        vm.expectRevert(RentableNFT.SelfRental.selector);
        vm.prank(OWNER);
        nft.rent(1, 1, PRICE);
    }

    function test_priceFrontRunningRevertsBeforePayment() public {
        _list(PRICE);
        _list(PRICE + 1);
        vm.expectRevert(RentableNFT.PriceAboveMaximum.selector);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        assertEq(token.balanceOf(RENTER), FUNDS);
        assertEq(token.balanceOf(OWNER), 0);
        assertEq(nft.userOf(1), address(0));
        _list(PRICE - 1);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        assertEq(token.balanceOf(OWNER), PRICE - 1);
    }

    function test_noDoubleRentAndAvailableExactlyAtExpiry() public {
        _rent(1);
        uint256 expiry = nft.userExpires(1);
        vm.warp(expiry - 1);
        vm.expectRevert(RentableNFT.TokenInUse.selector);
        vm.prank(BUYER);
        nft.rent(1, 1, PRICE);
        vm.expectRevert(RentableNFT.TokenInUse.selector);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        vm.warp(expiry);
        assertEq(nft.userOf(1), address(0));
        assertEq(nft.userExpires(1), expiry);
        vm.prank(BUYER);
        nft.rent(1, 30, PRICE);
        assertEq(nft.userOf(1), BUYER);
        assertEq(nft.userExpires(1), expiry + 30 days);
        assertEq(token.balanceOf(OWNER), PRICE * 31);
    }

    function test_transferAwayAndBackNeverRevivesListing() public {
        _list(PRICE);
        vm.prank(OWNER);
        nft.transferFrom(OWNER, BUYER, 1);
        _assertListing(address(0), 0);
        vm.expectRevert(RentableNFT.NotListed.selector);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        vm.prank(BUYER);
        nft.transferFrom(BUYER, OWNER, 1);
        _assertListing(address(0), 0);
        vm.expectRevert(RentableNFT.NotListed.selector);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
    }

    function test_newOwnerMustRelistAndReceivesPayment() public {
        _list(PRICE);
        vm.prank(OWNER);
        nft.transferFrom(OWNER, BUYER, 1);
        vm.expectRevert(RentableNFT.NotTokenOwner.selector);
        vm.prank(OWNER);
        nft.list(1, PRICE);
        _list(PRICE + 1);
        vm.prank(RENTER);
        nft.rent(1, 2, PRICE + 1);
        assertEq(token.balanceOf(OWNER), 0);
        assertEq(token.balanceOf(BUYER), FUNDS + (PRICE + 1) * 2);
        assertEq(token.balanceOf(RENTER), FUNDS - (PRICE + 1) * 2);
        assertEq(token.balanceOf(address(nft)), 0);
    }

    function test_paidRentalSurvivesTransferToRenterAndSelfTransfer() public {
        _rent(30);
        uint256 expires = nft.userExpires(1);
        vm.prank(OWNER);
        nft.transferFrom(OWNER, OWNER, 1);
        _assertRental(expires);
        _assertListing(OWNER, PRICE);
        vm.prank(OWNER);
        nft.safeTransferFrom(OWNER, RENTER, 1);
        _assertRental(expires);
        _assertListing(address(0), 0);
        vm.expectRevert(RentableNFT.TokenInUse.selector);
        vm.prank(RENTER);
        nft.setUser(1, address(0), 0);
    }

    function test_ownerAndApprovedOperatorsCannotCutShortPaidRental() public {
        _rent(30);
        uint256 expires = nft.userExpires(1);
        vm.prank(OWNER);
        nft.approve(OPERATOR, 1);
        address[2] memory callers = [OWNER, OPERATOR];
        for (uint256 i; i < callers.length; ++i) {
            vm.startPrank(callers[i]);
            vm.expectRevert(RentableNFT.TokenInUse.selector);
            nft.setUser(1, address(0), 0);
            vm.expectRevert(RentableNFT.TokenInUse.selector);
            nft.setUser(1, RENTER, uint64(vm.getBlockTimestamp() + 1));
            vm.expectRevert(RentableNFT.TokenInUse.selector);
            nft.setUser(1, BUYER, uint64(expires + 1));
            vm.stopPrank();
            _assertRental(expires);
        }
        vm.prank(OWNER);
        nft.setApprovalForAll(BUYER, true);
        vm.expectRevert(RentableNFT.TokenInUse.selector);
        vm.prank(BUYER);
        nft.setUser(1, address(0), 0);
    }

    function test_setUserAuthorizationAndFreeAssignmentExpiry() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, BUYER, 1));
        vm.prank(BUYER);
        nft.setUser(1, BUYER, uint64(vm.getBlockTimestamp() + 1 days));
        vm.prank(OWNER);
        nft.approve(OPERATOR, 1);
        uint64 expiry = uint64(vm.getBlockTimestamp() + 1 days);
        vm.prank(OPERATOR);
        nft.setUser(1, RENTER, expiry);
        _list(PRICE);
        vm.expectRevert(RentableNFT.TokenInUse.selector);
        vm.prank(BUYER);
        nft.rent(1, 1, PRICE);
        vm.expectRevert(RentableNFT.TokenInUse.selector);
        vm.prank(OWNER);
        nft.setUser(1, address(0), 0);
        vm.warp(expiry);
        vm.prank(OPERATOR);
        nft.setUser(1, address(0), 0);
        assertEq(nft.userExpires(1), 0);
        vm.prank(OWNER);
        nft.setApprovalForAll(BUYER, true);
        vm.prank(BUYER);
        nft.setUser(1, RENTER, expiry + 1 days);
        assertEq(nft.userOf(1), RENTER);
        assertEq(token.balanceOf(OWNER), 0);
    }

    function test_zeroUserOrPastExpiryDoesNotLockRenting() public {
        vm.prank(OWNER);
        nft.setUser(1, address(0), type(uint64).max);
        vm.prank(OWNER);
        nft.setUser(1, RENTER, uint64(vm.getBlockTimestamp()));
        assertEq(nft.userOf(1), address(0));
        _rent(1);
        assertEq(nft.userOf(1), RENTER);
    }

    function test_insufficientAllowanceRollsBackEverythingAndCanRetry() public {
        _list(PRICE);
        vm.prank(RENTER);
        token.approve(address(nft), PRICE - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(nft), PRICE - 1, PRICE)
        );
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        assertEq(nft.userExpires(1), 0);
        assertEq(nft.userOf(1), address(0));
        assertEq(token.balanceOf(RENTER), FUNDS);
        assertEq(token.balanceOf(OWNER), 0);
        assertEq(token.balanceOf(address(nft)), 0);
        _assertListing(OWNER, PRICE);
        vm.prank(RENTER);
        token.approve(address(nft), PRICE);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        assertEq(token.allowance(RENTER, address(nft)), 0);
    }

    function test_insufficientBalanceRollsBackAllowanceAndUser() public {
        _list(PRICE);
        vm.startPrank(RENTER);
        token.transfer(BUYER, FUNDS);
        token.approve(address(nft), PRICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, RENTER, 0, PRICE));
        nft.rent(1, 1, PRICE);
        vm.stopPrank();
        assertEq(token.allowance(RENTER, address(nft)), PRICE);
        assertEq(nft.userExpires(1), 0);
        assertEq(token.balanceOf(OWNER), 0);
        assertEq(token.balanceOf(address(nft)), 0);
    }

    function test_arithmeticOverflowCannotGiveFreeRent() public {
        _list(type(uint256).max);
        vm.expectRevert(stdError.arithmeticError);
        vm.prank(RENTER);
        nft.rent(1, 2, type(uint256).max);
        assertEq(nft.userExpires(1), 0);
        assertEq(token.balanceOf(RENTER), FUNDS);
    }

    function test_expiryOverflowRevertsAndLargestRepresentableExpiryWorks() public {
        _list(PRICE);
        vm.warp(type(uint64).max - 1 days + 1);
        vm.expectRevert(RentableNFT.ExpiryOverflow.selector);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        vm.warp(type(uint64).max - 1 days);
        vm.prank(RENTER);
        nft.rent(1, 1, PRICE);
        assertEq(nft.userExpires(1), type(uint64).max);
        vm.warp(type(uint64).max);
        assertEq(nft.userOf(1), address(0));
    }

    function test_rejectsEthAndUnknownCalls() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(nft).call{value: 1}("");
        assertFalse(success);
        (success,) = address(nft).call{value: 1}(abi.encodeCall(nft.mint, ()));
        assertFalse(success);
        (success,) = address(nft).call(hex"deadbeef");
        assertFalse(success);
        assertEq(address(nft).balance, 0);
    }

    function testFuzz_rentPaymentAndExpiry(uint256 daysSeed, uint256 priceSeed, uint256 startSeed, uint256 warpSeed)
        public
    {
        uint256 rentalDays = bound(daysSeed, 1, 30);
        uint256 price = bound(priceSeed, 1, FUNDS / 30);
        uint256 start = bound(startSeed, 1, type(uint64).max - 31 days);
        vm.warp(start);
        _list(price);
        vm.prank(RENTER);
        nft.rent(1, rentalDays, price);
        uint256 cost = price * rentalDays;
        uint256 expiry = start + rentalDays * 1 days;
        assertEq(token.balanceOf(RENTER), FUNDS - cost);
        assertEq(token.balanceOf(OWNER), cost);
        assertEq(token.balanceOf(address(nft)), 0);
        assertEq(nft.userExpires(1), expiry);
        uint256 elapsed = bound(warpSeed, 0, rentalDays * 1 days + 1 days);
        vm.warp(start + elapsed);
        assertEq(nft.userOf(1), elapsed < rentalDays * 1 days ? RENTER : address(0));
        vm.warp(expiry - 1);
        assertEq(nft.userOf(1), RENTER);
        vm.warp(expiry);
        assertEq(nft.userOf(1), address(0));
        vm.warp(expiry + 1);
        assertEq(nft.userOf(1), address(0));
        assertEq(token.totalSupply(), 1e27);
    }

    function testFuzz_ownerActionsNeverEndPaidRental(uint256 daysSeed, uint256 priceSeed, uint256 warpSeed) public {
        uint256 rentalDays = bound(daysSeed, 1, 30);
        uint256 price = bound(priceSeed, 1, FUNDS / 30);
        _list(price);
        vm.prank(RENTER);
        nft.rent(1, rentalDays, price);
        uint256 expiry = nft.userExpires(1);
        vm.warp(vm.getBlockTimestamp() + bound(warpSeed, 0, rentalDays * 1 days - 1));
        vm.startPrank(OWNER);
        nft.unlist(1);
        nft.list(1, price + 1);
        nft.approve(OPERATOR, 1);
        vm.expectRevert(RentableNFT.TokenInUse.selector);
        nft.setUser(1, address(0), 0);
        vm.stopPrank();
        _assertRental(expiry);
        vm.prank(OPERATOR);
        nft.safeTransferFrom(OWNER, BUYER, 1, hex"1234");
        _assertRental(expiry);
        _assertListing(address(0), 0);
        vm.startPrank(BUYER);
        nft.list(1, price);
        nft.unlist(1);
        vm.expectRevert(RentableNFT.TokenInUse.selector);
        nft.setUser(1, BUYER, uint64(vm.getBlockTimestamp()));
        nft.transferFrom(BUYER, OWNER, 1);
        vm.stopPrank();
        _assertRental(expiry);
        _assertListing(address(0), 0);
        assertEq(token.balanceOf(OWNER), price * rentalDays);
        assertEq(token.balanceOf(BUYER), FUNDS);
        vm.warp(expiry);
        vm.prank(OWNER);
        nft.setUser(1, BUYER, uint64(expiry + 1));
        assertEq(nft.userOf(1), BUYER);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {RentableNFT} from "../src/RentableNFT.sol";

/// @dev Ghost accounting follows successful payments and immutable rental promises independently.
contract RentalHandler is Test {
    LaunchToken public immutable token;
    RentableNFT public immutable nft;
    address[4] public actors = [address(0xA001), address(0xA002), address(0xA003), address(0xA004)];
    mapping(address actor => uint256) public expectedBalance;
    mapping(uint256 id => address) public promisedUser;
    mapping(uint256 id => uint256) public promisedExpiry;

    constructor(LaunchToken token_, RentableNFT nft_) {
        token = token_;
        nft = nft_;
        for (uint256 i; i < actors.length; ++i) {
            expectedBalance[actors[i]] = 1e24;
            vm.startPrank(actors[i]);
            nft.mint();
            nft.list(i + 1, 1 ether);
            token.approve(address(nft), type(uint256).max);
            vm.stopPrank();
        }
    }

    function list(uint256 idSeed, uint256 priceSeed) external {
        uint256 id = bound(idSeed, 1, 4);
        vm.prank(nft.ownerOf(id));
        nft.list(id, bound(priceSeed, 1, 1e18));
    }

    function unlist(uint256 idSeed) external {
        uint256 id = bound(idSeed, 1, 4);
        vm.prank(nft.ownerOf(id));
        nft.unlist(id);
    }

    function transfer(uint256 idSeed, uint256 actorSeed) external {
        uint256 id = bound(idSeed, 1, 4);
        address owner = nft.ownerOf(id);
        address to = actors[actorSeed % actors.length];
        vm.prank(owner);
        nft.transferFrom(owner, to, id);
        if (owner != to) {
            (address lister, uint256 price) = nft.listing(id);
            assertEq(lister, address(0));
            assertEq(price, 0);
        }
    }

    function rent(uint256 idSeed, uint256 actorSeed, uint256 daysSeed) external {
        uint256 id = bound(idSeed, 1, 4);
        address renter = actors[actorSeed % actors.length];
        address owner = nft.ownerOf(id);
        (address lister, uint256 price) = nft.listing(id);
        if (renter == owner || lister == address(0) || nft.userOf(id) != address(0)) return;
        uint256 rentalDays = bound(daysSeed, 1, 30);
        uint256 cost = price * rentalDays;
        if (expectedBalance[renter] < cost) return;
        vm.prank(renter);
        nft.rent(id, rentalDays, price);
        expectedBalance[renter] -= cost;
        expectedBalance[owner] += cost;
        promisedUser[id] = renter;
        promisedExpiry[id] = vm.getBlockTimestamp() + rentalDays * 1 days;
    }

    function tryRevoke(uint256 idSeed) external {
        uint256 id = bound(idSeed, 1, 4);
        address owner = nft.ownerOf(id);
        if (promisedExpiry[id] > vm.getBlockTimestamp()) {
            vm.expectRevert(RentableNFT.TokenInUse.selector);
            vm.prank(owner);
            nft.setUser(id, address(0), 0);
        } else {
            vm.prank(owner);
            nft.setUser(id, address(0), 0);
            promisedUser[id] = address(0);
            promisedExpiry[id] = 0;
        }
    }

    function warp(uint256 elapsedSeed) external {
        vm.warp(vm.getBlockTimestamp() + bound(elapsedSeed, 0, 31 days));
    }
}

contract RentalInvariantTest is Test {
    LaunchToken internal token;
    RentableNFT internal nft;
    RentalHandler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new LaunchToken();
        nft = new RentableNFT(address(token));
        handler = new RentalHandler(token, nft);
        for (uint256 i; i < 4; ++i) {
            token.transfer(handler.actors(i), 1e24);
        }
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.list.selector;
        selectors[1] = handler.unlist.selector;
        selectors[2] = handler.transfer.selector;
        selectors[3] = handler.rent.selector;
        selectors[4] = handler.tryRevoke.selector;
        selectors[5] = handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_paymentsAreExactConservedAndNeverCustodied() public view {
        assertEq(token.balanceOf(address(nft)), 0);
        assertEq(address(nft).balance, 0);
        uint256 sum = token.balanceOf(address(this));
        for (uint256 i; i < 4; ++i) {
            address actor = handler.actors(i);
            assertEq(token.balanceOf(actor), handler.expectedBalance(actor));
            sum += token.balanceOf(actor);
        }
        assertEq(sum, token.totalSupply());
        assertEq(sum, 1e27);
    }

    function invariant_paidPromisesSurviveEveryOwnerActionUntilExpiry() public view {
        for (uint256 id = 1; id <= 4; ++id) {
            uint256 expiry = handler.promisedExpiry(id);
            assertEq(nft.userExpires(id), expiry);
            assertEq(nft.userOf(id), expiry > vm.getBlockTimestamp() ? handler.promisedUser(id) : address(0));
            (address lister, uint256 price) = nft.listing(id);
            if (lister == address(0)) {
                assertEq(price, 0);
            } else {
                assertEq(lister, nft.ownerOf(id));
                assertGt(price, 0);
            }
        }
    }
}

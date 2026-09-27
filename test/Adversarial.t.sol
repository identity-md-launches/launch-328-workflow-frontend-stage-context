// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {RentableNFT} from "../src/RentableNFT.sol";

contract MintReentrantReceiver is IERC721Receiver {
    RentableNFT internal immutable nft;
    bool public nestedSuccess;
    bytes public nestedResult;

    constructor(RentableNFT nft_) {
        nft = nft_;
    }

    function mintOne() external {
        nft.mint();
    }

    function onERC721Received(address, address, uint256 id, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(nft));
        (nestedSuccess, nestedResult) = address(nft).call(abi.encodeCall(nft.mint, ()));
        nft.transferFrom(address(this), address(0xCAFE), id);
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract RevokingReceiver is IERC721Receiver {
    RentableNFT internal immutable nft;
    bool public clearSucceeded;
    bool public shortenSucceeded;
    address public observedUser;
    uint256 public observedExpiry;

    constructor(RentableNFT nft_) {
        nft = nft_;
    }

    function onERC721Received(address, address, uint256 id, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(nft));
        (clearSucceeded,) = address(nft).call(abi.encodeCall(nft.setUser, (id, address(0), uint64(0))));
        (shortenSucceeded,) =
            address(nft).call(abi.encodeCall(nft.setUser, (id, address(this), uint64(block.timestamp + 1))));
        nft.list(id, 1);
        nft.unlist(id);
        nft.list(id, 2);
        nft.transferFrom(address(this), address(0xCAFE), id);
        observedUser = nft.userOf(id);
        observedExpiry = nft.userExpires(id);
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract RejectingReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0);
    }
}

/// @dev Exercises SafeERC20 failure handling and callbacks; production uses only LaunchToken.
contract PaymentDouble is ERC20 {
    uint256 public mode;
    bool public nestedSuccess;
    bytes public nestedResult;
    bool public revokeSuccess;
    bytes public revokeResult;
    error PaymentRejected();

    constructor() ERC20("Test payment", "TEST") {
        _mint(msg.sender, 1e27);
    }

    function setMode(uint256 mode_) external {
        mode = mode_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool result = super.transferFrom(from, to, amount);
        if (mode == 1) return false;
        if (mode == 2) revert PaymentRejected();
        if (mode == 3) {
            RentableNFT market = RentableNFT(msg.sender);
            (nestedSuccess, nestedResult) = msg.sender.call(abi.encodeCall(market.rent, (1, 1, amount)));
            (revokeSuccess, revokeResult) = msg.sender.call(abi.encodeCall(market.setUser, (1, address(0), uint64(0))));
        }
        if (mode == 4) {
            assembly ("memory-safe") { return(0, 0) }
        }
        return result;
    }
}

contract AdversarialTest is Test {
    LaunchToken internal token;
    RentableNFT internal nft;
    address internal constant OWNER = address(0xA11CE);
    address internal constant RENTER = address(0xB0B);

    function setUp() public {
        vm.warp(1_800_000_001);
        token = new LaunchToken();
        nft = new RentableNFT(address(token));
    }

    function _paidRental() internal returns (uint256 expiry) {
        vm.startPrank(OWNER);
        nft.mint();
        nft.list(1, 1 ether);
        vm.stopPrank();
        token.transfer(RENTER, 100 ether);
        vm.startPrank(RENTER);
        token.approve(address(nft), 10 ether);
        nft.rent(1, 10, 1 ether);
        vm.stopPrank();
        expiry = nft.userExpires(1);
    }

    function test_mintCallbackCannotReenterOrResetLifetimeCount() public {
        MintReentrantReceiver receiver = new MintReentrantReceiver(nft);
        for (uint256 i; i < 3; ++i) {
            receiver.mintOne();
            assertFalse(receiver.nestedSuccess());
            assertEq(
                receiver.nestedResult(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
            );
            assertEq(nft.mintedBy(address(receiver)), i + 1);
            assertEq(nft.totalMinted(), i + 1);
        }
        assertEq(nft.balanceOf(address(receiver)), 0);
        assertEq(nft.balanceOf(address(0xCAFE)), 3);
        vm.expectRevert(RentableNFT.MintLimitReached.selector);
        receiver.mintOne();
    }

    function test_rejectedMintRestoresCountersAndTokenId() public {
        RejectingReceiver receiver = new RejectingReceiver();
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(receiver)));
        vm.prank(address(receiver));
        nft.mint();
        assertEq(nft.totalMinted(), 0);
        assertEq(nft.mintedBy(address(receiver)), 0);
        vm.prank(OWNER);
        assertEq(nft.mint(), 1);
    }

    function test_newOwnerCallbackCannotRevokeRentalOrReviveListing() public {
        uint256 expiry = _paidRental();
        RevokingReceiver receiver = new RevokingReceiver(nft);
        vm.prank(OWNER);
        nft.safeTransferFrom(OWNER, address(receiver), 1);
        assertFalse(receiver.clearSucceeded());
        assertFalse(receiver.shortenSucceeded());
        assertEq(receiver.observedUser(), RENTER);
        assertEq(receiver.observedExpiry(), expiry);
        assertEq(nft.userOf(1), RENTER);
        assertEq(nft.userExpires(1), expiry);
        assertEq(nft.ownerOf(1), address(0xCAFE));
        (address lister, uint256 price) = nft.listing(1);
        assertEq(lister, address(0));
        assertEq(price, 0);
        assertEq(token.balanceOf(OWNER), 10 ether);
        assertEq(token.balanceOf(address(nft)), 0);
    }

    function test_rejectedTransferRestoresListingOwnershipAndRental() public {
        uint256 expiry = _paidRental();
        RejectingReceiver receiver = new RejectingReceiver();
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(receiver)));
        vm.prank(OWNER);
        nft.safeTransferFrom(OWNER, address(receiver), 1, hex"01");
        assertEq(nft.ownerOf(1), OWNER);
        assertEq(nft.userOf(1), RENTER);
        assertEq(nft.userExpires(1), expiry);
        (address lister, uint256 price) = nft.listing(1);
        assertEq(lister, OWNER);
        assertEq(price, 1 ether);
    }

    function _paymentMarket() internal returns (PaymentDouble payment, RentableNFT market) {
        payment = new PaymentDouble();
        market = new RentableNFT(address(payment));
        payment.transfer(RENTER, 100 ether);
        vm.startPrank(OWNER);
        market.mint();
        market.list(1, 1 ether);
        market.approve(address(payment), 1);
        vm.stopPrank();
        vm.prank(RENTER);
        payment.approve(address(market), 10 ether);
    }

    function test_falseReturnAndRevertUndoPaymentAndUserThenAllowRetry() public {
        (PaymentDouble payment, RentableNFT market) = _paymentMarket();
        for (uint256 mode = 1; mode <= 2; ++mode) {
            payment.setMode(mode);
            bytes memory expected = mode == 1
                ? abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(payment))
                : abi.encodeWithSelector(PaymentDouble.PaymentRejected.selector);
            vm.expectRevert(expected);
            vm.prank(RENTER);
            market.rent(1, 10, 1 ether);
            assertEq(market.userOf(1), address(0));
            assertEq(market.userExpires(1), 0);
            assertEq(payment.balanceOf(RENTER), 100 ether);
            assertEq(payment.balanceOf(OWNER), 0);
            assertEq(payment.balanceOf(address(market)), 0);
            assertEq(payment.allowance(RENTER, address(market)), 10 ether);
            (address lister, uint256 price) = market.listing(1);
            assertEq(lister, OWNER);
            assertEq(price, 1 ether);
        }
        payment.setMode(0);
        vm.prank(RENTER);
        market.rent(1, 10, 1 ether);
        assertEq(market.userOf(1), RENTER);
        assertEq(payment.balanceOf(OWNER), 10 ether);
    }

    function test_paymentCallbackCannotReenterOrRevokeAsApprovedOperator() public {
        (PaymentDouble payment, RentableNFT market) = _paymentMarket();
        payment.setMode(3);
        vm.prank(RENTER);
        market.rent(1, 10, 1 ether);
        assertFalse(payment.nestedSuccess());
        assertEq(payment.nestedResult(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertFalse(payment.revokeSuccess());
        assertEq(payment.revokeResult(), abi.encodeWithSelector(RentableNFT.TokenInUse.selector));
        assertEq(market.userOf(1), RENTER);
        assertEq(market.userExpires(1), block.timestamp + 10 days);
        assertEq(payment.balanceOf(OWNER), 10 ether);
        assertEq(payment.balanceOf(RENTER), 90 ether);
        assertEq(payment.balanceOf(address(market)), 0);
    }

    function test_safeTransferFromAcceptsEmptyReturnWithExactPayment() public {
        (PaymentDouble payment, RentableNFT market) = _paymentMarket();
        payment.setMode(4);
        vm.prank(RENTER);
        market.rent(1, 10, 1 ether);
        assertEq(market.userOf(1), RENTER);
        assertEq(payment.balanceOf(OWNER), 10 ether);
        assertEq(payment.balanceOf(RENTER), 90 ether);
        assertEq(payment.balanceOf(address(market)), 0);
    }
}

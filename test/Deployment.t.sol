// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {RentableNFT} from "../src/RentableNFT.sol";

/// @dev Local constructor probe, not the protocol ProjectFactory implementation.
contract ConstructorProbe {
    function deploy() external returns (LaunchToken token, RentableNFT app) {
        token = new LaunchToken{salt: bytes32(uint256(1))}();
        app = new RentableNFT{salt: bytes32(uint256(2))}(address(token));
    }
}

contract DeploymentTest is Test {
    function test_factoryDeploymentPreservesWholeSupplyAndNeedsNoInitialization() public {
        vm.chainId(11155111);
        ConstructorProbe factory = new ConstructorProbe();
        (LaunchToken token, RentableNFT app) = factory.deploy();
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(factory)), 1e27);
        assertEq(token.balanceOf(address(app)), 0);
        assertEq(address(app.token()), address(token));
        assertEq(app.totalMinted(), 0);
        assertEq(address(app).balance, 0);
        vm.prank(address(0xA11CE));
        assertEq(app.mint(), 1);
        _checkRuntime(address(token));
        _checkRuntime(address(app));
    }

    function test_constructorsAreNonpayable() public {
        vm.deal(address(this), 2);
        bytes memory tokenCode = type(LaunchToken).creationCode;
        address deployed;
        assembly ("memory-safe") { deployed := create(1, add(tokenCode, 32), mload(tokenCode)) }
        assertEq(deployed, address(0));
        LaunchToken token = new LaunchToken();
        bytes memory appCode = abi.encodePacked(type(RentableNFT).creationCode, abi.encode(address(token)));
        assembly ("memory-safe") { deployed := create(1, add(appCode, 32), mload(appCode)) }
        assertEq(deployed, address(0));
    }

    function _checkRuntime(address deployed) internal view {
        bytes memory code = deployed.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden runtime opcode");
        }
    }
}

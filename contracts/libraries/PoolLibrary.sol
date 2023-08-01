// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../core/interfaces/IPool.sol";

library PoolLibrary {

    /**
     * @notice returns sorted token addresses, used to handle return values from pairs sorted in this order
     */
    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, 'PoolLibrary: IDENTICAL_ADDRESSES');
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'PoolLibrary: ZERO_ADDRESS');
    }

    /**
     * @notice calculates the CREATE2 address for a pair without making any external calls
     */
    function pairFor(address factory, address tokenA, address tokenB) internal pure returns (address pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        pair = address(uint160(
                uint256(
                    keccak256(abi.encodePacked(
                        hex'ff',
                        factory,
                        keccak256(abi.encodePacked(token0, token1)),
                        hex'27e7b0e28764cf876d9963a758d8dac0a80c66556c27a051e874be11a0446945'
                    ))
                )
            ));
    }

    /**
     * @notice fetches and sorts the reserves for a pair
     */
    function getReserves(address factory, address tokenA, address tokenB) internal view returns (uint256 reserveA, uint256 reserveB) {
        (address token0,) = sortTokens(tokenA, tokenB);
        (uint256 reserve0, uint256 reserve1) = IPool(pairFor(factory, tokenA, tokenB)).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    /**
     * @notice given some amount of an asset and pair reserves, returns an equivalent amount of the other asset
     */
    function quote(uint256 amountA, address factory, address tokenA, address tokenB) internal view returns (uint256 amountB) {
        require(amountA > 0, 'PoolLibrary: INSUFFICIENT_AMOUNT');

        (address token0,) = sortTokens(tokenA, tokenB);
        (uint256 initReserve0, uint256 initReserve1) = IPool(pairFor(factory, tokenA, tokenB)).getInitialReserves();
        (uint256 reserveA, uint256 reserveB) = tokenA == token0 ? (initReserve0, initReserve1) : (initReserve1, initReserve0);

        amountB = Math.mulDiv(amountA, reserveB, reserveA);
    }

    /**
     * @notice performs chained getAmountOut calculations on any number of pairs
     */
    function getAmountsOut(address factory, uint256 amountIn, address[] memory path) internal view returns (uint256[] memory amounts) {
        require(path.length >= 2, 'PoolLibrary: INVALID_PATH');

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i; i < path.length - 1; i++) {
            amounts[i + 1] = quote(amounts[i], factory, path[i], path[i + 1]);
        }
    }
}
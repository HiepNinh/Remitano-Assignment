// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IFactory {
    event PoolCreated(address indexed token0, address indexed token1, address pair, uint256);

    function getPool(address tokenA, address tokenB) external view returns (address pair);
    function allPools(uint256) external view returns (address pair);
    function allPoolsLength() external view returns (uint256);

    function createPool(address tokenA, address tokenB) external returns (address pair);
}
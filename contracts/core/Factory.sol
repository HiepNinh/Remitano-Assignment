// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import './interfaces/IFactory.sol';
import "./Pool.sol";

contract UniswapV2Factory is IFactory, Context {
    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }

    function createPool(address tokenA, address tokenB) external returns (address pool) {
        require(tokenA != tokenB, 'Factory: IDENTICAL_ADDRESSES');
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'Factory: ZERO_ADDRESS');
        require(getPool[token0][token1] == address(0), 'Factory: POOL_EXISTS'); // single check is sufficient

        bytes memory bytecode = type(Pool).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pool := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        
        IPool(pool).initialize(token0, token1);
        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool; // populate mapping in the reverse direction
        allPools.push(pool);
        emit PoolCreated(token0, token1, pool, allPools.length);
    }
}
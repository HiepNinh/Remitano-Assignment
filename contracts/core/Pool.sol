// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IPool.sol";
import "./interfaces/ICallee.sol";
import "../token/ERC20AllowedZeroAddress.sol";

contract Pool is IPool, ERC20AllowedZeroAddress, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public factory;
    address public token0;
    address public token1;
    /// @notice initial reserve0
    uint112 private initReserve0;
    /// @notice initial reserve1
    uint112 private initReserve1;

    /// @notice uses single storage slot, accessible via getReserves
    uint112 private reserve0;
    /// @notice uses single storage slot, accessible via getReserves
    uint112 private reserve1;

    constructor() ERC20AllowedZeroAddress("Pool", "LP") {
        factory = _msgSender();
    }

    /**
     * @notice called once by the factory at time of deployment
     */
     function initialize(address _token0, address _token1) external {
        require(_msgSender() == factory, 'Pool: FORBIDDEN'); // sufficient check
        token0 = _token0;
        token1 = _token1;
    }

    function getInitialReserves() 
        public view returns 
    (
        uint112 _initReserve0, 
        uint112 _initReserve1
    )
    {
        _initReserve0 = initReserve0;
        _initReserve1 = initReserve1;
    }

    function getReserves() 
        public view returns 
    (
        uint112 _reserve0, 
        uint112 _reserve1
    ) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
    }

    /**
     * @notice this low-level function should be called from a contract which performs important safety checks
     */
     function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1) = getReserves(); // gas savings
        (uint112 _initReserve0, uint112 _initReserve1) = getInitialReserves(); // gas savings

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 totalLP = totalSupply(); // gas savings, must be defined here since totalSupply can update in _mintFee
        if (totalLP == 0) {
            liquidity = Math.sqrt(amount0 * amount1);
            initReserve0 = uint112(amount0);
            initReserve1 = uint112(amount1);
        } else {
            liquidity = Math.min(
                Math.mulDiv(amount0, totalLP, _initReserve0), 
                Math.mulDiv(amount1, totalLP, _initReserve1)
            );
        }
        require(liquidity > 0, 'POOL: INSUFFICIENT_LIQUIDITY_MINTED');
        _mint(to, liquidity);

        _update(balance0, balance1);
        emit Mint(_msgSender(), amount0, amount1);
    }

    /**
     * @notice this low-level function should be called from a contract which performs important safety checks
     */
    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        address _token0 = token0;                                // gas savings
        address _token1 = token1;                                // gas savings
        uint256 balance0 = IERC20(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20(_token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));

        uint256 totalLP = totalSupply(); // gas savings, must be defined here since totalSupply can update in _mintFee
        amount0 = Math.mulDiv(liquidity, balance0, totalLP); // using balances ensures pro-rata distribution
        amount1 = Math.mulDiv(liquidity, balance1, totalLP); // using balances ensures pro-rata distribution
        require(amount0 > 0 && amount1 > 0, 'POOL: INSUFFICIENT_LIQUIDITY_BURNED');

        _burn(address(this), liquidity);

        IERC20(_token0).safeTransfer(to, amount0);
        IERC20(_token1).safeTransfer(to, amount1);

        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));

        _update(balance0, balance1);
        emit Burn(_msgSender(), amount0, amount1, to);
    }

    /**
     * @notice this low-level function should be called from a contract which performs important safety checks
     */
     function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external nonReentrant {
        require(amount0Out > 0 || amount1Out > 0, 'POOL: INSUFFICIENT_OUTPUT_AMOUNT');
        require(amount0Out == 0 || amount1Out == 0, 'POOL: Invalid Input Output');
        (uint112 _reserve0, uint112 _reserve1) = getReserves(); // gas savings
        require(amount0Out < _reserve0 && amount1Out < _reserve1, 'POOL: INSUFFICIENT_LIQUIDITY');

        uint256 balance0;
        uint256 balance1;
        { // avoids stack too deep errors
            address _token0 = token0;
            address _token1 = token1;
            require(to != _token0 && to != _token1, 'POOL: INVALID_TO');
        
            if (amount0Out > 0) IERC20(_token0).safeTransfer(to, amount0Out); // optimistically transfer tokens
            if (amount1Out > 0) IERC20(_token1).safeTransfer(to, amount1Out); // optimistically transfer tokens

            // Enable for flashswap
            if (data.length > 0) ICallee(to).callee(_msgSender(), amount0Out, amount1Out, data);

            balance0 = IERC20(_token0).balanceOf(address(this));
            balance1 = IERC20(_token1).balanceOf(address(this));
        }

        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, 'POOL: INSUFFICIENT_INPUT_AMOUNT');

        { // avoids stack too deep errors
            (uint112 _initReserve0, uint112 _initReserve1) = getInitialReserves(); // gas savings

            if(amount0In > 0) {
                require(Math.mulDiv(
                    amount0In, 
                    uint256(_initReserve1), 
                    uint256(_initReserve0)
                ) >= uint256(amount1Out), "POOL: Invalid Input Output");
            }

            if(amount1In > 0) {
                require(Math.mulDiv(
                    amount1In, 
                    uint256(_initReserve0), 
                    uint256(_initReserve1)
                ) >= uint256(amount0Out), "POOL: Invalid Input Output");
            }
        }

        _update(balance0, balance1);
        emit Swap(_msgSender(), amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /**
     * @notice update reserves and, on the first call per block, price accumulators
     */
     function _update(uint256 balance0, uint256 balance1) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, 'POOL: OVERFLOW');

        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        emit Sync(reserve0, reserve1);
    }
}
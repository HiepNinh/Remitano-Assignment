// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IRouter.sol";
import "./interfaces/IWETH.sol";
import "./libraries/PoolLibrary.sol";
import "./core/interfaces/IFactory.sol";

contract Router is IRouter, Context {
    using SafeERC20 for IERC20;

    address public immutable override factory;
    address public immutable override WETH;

    constructor(address _factory, address _WETH) {
        factory = _factory;
        WETH = _WETH;
    }

    receive() external payable {
        assert(_msgSender() == WETH); // only accept ETH via fallback from the WETH contract
    }

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'ROUTER: EXPIRED');
        _;
    }

    //***************************************************************************************
    //*                              ADD LIQUIDITY SECTION                                  *
    //***************************************************************************************
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal virtual returns (uint256 amountA, uint256 amountB) {
        // create the pair if it doesn't exist yet
        if (IFactory(factory).getPool(tokenA, tokenB) == address(0)) {
            IFactory(factory).createPool(tokenA, tokenB);
        }
        // get reserves for calculating optimal amounts deposited
        (uint256 reserveA, uint256 reserveB) = PoolLibrary.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = PoolLibrary.quote(amountADesired, factory, tokenA, tokenB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, 'Router: INSUFFICIENT_B_AMOUNT');
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = PoolLibrary.quote(amountBDesired, factory, tokenB, tokenA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, 'Router: INSUFFICIENT_A_AMOUNT');
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external virtual override ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        (amountA, amountB) = _addLiquidity(
            tokenA, 
            tokenB, 
            amountADesired, 
            amountBDesired, 
            amountAMin, 
            amountBMin
        );

        liquidity = _tokenTransferOnAddLiquidity(
            tokenA,
            tokenB,
            amountA,
            amountB,
            to
        );
    }

    /**
     * @dev This function is used to avoids stack too deep errors
     */
     function _tokenTransferOnAddLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA, 
        uint256 amountB,
        address to
    ) private returns (uint256) {
        address pool = PoolLibrary.pairFor(factory, tokenA, tokenB);
        IERC20(tokenA).safeTransferFrom(_msgSender(), pool, amountA);
        IERC20(tokenB).safeTransferFrom(_msgSender(), pool, amountB);

        return IPool(pool).mint(to);
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external virtual override payable ensure(deadline) returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        (amountToken, amountETH) = _addLiquidity(
            token,
            WETH,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountETHMin
        );

        address pool = PoolLibrary.pairFor(factory, token, WETH);
        IERC20(token).safeTransferFrom(_msgSender(), pool, amountToken);

        IWETH(WETH).deposit{value: amountETH}();
        assert(IWETH(WETH).transfer(pool, amountETH));

        liquidity = IPool(pool).mint(to);
        // refund dust eth, if any
        if (msg.value > amountETH) {
            payable(to).transfer(msg.value - amountETH);
        }
    }

    //***************************************************************************************
    //*                              REMOVE LIQUIDITY SECTION                               *
    //***************************************************************************************
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) public virtual override ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pool = PoolLibrary.pairFor(factory, tokenA, tokenB);
        /// send liquidity to pair (pair is also in the form of the ERC-20)
        IERC20(pool).safeTransferFrom(_msgSender(), pool, liquidity);

        (uint256 amount0, uint256 amount1) = IPool(pool).burn(to);
        (address token0,) = PoolLibrary.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);

        require(amountA >= amountAMin, 'Router: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'Router: INSUFFICIENT_B_AMOUNT');
    }

    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH) {
        (amountToken, amountETH) = removeLiquidity(
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this),
            deadline
        );

        IERC20(token).safeTransfer(to, amountToken);
        IWETH(WETH).withdraw(amountETH);
        payable(to).transfer(amountETH);
    }

     //***************************************************************************************
    //*                                    SWAP SECTION                                     *
    //***************************************************************************************
     /**
     * @notice requires the initial amount to have already been sent to the first pair
     */
     function _swap(uint256[] memory amounts, address[] memory path, address _to) internal virtual {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = PoolLibrary.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];

            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address to = i < path.length - 2 ? PoolLibrary.pairFor(factory, output, path[i + 2]) : _to;
            
            IPool(PoolLibrary.pairFor(factory, input, output))
                .swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    function swapTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external virtual override ensure(deadline) returns (uint256[] memory amounts) {
        amounts = PoolLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'Router: INSUFFICIENT_OUTPUT_AMOUNT');

        IERC20(path[0]).safeTransferFrom(
            _msgSender(), 
            PoolLibrary.pairFor(factory, path[0], path[1]), 
            amounts[0]
        );

        _swap(amounts, path, to);
    }

    function swapETHForTokens(
        uint256 amountOutMin, 
        address[] calldata path, 
        address to, 
        uint256 deadline
    ) external virtual override payable ensure(deadline) returns (uint256[] memory amounts) {
        require(path[0] == WETH, 'Router: INVALID_PATH');

        amounts = PoolLibrary.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'Router: INSUFFICIENT_OUTPUT_AMOUNT');

        IWETH(WETH).deposit{value: amounts[0]}();
        assert(IWETH(WETH).transfer(
            PoolLibrary.pairFor(factory, path[0], path[1]), 
            amounts[0]
        ));

        _swap(amounts, path, to);
    }

    function swapTokensForETH(
        uint256 amountIn, 
        uint256 amountOutMin, 
        address[] calldata path, 
        address to, 
        uint256 deadline
    ) external virtual override ensure(deadline) returns (uint256[] memory amounts) {
        require(path[path.length - 1] == WETH, 'Router: INVALID_PATH');

        amounts = PoolLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'Router: INSUFFICIENT_OUTPUT_AMOUNT');

        IERC20(path[0]).safeTransferFrom(
            _msgSender(), 
            PoolLibrary.pairFor(factory, path[0], path[1]), 
            amounts[0]
        );

        _swap(amounts, path, address(this));

        IWETH(WETH).withdraw(amounts[amounts.length - 1]);
        payable(to).transfer(amounts[amounts.length - 1]);
    }
}
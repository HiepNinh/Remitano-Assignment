import hre, { ethers, network } from "hardhat";
import chai from "chai";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MockERC20, UniswapV2Factory, UniswapV2Pair } from "../typechain";

const expect = chai.expect;
const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3);
const INITIAL_MINTED = ethers.utils.parseEther(BigNumber.from(1e10).toString());

let deployer: SignerWithAddress;
let liquidityProvider: SignerWithAddress;
let trader1st: SignerWithAddress;
let trader2nd: SignerWithAddress;
let feeTo: SignerWithAddress;

let factory: UniswapV2Factory;
let tokenA: MockERC20;
let tokenB: MockERC20;
let pair: UniswapV2Pair;

const mint = async (recipient: SignerWithAddress) => {
  const mintATx = await tokenA
    .connect(deployer)
    .mint(await recipient.getAddress(), INITIAL_MINTED);
  await mintATx.wait();
  const mintBTx = await tokenB
    .connect(deployer)
    .mint(await recipient.getAddress(), INITIAL_MINTED);
  await mintBTx.wait();
};

const checkingApproximateEqually = (
  firstNum: BigNumber,
  secondNum: BigNumber
) => {
  return firstNum.gt(secondNum)
    ? firstNum.div(secondNum).eq(1)
    : secondNum.div(firstNum).eq(1);
};

describe("UniswapV2Pair", function () {
  this.timeout(1000000);

  this.beforeAll(async () => {
    await network.provider.send("evm_setIntervalMining", [1000]);
  });

  this.beforeEach(async () => {
    /// Setup signers
    [deployer, liquidityProvider, trader1st, trader2nd, feeTo] =
      await ethers.getSigners();

    /// Deploy contract
    /// ============== Deploy Factory ==============
    const UniswapFactory = await ethers.getContractFactory("UniswapV2Factory");
    factory = await UniswapFactory.connect(deployer).deploy(
      await deployer.getAddress() /// feeToSetter
    );
    await factory.deployed();

    /// ============== Deploy Token ==============
    const TokenFactory = await ethers.getContractFactory("MockERC20");
    tokenA = await TokenFactory.connect(deployer).deploy();
    tokenB = await TokenFactory.connect(deployer).deploy();

    /// ============== Create pair ==============
    const pairTx = await factory
      .connect(liquidityProvider)
      .createPair(tokenA.address, tokenB.address);
    await pairTx.wait();

    const PairFactory = await ethers.getContractFactory("UniswapV2Pair");
    pair = PairFactory.attach(
      await factory.getPair(tokenA.address, tokenB.address)
    );

    /// ============== Mint token for liquidity ==============
    await mint(liquidityProvider);
    await mint(trader1st);
    await mint(trader2nd);
  });

  ///***********************************************************************************/
  ///***********************          Pair Functions           ***********************/
  ///***********************************************************************************/

  /// ============== Add Liquidity ==============
  const addLiquidity = async (
    tokenAAmount: BigNumber,
    tokenBAmount: BigNumber
  ) => {
    const txA = await tokenA
      .connect(liquidityProvider)
      .transfer(pair.address, tokenAAmount);
    await txA.wait();
    const txB = await tokenB
      .connect(liquidityProvider)
      .transfer(pair.address, tokenBAmount);
    await txB.wait();

    const mintTx = await pair
      .connect(liquidityProvider)
      .mint(await liquidityProvider.getAddress());
    return mintTx;
  };

  /// ============== Remove Liquidity ==============
  const removeLiquidity = async (shares: BigNumber) => {
    const tx = await pair
      .connect(liquidityProvider)
      .transfer(pair.address, shares);
    await tx.wait();

    const burnTx = await pair
      .connect(liquidityProvider)
      .burn(await liquidityProvider.getAddress());
    return burnTx;
  };

  const swap = async (
    amount0Out: BigNumber,
    amount1Out: BigNumber,
    swapAmount: BigNumber,
    token: any,
    trader: SignerWithAddress
  ) => {
    /// Tranfer must be call first
    const transferTx = await token
      .connect(trader)
      .transfer(pair.address, swapAmount);
    await transferTx.wait();

    await expect(
      pair
        .connect(trader)
        .swap(amount0Out, amount1Out.add(1), await trader.getAddress(), "0x")
    ).to.be.revertedWith("UniswapV2: K");

    const swapTx = await pair
      .connect(trader)
      .swap(amount0Out, amount1Out, await trader.getAddress(), "0x");
    return swapTx;
  };

  /// ============== FeeTo Amount Minted ==============
  /// sm = [s1 * (√k2 − √k1)] / (5 * √k2 + √k1) where as (φ = 1/6)
  const feeToAmount = async (
    kLast: BigNumber,
    totalSupply: BigNumber,
    reserve0: BigNumber,
    reserve1: BigNumber
  ) => {
    const rootK = sqrt(reserve0.mul(reserve1));
    const rooKLast = sqrt(kLast);

    const numerator = totalSupply.mul(rootK.sub(rooKLast));
    const denominator = rootK.mul(5).add(rooKLast);

    return numerator.div(denominator);
  };

  /// ============== Get Amount Out ==============
  const getAmountOut = (
    amountIn: BigNumber,
    reserveIn: BigNumber,
    reserveOut: BigNumber
  ) => {
    let numberator = amountIn.mul(997).mul(reserveOut);
    let denominator = reserveIn.mul(1000).add(amountIn.mul(997));

    return numberator.div(denominator);
  };

  ///***********************************************************************************/
  ///***********************          Helper Functions           ***********************/
  ///***********************************************************************************/

  /// ============== Random Int number ==============
  const getRandomInt = (min: number, max: number) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    // The maximum is exclusive and the minimum is inclusive
    return Math.floor(Math.random() * (max - min) + min);
  };

  /// ============== Swap Amount ==============
  /// Automated generate swap amount in the range [X%_TOKEN_VOLUME; X%_TOKEN_VOLUME)
  const getSwapAmount = (totalVolume: BigNumber, range: [number, number]) => {
    return BigNumber.from(getRandomInt(...range))
      .mul(totalVolume)
      .div(100);
  };

  /// ============== Sleep ==============
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /// ============== BigNumber SQRT ==============
  const sqrt = (value: BigNumber) => {
    const ONE = ethers.BigNumber.from(1);
    const TWO = ethers.BigNumber.from(2);

    let x = value;
    let z = x.add(ONE).div(TWO);
    let y = x;
    while (z.sub(y).isNegative()) {
      y = z;
      z = x.div(z).add(z).div(TWO);
    }
    return y;
  };

  it("mint", async () => {
    const amountA = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenA liquidity
    const amountB = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenB liquidity
    const expectedLiquidity = INITIAL_MINTED.mul(50).div(100); /// sqrt(amountA * amountB)

    const token0 = await pair.token0();
    const [token0Amount, token1Amount] =
      tokenA.address == token0 ? [amountA, amountB] : [amountB, amountA];

    const tx = await addLiquidity(amountA, amountB);
    await expect(tx)
      .to.emit(pair, "Transfer")
      .withArgs(
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        MINIMUM_LIQUIDITY
      )
      .to.emit(pair, "Transfer")
      .withArgs(
        ethers.constants.AddressZero,
        await liquidityProvider.getAddress(),
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      .to.emit(pair, "Sync")
      .withArgs(token0Amount, token1Amount)
      .to.emit(pair, "Mint")
      .withArgs(
        await liquidityProvider.getAddress(),
        token0Amount,
        token1Amount
      );

    expect(await pair.totalSupply()).to.equal(expectedLiquidity);
    expect(await pair.balanceOf(await liquidityProvider.getAddress())).to.equal(
      expectedLiquidity.sub(MINIMUM_LIQUIDITY)
    );
    expect(await tokenA.balanceOf(pair.address)).to.equal(amountA);
    expect(await tokenB.balanceOf(pair.address)).to.equal(amountB);

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.equal(token0Amount);
    expect(reserves[1]).to.equal(token1Amount);
  });

  it("burn", async () => {
    const amountA = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenA liquidity
    const amountB = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenB liquidity
    const expectedLiquidity = INITIAL_MINTED.mul(50).div(100); /// sqrt(amountA * amountB)
    /// This is only happen when both criterias are satisfied:
    /// - Pair has only one Liquidity Provider
    /// - LP provided the same amount of both token causes the rate is equal (1:1),
    ///   which means shares = SQRT(tokenAmount ** 2) = tokenAmount
    const remainLockedToken = MINIMUM_LIQUIDITY;
    const token0Addr = await pair.token0();

    const [token0, token1] =
      tokenA.address == token0Addr
        ? [tokenA.address, tokenB.address]
        : [tokenB.address, tokenA.address];

    const [token0Amount, token1Amount] =
      tokenA.address == token0Addr ? [amountA, amountB] : [amountB, amountA];

    /// Add Liquidity
    const mintTx = await addLiquidity(amountA, amountB);
    await mintTx.wait();

    /// Remove Liquidity
    const burnTx = await removeLiquidity(
      expectedLiquidity.sub(MINIMUM_LIQUIDITY)
    );
    await expect(burnTx)
      .to.emit(pair, "Transfer")
      .withArgs(
        pair.address,
        ethers.constants.AddressZero,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      )
      .to.emit(token0, "Transfer")
      .withArgs(
        pair.address,
        await liquidityProvider.getAddress(),
        token0Amount.sub(remainLockedToken)
      )
      .to.emit(token1, "Transfer")
      .withArgs(
        pair.address,
        await liquidityProvider.getAddress(),
        token1Amount.sub(remainLockedToken)
      )
      .to.emit(pair, "Sync")
      .withArgs(remainLockedToken, remainLockedToken)
      .to.emit(pair, "Burn")
      .withArgs(
        await liquidityProvider.getAddress(),
        token0Amount.sub(remainLockedToken),
        token1Amount.sub(remainLockedToken),
        await liquidityProvider.getAddress()
      );

    expect(await pair.balanceOf(await liquidityProvider.getAddress())).to.eq(0);
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);

    expect(await tokenA.balanceOf(pair.address)).to.eq(1000);
    expect(await tokenB.balanceOf(pair.address)).to.eq(1000);

    expect(await tokenA.balanceOf(await liquidityProvider.getAddress())).to.eq(
      INITIAL_MINTED.sub(1000)
    );
    expect(await tokenA.balanceOf(await liquidityProvider.getAddress())).to.eq(
      INITIAL_MINTED.sub(1000)
    );
  });

  it("swap:token0", async () => {
    const amountA = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenA liquidity
    const amountB = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenB liquidity

    /// Add Liquidity
    const mintTx = await addLiquidity(amountA, amountB);
    await mintTx.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [reserve0, reserve1] = await pair.getReserves();

    const swapAmount = getSwapAmount(reserve0, [1, 7]); // [1%_RESERVE_0; 7%_RESERVE_0)
    const amountOut = getAmountOut(swapAmount, reserve0, reserve1);

    await expect(
      swap(BigNumber.from(0), amountOut, swapAmount, token0, trader1st)
    )
      .to.emit(token1, "Transfer")
      .withArgs(pair.address, await trader1st.getAddress(), amountOut)
      .to.emit(pair, "Sync")
      .withArgs(reserve0.add(swapAmount), reserve1.sub(amountOut))
      .to.emit(pair, "Swap")
      .withArgs(
        await trader1st.getAddress(),
        swapAmount,
        0,
        0,
        amountOut,
        await trader1st.getAddress()
      );

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(reserve0.add(swapAmount));
    expect(reserves[1]).to.eq(reserve1.sub(amountOut));
    expect(await token0.balanceOf(pair.address)).to.eq(
      reserve0.add(swapAmount)
    );
    expect(await token1.balanceOf(pair.address)).to.eq(reserve1.sub(amountOut));

    expect(await token0.balanceOf(await trader1st.getAddress())).to.eq(
      INITIAL_MINTED.sub(swapAmount)
    );
    expect(await token1.balanceOf(await trader1st.getAddress())).to.eq(
      INITIAL_MINTED.add(amountOut)
    );
  });

  it("swap:token1", async () => {
    const amountA = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenA liquidity
    const amountB = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenB liquidity

    /// Add Liquidity
    const mintTx = await addLiquidity(amountA, amountB);
    await mintTx.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [reserve0, reserve1] = await pair.getReserves();

    const swapAmount = getSwapAmount(reserve1, [1, 7]); // [1%_RESERVE_0; 7%_RESERVE_0)
    const amountOut = getAmountOut(swapAmount, reserve1, reserve0);

    await expect(
      swap(amountOut, BigNumber.from(0), swapAmount, token1, trader1st)
    )
      .to.emit(token0, "Transfer")
      .withArgs(pair.address, await trader1st.getAddress(), amountOut)
      .to.emit(pair, "Sync")
      .withArgs(reserve0.sub(amountOut), reserve1.add(swapAmount))
      .to.emit(pair, "Swap")
      .withArgs(
        await trader1st.getAddress(),
        0,
        swapAmount,
        amountOut,
        0,
        await trader1st.getAddress()
      );

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(reserve0.sub(amountOut));
    expect(reserves[1]).to.eq(reserve1.add(swapAmount));
    expect(await token0.balanceOf(pair.address)).to.eq(reserve0.sub(amountOut));
    expect(await token1.balanceOf(pair.address)).to.eq(
      reserve1.add(swapAmount)
    );

    expect(await token0.balanceOf(await trader1st.getAddress())).to.eq(
      INITIAL_MINTED.add(amountOut)
    );
    expect(await token1.balanceOf(await trader1st.getAddress())).to.eq(
      INITIAL_MINTED.sub(swapAmount)
    );
  });

  it("price{0,1}CumulativeLast", async () => {
    const amountA = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenA liquidity
    const amountB = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenB liquidity

    /// Add Liquidity
    const mintTx = await addLiquidity(amountA, amountB);
    await mintTx.wait();
    let lastBlockTimestamp = (await pair.getReserves())[2];

    await sleep(1000);
    let [price0Cumulative, price1Cumulative] = [
      await pair.price0CumulativeLast(),
      await pair.price1CumulativeLast(),
    ];
    expect(price0Cumulative).to.eq(0);
    expect(price1Cumulative).to.eq(0);

    /// Call to force sync
    let [reserve0, reserve1] = await pair.getReserves();
    const syncTx = await pair.sync();
    await syncTx.wait();
    let [, , currentBlockTimestamp] = await pair.getReserves();

    await sleep(1000);
    [price0Cumulative, price1Cumulative] = [
      await pair.price0CumulativeLast(),
      await pair.price1CumulativeLast(),
    ];
    expect(price0Cumulative).to.eq(
      reserve1
        .mul(BigNumber.from(2).pow(112))
        .div(reserve0)
        .mul(currentBlockTimestamp - lastBlockTimestamp)
    );
    expect(price1Cumulative).to.eq(
      reserve0
        .mul(BigNumber.from(2).pow(112))
        .div(reserve1)
        .mul(currentBlockTimestamp - lastBlockTimestamp)
    );

    /// Swap 0 -> 1
    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    [reserve0, reserve1] = await pair.getReserves();

    let [oldPrice0Cumulative, oldPrice1Cumulative] = [
      price0Cumulative,
      price1Cumulative,
    ];
    lastBlockTimestamp = currentBlockTimestamp;

    let swapAmount = getSwapAmount(reserve0, [1, 7]); // [1%_RESERVE_0; 7%_RESERVE_0)
    let amountOut = getAmountOut(swapAmount, reserve0, reserve1);

    let swapTx = await swap(
      BigNumber.from(0),
      amountOut,
      swapAmount,
      token0,
      trader1st
    );
    await swapTx.wait();
    [, , currentBlockTimestamp] = await pair.getReserves();

    await sleep(1000);
    [price0Cumulative, price1Cumulative] = [
      await pair.price0CumulativeLast(),
      await pair.price1CumulativeLast(),
    ];
    expect(price0Cumulative).to.eq(
      reserve1
        .mul(BigNumber.from(2).pow(112))
        .div(reserve0)
        .mul(currentBlockTimestamp - lastBlockTimestamp)
        .add(oldPrice0Cumulative)
    );
    expect(price1Cumulative).to.eq(
      reserve0
        .mul(BigNumber.from(2).pow(112))
        .div(reserve1)
        .mul(currentBlockTimestamp - lastBlockTimestamp)
        .add(oldPrice1Cumulative)
    );

    /// Swap 1 -> 0
    [reserve0, reserve1] = await pair.getReserves();

    [oldPrice0Cumulative, oldPrice1Cumulative] = [
      price0Cumulative,
      price1Cumulative,
    ];
    lastBlockTimestamp = currentBlockTimestamp;

    swapAmount = getSwapAmount(reserve1, [1, 7]); // [1%_RESERVE_0; 7%_RESERVE_0)
    amountOut = getAmountOut(swapAmount, reserve1, reserve0);

    swapTx = await swap(
      amountOut,
      BigNumber.from(0),
      swapAmount,
      token1,
      trader1st
    );
    await swapTx.wait();
    [, , currentBlockTimestamp] = await pair.getReserves();

    await sleep(1000);
    [price0Cumulative, price1Cumulative] = [
      await pair.price0CumulativeLast(),
      await pair.price1CumulativeLast(),
    ];
    expect(price0Cumulative).to.eq(
      reserve1
        .mul(BigNumber.from(2).pow(112))
        .div(reserve0)
        .mul(currentBlockTimestamp - lastBlockTimestamp)
        .add(oldPrice0Cumulative)
    );
    expect(price1Cumulative).to.eq(
      reserve0
        .mul(BigNumber.from(2).pow(112))
        .div(reserve1)
        .mul(currentBlockTimestamp - lastBlockTimestamp)
        .add(oldPrice1Cumulative)
    );
  });

  it("feeTo:off", async () => {
    const amountA = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenA liquidity
    const amountB = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenB liquidity

    /// Add Liquidity
    const mintTx = await addLiquidity(amountA, amountB);
    await mintTx.wait();

    /// Swap
    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [reserve0, reserve1] = await pair.getReserves();

    const swapAmount = getSwapAmount(reserve0, [1, 7]); // [1%_RESERVE_0; 7%_RESERVE_0)
    const amountOut = getAmountOut(swapAmount, reserve0, reserve1);

    const swapTx = await swap(
      BigNumber.from(0),
      amountOut,
      swapAmount,
      token0,
      trader1st
    );
    await swapTx.wait();

    /// Remove Liquidity
    const expectedLiquidity = INITIAL_MINTED.mul(50).div(100); /// sqrt(amountA * amountB)
    const burnTx = await removeLiquidity(
      expectedLiquidity.sub(MINIMUM_LIQUIDITY)
    );
    await burnTx.wait();
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
  });

  it("feeTo:on", async () => {
    /// Set FeeTo address
    const feeToTx = await factory.setFeeTo(await feeTo.getAddress());
    await feeToTx.wait();

    const amountA = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenA liquidity
    const amountB = INITIAL_MINTED.mul(50).div(100); /// 50% of initial minted used as tokenB liquidity

    /// Add Liquidity
    const mintTx = await addLiquidity(amountA, amountB);
    await mintTx.wait();

    let kLast = await pair.kLast();

    /// Swap
    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [reserve0, reserve1] = await pair.getReserves();

    const swapAmount = getSwapAmount(reserve0, [1, 7]); // [1%_RESERVE_0; 7%_RESERVE_0)
    const amountOut = getAmountOut(swapAmount, reserve0, reserve1);

    const swapTx = await swap(
      BigNumber.from(0),
      amountOut,
      swapAmount,
      token0,
      trader1st
    );
    await swapTx.wait();

    /// Prepare data for next check
    const totalSupply = await pair.totalSupply();
    [reserve0, reserve1] = await pair.getReserves();

    /// Remove Liquidity
    const expectedLiquidity = INITIAL_MINTED.mul(50).div(100); /// sqrt(amountA * amountB)
    const burnTx = await removeLiquidity(
      expectedLiquidity.sub(MINIMUM_LIQUIDITY)
    );
    await burnTx.wait();

    /// Calculating the amount of minted for feeTo
    const feeMinted = await feeToAmount(kLast, totalSupply, reserve0, reserve1);

    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY.add(feeMinted));
    expect(await pair.balanceOf(await feeTo.getAddress())).to.eq(feeMinted);

    expect(
      checkingApproximateEqually(
        await token0.balanceOf(pair.address),
        reserve0
          .mul(MINIMUM_LIQUIDITY.add(feeMinted))
          .div(totalSupply.add(feeMinted))
      )
    ).to.eq(true);
    expect(
      checkingApproximateEqually(
        await token1.balanceOf(pair.address),
        reserve1
          .mul(MINIMUM_LIQUIDITY.add(feeMinted))
          .div(totalSupply.add(feeMinted))
      )
    ).to.eq(true);
  });
});

import hre, { ethers, network } from "hardhat";
import chai from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { MockERC20, Factory, Pool, Router, WETH9 } from "../typechain";
import { getCreate2Address } from "./helpers/create2.helper";

const expect = chai.expect;
const INITIAL_MINTED = ethers.utils.parseEther(BigNumber.from(1e10).toString());

let deployer: SignerWithAddress;
let liquidityProvider: SignerWithAddress;
let trader1st: SignerWithAddress;
let trader2nd: SignerWithAddress;

let factory: Factory;
let tokenA: MockERC20;
let tokenB: MockERC20;
let WETH: WETH9;
let pool: Pool;
let router: Router;

///***********************************************************************************/
///***********************          Token Functions           ***********************/
///***********************************************************************************/

/// ============== Mint tokens ==============
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

///***********************************************************************************/
///***********************          Router Functions           ***********************/
///***********************************************************************************/

/// ============== Add Liquidity ==============
const addLiquidity = async (
  token0: any,
  token1: any,
  amount0: BigNumber,
  amount1: BigNumber
) => {
  await token0
    .connect(liquidityProvider)
    .approve(router.address, ethers.constants.MaxUint256);
  if (token1.address != WETH.address) {
    await token1
      .connect(liquidityProvider)
      .approve(router.address, ethers.constants.MaxUint256);
  }

  let addTx: any;
  if (token1.address != WETH.address) {
    addTx = await router.connect(liquidityProvider).addLiquidity(
      token0.address,
      token1.address,
      amount0,
      amount1,
      0, // amountAMin
      0, // amountBMin
      await liquidityProvider.getAddress(),
      ethers.constants.MaxUint256 // deadline - only for testing, don't set MAX on prod
    );
  } else {
    addTx = await router.connect(liquidityProvider).addLiquidityETH(
      token0.address,
      amount0,
      0,
      0,
      await liquidityProvider.getAddress(),
      ethers.constants.MaxUint256, // deadline - only for testing, don't set MAX on prod,
      { value: amount1 }
    );
  }
  await addTx.wait();

  const { bytecode } = await hre.artifacts.readArtifact("Pool");
  const create2Address = getCreate2Address(
    factory.address,
    [token0.address, token1.address],
    bytecode
  );
  const PoolFactory = await ethers.getContractFactory("Pool");
  pool = PoolFactory.attach(create2Address);

  return addTx;
};

/// ============== Remove Liquidity ==============
const removeLiquidity = async (token0: any, token1: any, shares: BigNumber) => {
  const approveTx = await pool
    .connect(liquidityProvider)
    .approve(router.address, ethers.constants.MaxUint256);
  await approveTx.wait();

  let removeTx: any;
  if (token1.address != WETH.address) {
    removeTx = await router
      .connect(liquidityProvider)
      .removeLiquidity(
        token0.address,
        token1.address,
        shares,
        0,
        0,
        await liquidityProvider.getAddress(),
        ethers.constants.MaxUint256
      );
  } else {
    removeTx = await router
      .connect(liquidityProvider)
      .removeLiquidityETH(
        token0.address,
        shares,
        0,
        0,
        await liquidityProvider.getAddress(),
        ethers.constants.MaxUint256
      );
  }
  await removeTx.wait();

  return removeTx;
};

///***********************************************************************************/
///***********************          Helper Functions           ***********************/
///***********************************************************************************/

/// ============== Approximate equally checking ==============
const checkingApproximateEqually = (
  firstNum: BigNumber,
  secondNum: BigNumber
) => {
  return firstNum.gt(secondNum)
    ? firstNum.div(secondNum).eq(1)
    : secondNum.div(firstNum).eq(1);
};

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

describe("Router", function () {
  this.timeout(1000000);

  this.beforeAll(async () => {
    await network.provider.send("evm_setIntervalMining", [1000]);
  });

  this.beforeEach(async () => {
    /// Setup signers
    [deployer, liquidityProvider, trader1st, trader2nd] =
      await ethers.getSigners();

    /// Deploy contract
    /// ============== Deploy Factory ==============
    const RegisterFactory = await ethers.getContractFactory("Factory");
    factory = await RegisterFactory.connect(deployer).deploy();
    await factory.deployed();

    /// ============== Deploy Token ==============
    const TokenFactory = await ethers.getContractFactory("MockERC20");
    tokenA = await TokenFactory.connect(deployer).deploy();
    tokenB = await TokenFactory.connect(deployer).deploy();
    const WETHFactory = await ethers.getContractFactory("WETH9");
    WETH = await WETHFactory.connect(deployer).deploy();

    /// ============== Create Router ==============
    const RouterFactory = await ethers.getContractFactory("Router");
    router = await RouterFactory.connect(deployer).deploy(
      factory.address,
      WETH.address
    );

    /// ============== Mint token for liquidity ==============
    await mint(liquidityProvider);
    await mint(trader1st);
    await mint(trader2nd);
  });

  this.afterEach(async () => {
    expect(await ethers.provider.getBalance(router.address)).to.eq(
      ethers.constants.Zero
    );
  });

  describe("Router ADD / REMOVE", () => {
    it("factory, WETH", async () => {
      expect(await router.factory()).to.eq(factory.address);
      expect(await router.WETH()).to.eq(WETH.address);
    });

    it("addLiquidity", async () => {
      const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
      const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1
      const expectedLiquidity = sqrt(amountA.mul(amountB)); /// sqrt(amountA * amountB)

      let [amount0, amount1] =
        tokenA.address < tokenB.address
          ? [amountA, amountB]
          : [amountB, amountA];
      let addTx = await addLiquidity(tokenA, tokenB, amountA, amountB);

      await expect(addTx)
        .to.emit(tokenA, "Transfer")
        .withArgs(await liquidityProvider.getAddress(), pool.address, amountA)
        .to.emit(tokenB, "Transfer")
        .withArgs(await liquidityProvider.getAddress(), pool.address, amountB)
        .to.emit(pool, "Transfer")
        .withArgs(
          ethers.constants.AddressZero,
          await liquidityProvider.getAddress(),
          expectedLiquidity
        )
        .to.emit(pool, "Sync")
        .withArgs(amount0, amount1)
        .to.emit(pool, "Mint")
        .withArgs(router.address, amount0, amount1);

      expect(await pool.balanceOf(await liquidityProvider.getAddress())).to.eq(
        expectedLiquidity
      );
    });

    it("addLiquidityETH", async () => {
      const amountA = ethers.utils.parseEther(BigNumber.from(1000).toString()); /// rate 10:1
      const ETHAmount = ethers.utils.parseEther(BigNumber.from(100).toString()); /// rate 1:10
      const expectedLiquidity = sqrt(amountA.mul(ETHAmount)); /// sqrt(amountA * amountB)

      let [amount0, amount1] =
        tokenA.address < WETH.address
          ? [amountA, ETHAmount]
          : [ETHAmount, amountA];
      let addTx = await addLiquidity(tokenA, WETH, amountA, ETHAmount);

      await expect(addTx)
        .to.emit(tokenA, "Transfer")
        .withArgs(await liquidityProvider.getAddress(), pool.address, amountA)
        .to.emit(pool, "Transfer")
        .withArgs(
          ethers.constants.AddressZero,
          await liquidityProvider.getAddress(),
          expectedLiquidity
        )
        .to.emit(pool, "Sync")
        .withArgs(amount0, amount1)
        .to.emit(pool, "Mint")
        .withArgs(router.address, amount0, amount1);

      expect(await pool.balanceOf(await liquidityProvider.getAddress())).to.eq(
        expectedLiquidity
      );
    });

    it("removeLiquidity", async () => {
      const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
      const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1
      const expectedLiquidity = sqrt(amountA.mul(amountB)); /// sqrt(amountA * amountB)

      /// Add Liquidity
      await addLiquidity(tokenA, tokenB, amountA, amountB);

      /// Prepare data for next check
      const [token0, token1] =
        tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
      const totalSupply = await pool.totalSupply();
      let [reserve0, reserve1] = await pool.getReserves();

      /// Remove Liquidity
      let removeTx = await removeLiquidity(tokenA, tokenB, expectedLiquidity);
      await expect(removeTx)
        .to.emit(pool, "Transfer")
        .withArgs(
          await liquidityProvider.getAddress(),
          pool.address,
          expectedLiquidity
        )
        .to.emit(pool, "Transfer")
        .withArgs(pool.address, ethers.constants.AddressZero, expectedLiquidity)
        .to.emit(token0, "Transfer")
        .withArgs(
          pool.address,
          await liquidityProvider.getAddress(),
          expectedLiquidity.mul(reserve0).div(totalSupply)
        )
        .to.emit(token1, "Transfer")
        .withArgs(
          pool.address,
          await liquidityProvider.getAddress(),
          expectedLiquidity.mul(reserve1).div(totalSupply)
        )
        .to.emit(pool, "Sync")
        .withArgs(0, 0)
        .to.emit(pool, "Burn")
        .withArgs(
          router.address,
          expectedLiquidity.mul(reserve0).div(totalSupply),
          expectedLiquidity.mul(reserve1).div(totalSupply),
          await liquidityProvider.getAddress()
        );
    });

    it("removeLiquidityETH", async () => {
      const amountA = ethers.utils.parseEther(BigNumber.from(1000).toString()); /// rate 10:1
      const ETHAmount = ethers.utils.parseEther(BigNumber.from(100).toString()); /// rate 1:10
      const expectedLiquidity = sqrt(amountA.mul(ETHAmount)); /// sqrt(amountA * amountB)

      /// Add Liquidity
      await addLiquidity(tokenA, WETH, amountA, ETHAmount);

      /// Prepare data for next check
      const [token0, token1] =
        tokenA.address < WETH.address ? [tokenA, WETH] : [WETH, tokenA];
      const totalSupply = await pool.totalSupply();
      let [reserve0, reserve1] = await pool.getReserves();
      let [reserveA, reserveEth] =
        tokenA.address == token0.address
          ? [reserve0, reserve1]
          : [reserve1, reserve0];

      /// Remove Liquidity
      let removeTx = await removeLiquidity(tokenA, WETH, expectedLiquidity);
      await expect(removeTx)
        .to.emit(pool, "Transfer")
        .withArgs(
          await liquidityProvider.getAddress(),
          pool.address,
          expectedLiquidity
        )
        .to.emit(pool, "Transfer")
        .withArgs(pool.address, ethers.constants.AddressZero, expectedLiquidity)
        .to.emit(token0, "Transfer")
        .withArgs(
          pool.address,
          router.address,
          expectedLiquidity.mul(reserve0).div(totalSupply)
        )
        .to.emit(token1, "Transfer")
        .withArgs(
          pool.address,
          router.address,
          expectedLiquidity.mul(reserve1).div(totalSupply)
        )
        .to.emit(tokenA, "Transfer")
        .withArgs(
          pool.address,
          await liquidityProvider.getAddress(),
          expectedLiquidity.mul(reserveA).div(totalSupply)
        )
        .to.emit(WETH, "Withdrawal")
        .withArgs(
          router.address,
          expectedLiquidity.mul(reserveEth).div(totalSupply)
        )
        .to.emit(pool, "Sync")
        .withArgs(0, 0)
        .to.emit(pool, "Burn")
        .withArgs(
          router.address,
          expectedLiquidity.mul(reserve0).div(totalSupply),
          expectedLiquidity.mul(reserve1).div(totalSupply),
          router.address
        );
    });
  });

  describe("swapTokensForTokens", () => {
    it("happy path", async () => {
      const amount0 = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
      const amount1 = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1

      const [token0, token1] =
        tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
      await addLiquidity(token0, token1, amount0, amount1);

      /// Get reserve
      let [reserve0, reserve1] = await pool.getReserves();
      let [initialReserve0, initialReserve1] = await pool.getInitialReserves();

      /// Approve for Router send trader's asset
      const approveTx = await token0
        .connect(trader1st)
        .approve(router.address, ethers.constants.MaxUint256);
      await approveTx.wait();

      /// Swap token0 -> token1
      const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
      const amountOut = swapAmount.mul(initialReserve1).div(initialReserve0);

      /// Swap
      await expect(
        router
          .connect(trader1st)
          .swapTokensForTokens(
            swapAmount,
            0,
            [token0.address, token1.address],
            await trader1st.getAddress(),
            ethers.constants.MaxUint256
          )
      )
        .to.emit(token0, "Transfer")
        .withArgs(await trader1st.getAddress(), pool.address, swapAmount)
        .to.emit(token1, "Transfer")
        .withArgs(pool.address, await trader1st.getAddress(), amountOut)
        .to.emit(pool, "Sync")
        .withArgs(reserve0.add(swapAmount), reserve1.sub(amountOut))
        .to.emit(pool, "Swap")
        .withArgs(
          router.address,
          swapAmount,
          0,
          0,
          amountOut,
          await trader1st.getAddress()
        );
    });
  });

  describe("swapETHForTokens", () => {
    it("happy path", async () => {
      const amountA = ethers.utils.parseEther(BigNumber.from(1000).toString()); /// rate 10:1
      const ETHAmount = ethers.utils.parseEther(BigNumber.from(100).toString()); /// rate 1:10
      await addLiquidity(tokenA, WETH, amountA, ETHAmount);

      /// Get reserve
      let [reserve0, reserve1] = await pool.getReserves();
      let [reserveA, reserveETH] =
        tokenA.address < WETH.address
          ? [reserve0, reserve1]
          : [reserve1, reserve0];

      let [initialReserve0, initialReserve1] = await pool.getInitialReserves();
      let [initReserveA, initReserveETH] =
        tokenA.address < WETH.address
          ? [initialReserve0, initialReserve1]
          : [initialReserve1, initialReserve0];

      /// Swap ETH -> A
      const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
      const amountOut = swapAmount.mul(initReserveA).div(initReserveETH);

      await expect(
        router
          .connect(trader1st)
          .swapETHForTokens(
            0,
            [WETH.address, tokenA.address],
            await trader1st.getAddress(),
            ethers.constants.MaxUint256,
            {
              value: swapAmount,
            }
          )
      )
        .to.emit(WETH, "Deposit")
        .withArgs(router.address, swapAmount)
        .to.emit(WETH, "Transfer")
        .withArgs(router.address, pool.address, swapAmount)
        .to.emit(tokenA, "Transfer")
        .withArgs(pool.address, await trader1st.getAddress(), amountOut)
        .to.emit(pool, "Sync")
        .withArgs(
          tokenA.address < WETH.address
            ? reserveA.sub(amountOut)
            : reserveETH.add(swapAmount),
          tokenA.address < WETH.address
            ? reserveETH.add(swapAmount)
            : reserveA.sub(amountOut)
        )
        .to.emit(pool, "Swap")
        .withArgs(
          router.address,
          tokenA.address < WETH.address ? 0 : swapAmount,
          tokenA.address < WETH.address ? swapAmount : 0,
          tokenA.address < WETH.address ? amountOut : 0,
          tokenA.address < WETH.address ? 0 : amountOut,
          await trader1st.getAddress()
        );
    });
  });

  describe("swapExactTokensForETH", () => {
    it("happy path", async () => {
      const amountA = ethers.utils.parseEther(BigNumber.from(1000).toString()); /// rate 10:1
      const ETHAmount = ethers.utils.parseEther(BigNumber.from(100).toString()); /// rate 1:10
      await addLiquidity(tokenA, WETH, amountA, ETHAmount);

      /// Get reserve
      let [reserve0, reserve1] = await pool.getReserves();
      let [reserveA, reserveETH] =
        tokenA.address < WETH.address
          ? [reserve0, reserve1]
          : [reserve1, reserve0];

      let [initialReserve0, initialReserve1] = await pool.getInitialReserves();
      let [initReserveA, initReserveETH] =
        tokenA.address < WETH.address
          ? [initialReserve0, initialReserve1]
          : [initialReserve1, initialReserve0];

      /// Swap A -> ETH
      const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
      const amountOut = swapAmount.mul(initReserveETH).div(initReserveA);

      /// Approve for Router send trader's asset
      const approveTx = await tokenA
        .connect(trader1st)
        .approve(router.address, ethers.constants.MaxUint256);
      await approveTx.wait();

      await expect(
        router
          .connect(trader1st)
          .swapTokensForETH(
            swapAmount,
            0,
            [tokenA.address, WETH.address],
            await trader1st.getAddress(),
            ethers.constants.MaxUint256
          )
      )
        .to.emit(tokenA, "Transfer")
        .withArgs(await trader1st.getAddress(), pool.address, swapAmount)
        .to.emit(WETH, "Transfer")
        .withArgs(pool.address, router.address, amountOut)
        .to.emit(pool, "Sync")
        .withArgs(
          tokenA.address < WETH.address
            ? reserveA.add(swapAmount)
            : reserveETH.sub(amountOut),
          tokenA.address < WETH.address
            ? reserveETH.sub(amountOut)
            : reserveA.add(swapAmount)
        )
        .to.emit(pool, "Swap")
        .withArgs(
          router.address,
          tokenA.address < WETH.address ? swapAmount : 0,
          tokenA.address < WETH.address ? 0 : swapAmount,
          tokenA.address < WETH.address ? 0 : amountOut,
          tokenA.address < WETH.address ? amountOut : 0,
          router.address
        );
    });
  });
});

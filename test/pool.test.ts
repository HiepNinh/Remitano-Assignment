import { ethers } from "hardhat";
import chai from "chai";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MockERC20, Factory, Pool } from "../typechain";

const expect = chai.expect;
const INITIAL_MINTED = ethers.utils.parseEther(BigNumber.from(1e10).toString());

let deployer: SignerWithAddress;
let liquidityProvider: SignerWithAddress;
let trader1st: SignerWithAddress;
let trader2nd: SignerWithAddress;

let factory: Factory;
let tokenA: MockERC20;
let tokenB: MockERC20;
let pool: Pool;

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
///***********************          Pair Functions           ***********************/
///***********************************************************************************/

/// ============== Add Liquidity ==============
const addLiquidity = async (
  tokenAAmount: BigNumber,
  tokenBAmount: BigNumber
) => {
  const txA = await tokenA
    .connect(liquidityProvider)
    .transfer(pool.address, tokenAAmount);
  await txA.wait();

  const txB = await tokenB
    .connect(liquidityProvider)
    .transfer(pool.address, tokenBAmount);
  await txB.wait();

  const mintTx = await pool
    .connect(liquidityProvider)
    .mint(await liquidityProvider.getAddress());
  return mintTx;
};

/// ============== Remove Liquidity ==============
const removeLiquidity = async (shares: BigNumber) => {
  const tx = await pool
    .connect(liquidityProvider)
    .transfer(pool.address, shares);
  await tx.wait();

  const burnTx = await pool
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
    .transfer(pool.address, swapAmount);
  await transferTx.wait();

  const swapTx = await pool
    .connect(trader)
    .swap(amount0Out, amount1Out, await trader.getAddress(), "0x");
  return swapTx;
};

///***********************************************************************************/
///***********************          Helper Functions           ***********************/
///***********************************************************************************/

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

describe("Pool", function () {
  this.timeout(1000000);

  this.beforeEach(async () => {
    /// Setup signers
    [deployer, liquidityProvider, trader1st, trader2nd] =
      await ethers.getSigners();

    /// Deploy contract
    /// ============== Deploy Factory ==============
    const RegistryFactory = await ethers.getContractFactory("Factory");
    factory = await RegistryFactory.connect(deployer).deploy();
    await factory.deployed();

    /// ============== Deploy Token ==============
    const TokenFactory = await ethers.getContractFactory("MockERC20");
    tokenA = await TokenFactory.connect(deployer).deploy();
    tokenB = await TokenFactory.connect(deployer).deploy();

    /// ============== Create pair ==============
    const createPoolTx = await factory
      .connect(liquidityProvider)
      .createPool(tokenA.address, tokenB.address);
    await createPoolTx.wait();

    const PoolFactory = await ethers.getContractFactory("Pool");
    pool = PoolFactory.attach(
      await factory.getPool(tokenA.address, tokenB.address)
    );

    /// ============== Mint token for liquidity ==============
    await mint(liquidityProvider);
    await mint(trader1st);
    await mint(trader2nd);
  });

  it("mint", async () => {
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1
    const expectedLiquidity = sqrt(amountA.mul(amountB)); /// sqrt(amountA * amountB)

    const token0 = await pool.token0();
    const [token0Amount, token1Amount] =
      tokenA.address == token0 ? [amountA, amountB] : [amountB, amountA];

    const tx = await addLiquidity(amountA, amountB);
    await expect(tx)
      .to.emit(pool, "Transfer")
      .withArgs(
        ethers.constants.AddressZero,
        await liquidityProvider.getAddress(),
        expectedLiquidity
      )
      .to.emit(pool, "Sync")
      .withArgs(token0Amount, token1Amount)
      .to.emit(pool, "Mint")
      .withArgs(
        await liquidityProvider.getAddress(),
        token0Amount,
        token1Amount
      );

    expect(await pool.totalSupply()).to.equal(expectedLiquidity);
    expect(await pool.balanceOf(await liquidityProvider.getAddress())).to.equal(
      expectedLiquidity
    );
    expect(await tokenA.balanceOf(pool.address)).to.equal(amountA);
    expect(await tokenB.balanceOf(pool.address)).to.equal(amountB);

    const reserves = await pool.getReserves();
    expect(reserves[0]).to.equal(token0Amount);
    expect(reserves[1]).to.equal(token1Amount);
  });

  it("mint:different-rate", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1
    const firstLp = sqrt(amountA.mul(amountB)); /// sqrt(amountA * amountB)

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    /// Second adding liquidity
    const amountA2nd = ethers.utils.parseEther(BigNumber.from(100).toString()); /// rate 1:15
    const amountB2nd = ethers.utils.parseEther(BigNumber.from(1500).toString()); /// rate 15:1
    const expectedLiquidity = amountA2nd
      .mul(await pool.totalSupply())
      .div(amountA);

    const token0 = await pool.token0();
    let accumulativeA = amountA.add(amountA2nd);
    let accumulativeB = amountB.add(amountB2nd);
    const [token0Amount, token1Amount] =
      tokenA.address == token0
        ? [accumulativeA, accumulativeB]
        : [accumulativeB, accumulativeA];

    const tx2nd = await addLiquidity(amountA2nd, amountB2nd);
    await expect(tx2nd)
      .to.emit(pool, "Transfer")
      .withArgs(
        ethers.constants.AddressZero,
        await liquidityProvider.getAddress(),
        expectedLiquidity
      )
      .to.emit(pool, "Sync")
      .withArgs(token0Amount, token1Amount)
      .to.emit(pool, "Mint")
      .withArgs(
        await liquidityProvider.getAddress(),
        tokenA.address == token0 ? amountA2nd : amountB2nd,
        tokenA.address == token0 ? amountB2nd : amountA2nd
      );

    expect(await pool.totalSupply()).to.equal(firstLp.add(expectedLiquidity));
    expect(await pool.balanceOf(await liquidityProvider.getAddress())).to.equal(
      firstLp.add(expectedLiquidity)
    );
    expect(await tokenA.balanceOf(pool.address)).to.equal(accumulativeA);
    expect(await tokenB.balanceOf(pool.address)).to.equal(accumulativeB);

    const reserves = await pool.getReserves();
    expect(reserves[0]).to.equal(token0Amount);
    expect(reserves[1]).to.equal(token1Amount);

    const initiReserves = await pool.getInitialReserves();
    expect(initiReserves[0]).to.equal(
      tokenA.address == token0 ? amountA : amountB
    );
    expect(initiReserves[1]).to.equal(
      tokenA.address == token0 ? amountB : amountA
    );
  });

  it("burn", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1
    const firstLp = sqrt(amountA.mul(amountB)); /// sqrt(amountA * amountB)

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    const token0Addr = await pool.token0();
    const [token0, token1] =
      tokenA.address == token0Addr
        ? [tokenA.address, tokenB.address]
        : [tokenB.address, tokenA.address];
    const [token0Amount, token1Amount] =
      tokenA.address == token0Addr ? [amountA, amountB] : [amountB, amountA];

    /// Remove Liquidity
    const burnTx = await removeLiquidity(firstLp);
    await expect(burnTx)
      .to.emit(pool, "Transfer")
      .withArgs(pool.address, ethers.constants.AddressZero, firstLp)
      .to.emit(token0, "Transfer")
      .withArgs(
        pool.address,
        await liquidityProvider.getAddress(),
        token0Amount
      )
      .to.emit(token1, "Transfer")
      .withArgs(
        pool.address,
        await liquidityProvider.getAddress(),
        token1Amount
      )
      .to.emit(pool, "Sync")
      .withArgs(0, 0)
      .to.emit(pool, "Burn")
      .withArgs(
        await liquidityProvider.getAddress(),
        token0Amount,
        token1Amount,
        await liquidityProvider.getAddress()
      );

    expect(await pool.balanceOf(await liquidityProvider.getAddress())).to.eq(0);
    expect(await pool.totalSupply()).to.eq(0);

    expect(await tokenA.balanceOf(pool.address)).to.eq(0);
    expect(await tokenB.balanceOf(pool.address)).to.eq(0);

    expect(await tokenA.balanceOf(await liquidityProvider.getAddress())).to.eq(
      INITIAL_MINTED
    );
    expect(await tokenA.balanceOf(await liquidityProvider.getAddress())).to.eq(
      INITIAL_MINTED
    );
  });

  it("burn:different-rate", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1
    const firstLp = sqrt(amountA.mul(amountB)); /// sqrt(amountA * amountB)

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    /// Second adding liquidity
    const amountA2nd = ethers.utils.parseEther(BigNumber.from(100).toString()); /// rate 1:15
    const amountB2nd = ethers.utils.parseEther(BigNumber.from(1500).toString()); /// rate 15:1
    const secondLp = amountA2nd.mul(await pool.totalSupply()).div(amountA);

    const tx2 = await addLiquidity(amountA2nd, amountB2nd);
    await tx2.wait();

    const token0Addr = await pool.token0();
    const [token0, token1] =
      tokenA.address == token0Addr
        ? [tokenA.address, tokenB.address]
        : [tokenB.address, tokenA.address];

    let [reserve0, reserve1] = await pool.getReserves();
    let totalSupply = await pool.totalSupply();

    /// Remove Liquidity
    const burnTx1st = await removeLiquidity(firstLp);
    await expect(burnTx1st)
      .to.emit(pool, "Transfer")
      .withArgs(pool.address, ethers.constants.AddressZero, firstLp)
      .to.emit(token0, "Transfer")
      .withArgs(
        pool.address,
        await liquidityProvider.getAddress(),
        firstLp.mul(reserve0).div(totalSupply)
      )
      .to.emit(token1, "Transfer")
      .withArgs(
        pool.address,
        await liquidityProvider.getAddress(),
        firstLp.mul(reserve1).div(totalSupply)
      )
      .to.emit(pool, "Sync")
      .withArgs(
        reserve0.sub(firstLp.mul(reserve0).div(totalSupply)),
        reserve1.sub(firstLp.mul(reserve1).div(totalSupply))
      )
      .to.emit(pool, "Burn")
      .withArgs(
        await liquidityProvider.getAddress(),
        firstLp.mul(reserve0).div(totalSupply),
        firstLp.mul(reserve1).div(totalSupply),
        await liquidityProvider.getAddress()
      );

    /// Second withdraw
    [reserve0, reserve1] = await pool.getReserves();
    const burnTx2nd = await removeLiquidity(secondLp);
    await expect(burnTx2nd)
      .to.emit(pool, "Transfer")
      .withArgs(pool.address, ethers.constants.AddressZero, secondLp)
      .to.emit(token0, "Transfer")
      .withArgs(pool.address, await liquidityProvider.getAddress(), reserve0)
      .to.emit(token1, "Transfer")
      .withArgs(pool.address, await liquidityProvider.getAddress(), reserve1)
      .to.emit(pool, "Sync")
      .withArgs(0, 0)
      .to.emit(pool, "Burn")
      .withArgs(
        await liquidityProvider.getAddress(),
        reserve0,
        reserve1,
        await liquidityProvider.getAddress()
      );

    expect(await pool.balanceOf(await liquidityProvider.getAddress())).to.eq(0);
    expect(await pool.totalSupply()).to.eq(0);

    expect(await tokenA.balanceOf(pool.address)).to.eq(0);
    expect(await tokenB.balanceOf(pool.address)).to.eq(0);

    expect(await tokenA.balanceOf(await liquidityProvider.getAddress())).to.eq(
      INITIAL_MINTED
    );
    expect(await tokenA.balanceOf(await liquidityProvider.getAddress())).to.eq(
      INITIAL_MINTED
    );
  });

  it("swap:token0", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [reserve0, reserve1] = await pool.getReserves();
    let [initialReserve0, initialReserve1] = await pool.getInitialReserves();

    const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
    const amountOut = swapAmount.mul(initialReserve1).div(initialReserve0);

    await expect(
      swap(BigNumber.from(0), amountOut, swapAmount, token0, trader1st)
    )
      .to.emit(token1, "Transfer")
      .withArgs(pool.address, await trader1st.getAddress(), amountOut)
      .to.emit(pool, "Sync")
      .withArgs(reserve0.add(swapAmount), reserve1.sub(amountOut))
      .to.emit(pool, "Swap")
      .withArgs(
        await trader1st.getAddress(),
        swapAmount,
        0,
        0,
        amountOut,
        await trader1st.getAddress()
      );

    const reserves = await pool.getReserves();
    expect(reserves[0]).to.eq(reserve0.add(swapAmount));
    expect(reserves[1]).to.eq(reserve1.sub(amountOut));
    expect(await token0.balanceOf(pool.address)).to.eq(
      reserve0.add(swapAmount)
    );
    expect(await token1.balanceOf(pool.address)).to.eq(reserve1.sub(amountOut));

    expect(await token0.balanceOf(await trader1st.getAddress())).to.eq(
      INITIAL_MINTED.sub(swapAmount)
    );
    expect(await token1.balanceOf(await trader1st.getAddress())).to.eq(
      INITIAL_MINTED.add(amountOut)
    );
  });

  it("swap:token1", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [reserve0, reserve1] = await pool.getReserves();
    let [initialReserve0, initialReserve1] = await pool.getInitialReserves();

    const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
    const amountOut = swapAmount.mul(initialReserve0).div(initialReserve1);

    await expect(
      swap(amountOut, BigNumber.from(0), swapAmount, token1, trader1st)
    )
      .to.emit(token0, "Transfer")
      .withArgs(pool.address, await trader1st.getAddress(), amountOut)
      .to.emit(pool, "Sync")
      .withArgs(reserve0.sub(amountOut), reserve1.add(swapAmount))
      .to.emit(pool, "Swap")
      .withArgs(
        await trader1st.getAddress(),
        0,
        swapAmount,
        amountOut,
        0,
        await trader1st.getAddress()
      );

    const reserves = await pool.getReserves();
    expect(reserves[0]).to.eq(reserve0.sub(amountOut));
    expect(reserves[1]).to.eq(reserve1.add(swapAmount));
    expect(await token0.balanceOf(pool.address)).to.eq(reserve0.sub(amountOut));
    expect(await token1.balanceOf(pool.address)).to.eq(
      reserve1.add(swapAmount)
    );

    expect(await token0.balanceOf(await trader1st.getAddress())).to.eq(
      INITIAL_MINTED.add(amountOut)
    );
    expect(await token1.balanceOf(await trader1st.getAddress())).to.eq(
      INITIAL_MINTED.sub(swapAmount)
    );
  });

  it("swap:different-rate", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    /// Second adding liquidity
    const amountA2nd = ethers.utils.parseEther(BigNumber.from(100).toString()); /// rate 1:15
    const amountB2nd = ethers.utils.parseEther(BigNumber.from(1500).toString()); /// rate 15:1

    const tx2 = await addLiquidity(amountA2nd, amountB2nd);
    await tx2.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [reserve0, reserve1] = await pool.getReserves();
    let [initialReserve0, initialReserve1] = await pool.getInitialReserves();

    const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
    const amountOut = swapAmount.mul(initialReserve0).div(initialReserve1);

    await expect(
      swap(amountOut, BigNumber.from(0), swapAmount, token1, trader1st)
    )
      .to.emit(token0, "Transfer")
      .withArgs(pool.address, await trader1st.getAddress(), amountOut)
      .to.emit(pool, "Sync")
      .withArgs(reserve0.sub(amountOut), reserve1.add(swapAmount))
      .to.emit(pool, "Swap")
      .withArgs(
        await trader1st.getAddress(),
        0,
        swapAmount,
        amountOut,
        0,
        await trader1st.getAddress()
      );
  });

  it("swap:constant-price", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [reserve0, reserve1] = await pool.getReserves();
    let [initialReserve0, initialReserve1] = await pool.getInitialReserves();

    const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
    const amountOut = swapAmount.mul(initialReserve0).div(initialReserve1);

    await expect(
      swap(amountOut, BigNumber.from(0), swapAmount, token1, trader1st)
    )
      .to.emit(token0, "Transfer")
      .withArgs(pool.address, await trader1st.getAddress(), amountOut)
      .to.emit(pool, "Sync")
      .withArgs(reserve0.sub(amountOut), reserve1.add(swapAmount))
      .to.emit(pool, "Swap")
      .withArgs(
        await trader1st.getAddress(),
        0,
        swapAmount,
        amountOut,
        0,
        await trader1st.getAddress()
      );

    [reserve0, reserve1] = await pool.getReserves();
    await expect(
      swap(amountOut, BigNumber.from(0), swapAmount, token1, trader2nd)
    )
      .to.emit(token0, "Transfer")
      .withArgs(pool.address, await trader2nd.getAddress(), amountOut)
      .to.emit(pool, "Sync")
      .withArgs(reserve0.sub(amountOut), reserve1.add(swapAmount))
      .to.emit(pool, "Swap")
      .withArgs(
        await trader2nd.getAddress(),
        0,
        swapAmount,
        amountOut,
        0,
        await trader2nd.getAddress()
      );
  });

  it("swap:redundant-output", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];

    let [initialReserve0, initialReserve1] = await pool.getInitialReserves();
    const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
    const BAD_AMOUNT_OUT = BigNumber.from(1);

    /// swap 0 -> 1
    let amountOut = swapAmount.mul(initialReserve1).div(initialReserve0);
    await expect(
      swap(BAD_AMOUNT_OUT, amountOut, swapAmount, token0, trader1st)
    ).to.be.revertedWith("POOL: Invalid Input Output");

    // swap 1 -> 0
    amountOut = swapAmount.mul(initialReserve0).div(initialReserve1);
    await expect(
      swap(amountOut, BAD_AMOUNT_OUT, swapAmount, token1, trader1st)
    ).to.be.revertedWith("POOL: Invalid Input Output");
  });

  it("swap:insufficient-input", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];

    let [initialReserve0, initialReserve1] = await pool.getInitialReserves();
    const swapAmount = ethers.utils.parseEther(BigNumber.from(10).toString()); /// rate 1:10
    const UNDER_AMOUNT_IN = swapAmount.sub(1);

    /// swap 0 -> 1
    let amountOut = swapAmount.mul(initialReserve1).div(initialReserve0);
    await expect(
      swap(BigNumber.from(0), amountOut, UNDER_AMOUNT_IN, token0, trader1st)
    ).to.be.revertedWith("POOL: Invalid Input Output");

    // swap 1 -> 0
    amountOut = swapAmount.mul(initialReserve0).div(initialReserve1);
    await expect(
      swap(amountOut, BigNumber.from(0), UNDER_AMOUNT_IN, token1, trader1st)
    ).to.be.revertedWith("POOL: Invalid Input Output");
  });

  it("swap:pool-depleted", async () => {
    /// First adding liquidity
    const amountA = ethers.utils.parseEther(BigNumber.from(500).toString()); /// rate 1:10
    const amountB = ethers.utils.parseEther(BigNumber.from(5000).toString()); /// rate 10:1

    const tx = await addLiquidity(amountA, amountB);
    await tx.wait();

    const [token0, token1] =
      tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
    let [initialReserve0, initialReserve1] = await pool.getInitialReserves();

    await expect(
      swap(
        initialReserve0,
        BigNumber.from(0),
        initialReserve1,
        token1,
        trader1st
      )
    ).to.be.revertedWith("POOL: INSUFFICIENT_LIQUIDITY");
    await expect(
      swap(
        BigNumber.from(0),
        initialReserve1,
        initialReserve0,
        token0,
        trader1st
      )
    ).to.be.revertedWith("POOL: INSUFFICIENT_LIQUIDITY");
  });
});

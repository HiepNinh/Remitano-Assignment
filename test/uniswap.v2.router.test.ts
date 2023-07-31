import hre, { ethers, network } from "hardhat";
import chai from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import {
  MockERC20,
  UniswapV2Factory,
  UniswapV2Pair,
  UniswapV2Router,
  WETH9,
} from "../typechain";
import { getCreate2Address } from "./helpers/create2.helper";

const expect = chai.expect;
const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3);
const INITIAL_MINTED = ethers.utils.parseEther(BigNumber.from(1e10).toString());

let deployer: SignerWithAddress;
let liquidityProvider: SignerWithAddress;
let trader1st: SignerWithAddress;
let trader2nd: SignerWithAddress;
let feeTo: SignerWithAddress;

let domain: any;
let factory: UniswapV2Factory;
let tokenA: MockERC20;
let tokenB: MockERC20;
let WETH: WETH9;
let pair: UniswapV2Pair;
let router: UniswapV2Router;

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

  const { bytecode } = await hre.artifacts.readArtifact("UniswapV2Pair");
  const create2Address = getCreate2Address(
    factory.address,
    [token0.address, token1.address],
    bytecode
  );
  const PairFactory = await ethers.getContractFactory("UniswapV2Pair");
  pair = PairFactory.attach(create2Address);

  return addTx;
};

/// ============== Remove Liquidity ==============
const removeLiquidity = async (
  token0: any,
  token1: any,
  shares: BigNumber,
  digest: any
) => {
  if (digest == null) {
    const approveTx = await pair
      .connect(liquidityProvider)
      .approve(router.address, ethers.constants.MaxUint256);
    await approveTx.wait();
  }

  let removeTx: any;
  if (token1.address != WETH.address) {
    if (digest != null) {
      const { v, r, s } = ethers.utils.splitSignature(digest);

      removeTx = await router
        .connect(liquidityProvider)
        .removeLiquidityWithPermit(
          token0.address,
          token1.address,
          shares,
          0,
          0,
          await liquidityProvider.getAddress(),
          ethers.constants.MaxUint256,
          true,
          v,
          r,
          s
        );
    } else {
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
    }
  } else {
    if (digest != null) {
      const { v, r, s } = ethers.utils.splitSignature(digest);

      removeTx = await router
        .connect(liquidityProvider)
        .removeLiquidityETHWithPermit(
          token0.address,
          shares,
          0,
          0,
          await liquidityProvider.getAddress(),
          ethers.constants.MaxUint256,
          true,
          v,
          r,
          s
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
  }
  await removeTx.wait();

  return removeTx;
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

/// ============== Get Amount In ==============
const getAmountIn = (
  amountOut: BigNumber,
  reserveIn: BigNumber,
  reserveOut: BigNumber
) => {
  let numberator = reserveIn.mul(amountOut).mul(1000);
  let denominator = reserveOut.sub(amountOut).mul(997);

  return numberator.div(denominator).add(1);
};

describe("UniswapV2Router", function () {
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
    const WETHFactory = await ethers.getContractFactory("WETH9");
    WETH = await WETHFactory.connect(deployer).deploy();

    /// ============== Create Router ==============
    const RouterFactory = await ethers.getContractFactory("UniswapV2Router");
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
      const amountA = INITIAL_MINTED.mul(10).div(100); /// 50% of initial minted used as tokenA liquidity
      const amountB = INITIAL_MINTED.mul(40).div(100); /// 50% of initial minted used as tokenB liquidity
      const expectedLiquidity = INITIAL_MINTED.mul(20).div(100); /// sqrt(amountA * amountB)

      let [amount0, amount1] =
        tokenA.address < tokenB.address
          ? [amountA, amountB]
          : [amountB, amountA];
      let addTx = await addLiquidity(tokenA, tokenB, amountA, amountB);

      await expect(addTx)
        .to.emit(tokenA, "Transfer")
        .withArgs(await liquidityProvider.getAddress(), pair.address, amountA)
        .to.emit(tokenB, "Transfer")
        .withArgs(await liquidityProvider.getAddress(), pair.address, amountB)
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
        .withArgs(amount0, amount1)
        .to.emit(pair, "Mint")
        .withArgs(router.address, amount0, amount1);

      expect(await pair.balanceOf(await liquidityProvider.getAddress())).to.eq(
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      );
    });

    it("addLiquidityETH", async () => {
      const amountA = INITIAL_MINTED.mul(10).div(100); /// 50% of initial minted used as tokenA liquidity
      const ETHAmount = ethers.utils.parseEther("10"); /// 50% of initial minted used as tokenB liquidity
      const expectedLiquidity = sqrt(amountA.mul(ETHAmount)); /// sqrt(amountA * amountB)

      let [amount0, amount1] =
        tokenA.address < WETH.address
          ? [amountA, ETHAmount]
          : [ETHAmount, amountA];
      let addTx = await addLiquidity(tokenA, WETH, amountA, ETHAmount);

      await expect(addTx)
        .to.emit(tokenA, "Transfer")
        .withArgs(await liquidityProvider.getAddress(), pair.address, amountA)
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
        .withArgs(amount0, amount1)
        .to.emit(pair, "Mint")
        .withArgs(router.address, amount0, amount1);

      expect(await pair.balanceOf(await liquidityProvider.getAddress())).to.eq(
        expectedLiquidity.sub(MINIMUM_LIQUIDITY)
      );
    });

    it("removeLiquidity", async () => {
      const amountA = INITIAL_MINTED.mul(10).div(100); /// 50% of initial minted used as tokenA liquidity
      const amountB = INITIAL_MINTED.mul(40).div(100); /// 50% of initial minted used as tokenB liquidity
      const expectedLiquidity = INITIAL_MINTED.mul(20).div(100); /// sqrt(amountA * amountB)

      /// Add Liquidity
      await addLiquidity(tokenA, tokenB, amountA, amountB);

      /// Prepare data for next check
      const [token0, token1] =
        tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
      const totalSupply = await pair.totalSupply();
      let [reserve0, reserve1] = await pair.getReserves();

      /// Remove Liquidity
      let removeTx = await removeLiquidity(
        tokenA,
        tokenB,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        null
      );
      await expect(removeTx)
        .to.emit(pair, "Transfer")
        .withArgs(
          await liquidityProvider.getAddress(),
          pair.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY)
        )
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
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve0)
            .div(totalSupply)
        )
        .to.emit(token1, "Transfer")
        .withArgs(
          pair.address,
          await liquidityProvider.getAddress(),
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve1)
            .div(totalSupply)
        )
        .to.emit(pair, "Sync")
        .withArgs(
          MINIMUM_LIQUIDITY.mul(reserve0).div(totalSupply),
          MINIMUM_LIQUIDITY.mul(reserve1).div(totalSupply)
        )
        .to.emit(pair, "Burn")
        .withArgs(
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve0)
            .div(totalSupply),
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve1)
            .div(totalSupply),
          await liquidityProvider.getAddress()
        );
    });

    it("removeLiquidityETH", async () => {
      const amountA = INITIAL_MINTED.mul(10).div(100); /// 50% of initial minted used as tokenA liquidity
      const ETHAmount = ethers.utils.parseEther("10"); /// 50% of initial minted used as tokenB liquidity
      const expectedLiquidity = sqrt(amountA.mul(ETHAmount)); /// sqrt(amountA * amountB)

      /// Add Liquidity
      await addLiquidity(tokenA, WETH, amountA, ETHAmount);

      /// Prepare data for next check
      const [token0, token1] =
        tokenA.address < WETH.address ? [tokenA, WETH] : [WETH, tokenA];
      const totalSupply = await pair.totalSupply();
      let [reserve0, reserve1] = await pair.getReserves();
      let [reserveA, reserveEth] =
        tokenA.address == token0.address
          ? [reserve0, reserve1]
          : [reserve1, reserve0];

      /// Remove Liquidity
      let removeTx = await removeLiquidity(
        tokenA,
        WETH,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        null
      );
      await expect(removeTx)
        .to.emit(pair, "Transfer")
        .withArgs(
          await liquidityProvider.getAddress(),
          pair.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY)
        )
        .to.emit(pair, "Transfer")
        .withArgs(
          pair.address,
          ethers.constants.AddressZero,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY)
        )
        .to.emit(token0, "Transfer")
        .withArgs(
          pair.address,
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve0)
            .div(totalSupply)
        )
        .to.emit(token1, "Transfer")
        .withArgs(
          pair.address,
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve1)
            .div(totalSupply)
        )
        .to.emit(tokenA, "Transfer")
        .withArgs(
          pair.address,
          await liquidityProvider.getAddress(),
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserveA)
            .div(totalSupply)
        )
        .to.emit(WETH, "Withdrawal")
        .withArgs(
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserveEth)
            .div(totalSupply)
        )
        .to.emit(pair, "Sync")
        .withArgs(
          MINIMUM_LIQUIDITY.mul(reserve0).div(totalSupply),
          MINIMUM_LIQUIDITY.mul(reserve1).div(totalSupply)
        )
        .to.emit(pair, "Burn")
        .withArgs(
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve0)
            .div(totalSupply),
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve1)
            .div(totalSupply),
          router.address
        );
    });

    it("removeLiquidityWithPermit", async () => {
      const amountA = INITIAL_MINTED.mul(10).div(100); /// 50% of initial minted used as tokenA liquidity
      const amountB = INITIAL_MINTED.mul(40).div(100); /// 50% of initial minted used as tokenB liquidity
      const expectedLiquidity = INITIAL_MINTED.mul(20).div(100); /// sqrt(amountA * amountB)

      /// Add Liquidity
      await addLiquidity(tokenA, tokenB, amountA, amountB);

      /// Prepare data for next check
      const [token0, token1] =
        tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];
      const totalSupply = await pair.totalSupply();
      let [reserve0, reserve1] = await pair.getReserves();

      const nonce = await pair.nonces(await liquidityProvider.getAddress());
      /// ============== Init the domain for type hash ==============
      /// Set value for domain
      domain = {
        name: await pair.name(),
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: pair.address,
      };
      const digest = await liquidityProvider._signTypedData(
        domain,
        PERMIT_TYPES,
        {
          owner: await liquidityProvider.getAddress(),
          spender: router.address,
          value: ethers.constants.MaxUint256,
          nonce,
          deadline: ethers.constants.MaxUint256,
        }
      );

      /// Remove Liquidity
      let removeTx = await removeLiquidity(
        tokenA,
        tokenB,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        digest
      );
      await expect(removeTx)
        .to.emit(pair, "Approval")
        .withArgs(
          await liquidityProvider.getAddress(),
          router.address,
          ethers.constants.MaxUint256
        )
        .to.emit(pair, "Transfer")
        .withArgs(
          await liquidityProvider.getAddress(),
          pair.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY)
        )
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
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve0)
            .div(totalSupply)
        )
        .to.emit(token1, "Transfer")
        .withArgs(
          pair.address,
          await liquidityProvider.getAddress(),
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve1)
            .div(totalSupply)
        )
        .to.emit(pair, "Sync")
        .withArgs(
          MINIMUM_LIQUIDITY.mul(reserve0).div(totalSupply),
          MINIMUM_LIQUIDITY.mul(reserve1).div(totalSupply)
        )
        .to.emit(pair, "Burn")
        .withArgs(
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve0)
            .div(totalSupply),
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve1)
            .div(totalSupply),
          await liquidityProvider.getAddress()
        );
    });

    it("removeLiquidityETHWithPermit", async () => {
      const amountA = INITIAL_MINTED.mul(10).div(100); /// 50% of initial minted used as tokenA liquidity
      const ETHAmount = ethers.utils.parseEther("10"); /// 50% of initial minted used as tokenB liquidity
      const expectedLiquidity = sqrt(amountA.mul(ETHAmount)); /// sqrt(amountA * amountB)

      /// Add Liquidity
      await addLiquidity(tokenA, WETH, amountA, ETHAmount);

      /// Prepare data for next check
      const [token0, token1] =
        tokenA.address < WETH.address ? [tokenA, WETH] : [WETH, tokenA];
      const totalSupply = await pair.totalSupply();
      let [reserve0, reserve1] = await pair.getReserves();
      let [reserveA, reserveEth] =
        tokenA.address == token0.address
          ? [reserve0, reserve1]
          : [reserve1, reserve0];

      const nonce = await pair.nonces(await liquidityProvider.getAddress());
      /// ============== Init the domain for type hash ==============
      /// Set value for domain
      domain = {
        name: await pair.name(),
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: pair.address,
      };
      const digest = await liquidityProvider._signTypedData(
        domain,
        PERMIT_TYPES,
        {
          owner: await liquidityProvider.getAddress(),
          spender: router.address,
          value: ethers.constants.MaxUint256,
          nonce,
          deadline: ethers.constants.MaxUint256,
        }
      );

      /// Remove Liquidity
      let removeTx = await removeLiquidity(
        tokenA,
        WETH,
        expectedLiquidity.sub(MINIMUM_LIQUIDITY),
        digest
      );
      await expect(removeTx)
        .to.emit(pair, "Approval")
        .withArgs(
          await liquidityProvider.getAddress(),
          router.address,
          ethers.constants.MaxUint256
        )
        .to.emit(pair, "Transfer")
        .withArgs(
          await liquidityProvider.getAddress(),
          pair.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY)
        )
        .to.emit(pair, "Transfer")
        .withArgs(
          pair.address,
          ethers.constants.AddressZero,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY)
        )
        .to.emit(token0, "Transfer")
        .withArgs(
          pair.address,
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve0)
            .div(totalSupply)
        )
        .to.emit(token1, "Transfer")
        .withArgs(
          pair.address,
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve1)
            .div(totalSupply)
        )
        .to.emit(tokenA, "Transfer")
        .withArgs(
          pair.address,
          await liquidityProvider.getAddress(),
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserveA)
            .div(totalSupply)
        )
        .to.emit(WETH, "Withdrawal")
        .withArgs(
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserveEth)
            .div(totalSupply)
        )
        .to.emit(pair, "Sync")
        .withArgs(
          MINIMUM_LIQUIDITY.mul(reserve0).div(totalSupply),
          MINIMUM_LIQUIDITY.mul(reserve1).div(totalSupply)
        )
        .to.emit(pair, "Burn")
        .withArgs(
          router.address,
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve0)
            .div(totalSupply),
          expectedLiquidity
            .sub(MINIMUM_LIQUIDITY)
            .mul(reserve1)
            .div(totalSupply),
          router.address
        );
    });
  });

  describe("swapExactTokensForTokens", () => {
    it("happy path", async () => {
      const amount0 = INITIAL_MINTED.mul(10).div(100); /// 50% of initial minted used as tokenA liquidity
      const amount1 = INITIAL_MINTED.mul(40).div(100); /// 50% of initial minted used as tokenB liquidity

      const [token0, token1] =
        tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];

      await addLiquidity(token0, token1, amount0, amount1);

      /// Get reserve
      let [reserve0, reserve1] = await pair.getReserves();

      /// Approve for Router send trader's asset
      const approveTx = await token0
        .connect(trader1st)
        .approve(router.address, ethers.constants.MaxUint256);
      await approveTx.wait();

      /// Swap token0 -> token1
      const swapAmount = getSwapAmount(reserve0, [1, 7]); // [1%_RESERVE_0; 7%_RESERVE_0)
      const amountOut = getAmountOut(swapAmount, reserve0, reserve1);

      /// Swap
      await expect(
        router
          .connect(trader1st)
          .swapExactTokensForTokens(
            swapAmount,
            0,
            [token0.address, token1.address],
            await trader1st.getAddress(),
            ethers.constants.MaxUint256
          )
      )
        .to.emit(token0, "Transfer")
        .withArgs(await trader1st.getAddress(), pair.address, swapAmount)
        .to.emit(token1, "Transfer")
        .withArgs(pair.address, await trader1st.getAddress(), amountOut)
        .to.emit(pair, "Sync")
        .withArgs(reserve0.add(swapAmount), reserve1.sub(amountOut))
        .to.emit(pair, "Swap")
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

  describe("swapTokensForExactTokens", () => {
    it("happy path", async () => {
      const amount0 = INITIAL_MINTED.mul(10).div(100); /// 10% of initial minted used as tokenA liquidity
      const amount1 = INITIAL_MINTED.mul(40).div(100); /// 40% of initial minted used as tokenB liquidity

      const [token0, token1] =
        tokenA.address < tokenB.address ? [tokenA, tokenB] : [tokenB, tokenA];

      await addLiquidity(token0, token1, amount0, amount1);

      /// Get reserve
      let [reserve0, reserve1] = await pair.getReserves();

      /// Approve for Router send trader's asset
      const approveTx = await token0
        .connect(trader1st)
        .approve(router.address, ethers.constants.MaxUint256);
      await approveTx.wait();

      /// Swap token0 -> token1
      const amountOut = getSwapAmount(reserve1, [1, 7]); // [1%_RESERVE_0; 7%_RESERVE_0)
      const swapAmount = getAmountIn(amountOut, reserve0, reserve1);

      /// Swap
      await expect(
        router
          .connect(trader1st)
          .swapTokensForExactTokens(
            amountOut,
            ethers.constants.MaxUint256,
            [token0.address, token1.address],
            await trader1st.getAddress(),
            ethers.constants.MaxUint256
          )
      )
        .to.emit(token0, "Transfer")
        .withArgs(await trader1st.getAddress(), pair.address, swapAmount)
        .to.emit(token1, "Transfer")
        .withArgs(pair.address, await trader1st.getAddress(), amountOut)
        .to.emit(pair, "Sync")
        .withArgs(reserve0.add(swapAmount), reserve1.sub(amountOut))
        .to.emit(pair, "Swap")
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
});

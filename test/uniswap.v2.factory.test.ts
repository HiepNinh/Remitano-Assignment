import hre, { ethers } from "hardhat";
import chai from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { getCreate2Address } from "./helpers/create2.helper";
import { MockERC20, UniswapV2Factory, UniswapV2Pair } from "../typechain";

const expect = chai.expect;

let deployer: SignerWithAddress;
let feeToSetter: SignerWithAddress;
let feeTo: SignerWithAddress;

let factory: UniswapV2Factory;
let tokenA: MockERC20;
let tokenB: MockERC20;

describe("UniswapV2Factory", function () {
  this.timeout(1000000);

  this.beforeEach(async () => {
    /// Setup signers
    [deployer, feeToSetter, feeTo] = await ethers.getSigners();

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
  });

  it("feeTo, feeToSetter, allPairsLength", async () => {
    expect(await factory.feeTo()).to.equal(ethers.constants.AddressZero);
    expect(await factory.feeToSetter()).to.equal(await deployer.getAddress());
    expect(await factory.allPairsLength()).to.equal(0);
  });

  /// ============== Create Pair Function ==============
  const createPair = async (tokens: [string, string]) => {
    const { bytecode } = await hre.artifacts.readArtifact("UniswapV2Pair");
    const [token0, token1] =
      tokens[0] < tokens[1] ? [tokens[0], tokens[1]] : [tokens[1], tokens[0]];

    const create2Address = getCreate2Address(factory.address, tokens, bytecode);
    await expect(factory.createPair(...tokens))
      .to.emit(factory, "PairCreated")
      .withArgs(token0, token1, create2Address, BigNumber.from(1));

    await expect(factory.createPair(...tokens)).to.be.reverted; // UniswapV2: PAIR_EXISTS
    await expect(factory.createPair(...(tokens.reverse() as [string, string])))
      .to.be.reverted; // UniswapV2: PAIR_EXISTS

    expect(await factory.getPair(...tokens)).to.equal(create2Address);
    expect(
      await factory.getPair(...(tokens.reverse() as [string, string]))
    ).to.equal(create2Address);
    expect(await factory.allPairs(0)).to.equal(create2Address);
    expect(await factory.allPairsLength()).to.equal(1);

    const PairFactory = await ethers.getContractFactory("UniswapV2Pair");
    const pair: UniswapV2Pair = PairFactory.attach(create2Address);
    expect(await pair.factory()).to.equal(factory.address);
    expect(await pair.token0()).to.equal(token0);
    expect(await pair.token1()).to.equal(token1);
  };

  it("createPair", async () => {
    await createPair([tokenA.address, tokenB.address]);
  });

  it("createPair:reverse", async () => {
    await createPair([tokenB.address, tokenA.address]);
  });

  it("createPair:gas", async () => {
    const tx = await factory
      .connect(deployer)
      .createPair(tokenA.address, tokenB.address);
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.be.at.most(3000000); // Actually 2717206
  });

  it("setFeeTo", async () => {
    await expect(
      factory.connect(feeTo).setFeeTo(await feeTo.getAddress())
    ).to.be.revertedWith("UniswapV2: FORBIDDEN");

    await factory.connect(deployer).setFeeTo(await feeTo.getAddress());
    expect(await factory.feeTo()).to.equal(await feeTo.getAddress());
  });

  it("setFeeToSetter", async () => {
    await expect(
      factory
        .connect(feeToSetter)
        .setFeeToSetter(await feeToSetter.getAddress())
    ).to.be.revertedWith("UniswapV2: FORBIDDEN");

    await factory
      .connect(deployer)
      .setFeeToSetter(await feeToSetter.getAddress());
    expect(await factory.feeToSetter()).to.eq(await feeToSetter.getAddress());

    await expect(
      factory.connect(deployer).setFeeToSetter(await deployer.getAddress())
    ).to.be.revertedWith("UniswapV2: FORBIDDEN");
  });
});

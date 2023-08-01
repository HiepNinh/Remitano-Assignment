import hre, { ethers } from "hardhat";
import chai from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { getCreate2Address } from "./helpers/create2.helper";
import { MockERC20, Factory, Pool } from "../typechain";

const expect = chai.expect;

let deployer: SignerWithAddress;

let factory: Factory;
let tokenA: MockERC20;
let tokenB: MockERC20;

describe("Factory", function () {
  this.timeout(1000000);

  this.beforeEach(async () => {
    /// Setup signers
    [deployer] = await ethers.getSigners();

    /// Deploy contract
    /// ============== Deploy Factory ==============
    const RegisterFactory = await ethers.getContractFactory("Factory");
    factory = await RegisterFactory.connect(deployer).deploy();
    await factory.deployed();

    /// ============== Deploy Token ==============
    const TokenFactory = await ethers.getContractFactory("MockERC20");
    tokenA = await TokenFactory.connect(deployer).deploy();
    tokenB = await TokenFactory.connect(deployer).deploy();
  });

  it("allPoolsLength", async () => {
    expect(await factory.allPoolsLength()).to.equal(0);
  });

  /// ============== Create Pair Function ==============
  const createPool = async (tokens: [string, string]) => {
    const { bytecode } = await hre.artifacts.readArtifact("Pool");
    const [token0, token1] =
      tokens[0] < tokens[1] ? [tokens[0], tokens[1]] : [tokens[1], tokens[0]];

    const create2Address = getCreate2Address(factory.address, tokens, bytecode);
    await expect(factory.createPool(...tokens))
      .to.emit(factory, "PoolCreated")
      .withArgs(token0, token1, create2Address, BigNumber.from(1));

    await expect(factory.createPool(...tokens)).to.be.reverted; // POOL_EXISTS
    await expect(factory.createPool(...(tokens.reverse() as [string, string])))
      .to.be.reverted; // POOL_EXISTS

    expect(await factory.getPool(...tokens)).to.equal(create2Address);
    expect(
      await factory.getPool(...(tokens.reverse() as [string, string]))
    ).to.equal(create2Address);
    expect(await factory.allPools(0)).to.equal(create2Address);
    expect(await factory.allPoolsLength()).to.equal(1);

    const PoolFactory = await ethers.getContractFactory("Pool");
    const pool: Pool = PoolFactory.attach(create2Address);
    expect(await pool.factory()).to.equal(factory.address);
    expect(await pool.token0()).to.equal(token0);
    expect(await pool.token1()).to.equal(token1);
  };

  it("createPool", async () => {
    await createPool([tokenA.address, tokenB.address]);
  });

  it("createPool:reverse", async () => {
    await createPool([tokenB.address, tokenA.address]);
  });

  it("createPool:gas", async () => {
    const tx = await factory
      .connect(deployer)
      .createPool(tokenA.address, tokenB.address);
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.be.at.most(3000000); // Actually 2717206
  });
});

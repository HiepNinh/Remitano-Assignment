import { ethers } from "hardhat";
import chai from "chai";
import { UniswapV2ERC20 } from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

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
const TEST_AMOUNT = BigNumber.from(1e10);

let deployer: SignerWithAddress;
let spender: SignerWithAddress;
let domain: any;

let token: UniswapV2ERC20;

describe("UniswapV2ERC20", function () {
  this.timeout(1000000);

  this.beforeEach(async () => {
    /// Setup signers
    [deployer, spender] = await ethers.getSigners();

    /// Deploy contract
    const TokenFactory = await ethers.getContractFactory("UniswapV2ERC20");
    token = await TokenFactory.connect(deployer).deploy(
      "Uniswap V2",
      "UNI-V2",
      "1"
    );
    await token.deployed();

    /// Init the domain for type hash
    // Set value for domain
    domain = {
      name: await token.name(),
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: token.address,
    };
  });

  it("name, symbol, decimals, totalSupply, balanceOf, DOMAIN_SEPARATOR, PERMIT_TYPEHASH", async () => {
    expect(await token.name()).to.equal("Uniswap V2");
    expect(await token.symbol()).to.equal("UNI-V2");
    expect(await token.decimals()).to.equal(18);
    expect(await token.totalSupply()).to.equal(0);
    expect(await token.balanceOf(await deployer.getAddress())).to.equal(0);
    expect(await token.DOMAIN_SEPARATOR()).to.equal(
      ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            ethers.utils.keccak256(
              ethers.utils.toUtf8Bytes(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
              )
            ),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes(domain.name)),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes(domain.version)),
            domain.chainId,
            domain.verifyingContract,
          ]
        )
      )
    );
    expect(await token.PERMIT_TYPEHASH()).to.eq(
      ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(
          "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        )
      )
    );
  });

  it("permit", async () => {
    const nonce = await token.nonces(await deployer.getAddress());
    const deadline = ethers.constants.MaxUint256;

    const digest = await deployer._signTypedData(domain, PERMIT_TYPES, {
      owner: await deployer.getAddress(),
      spender: await spender.getAddress(),
      value: TEST_AMOUNT,
      nonce,
      deadline,
    });

    const { v, r, s } = ethers.utils.splitSignature(digest);

    await expect(
      token
        .connect(spender)
        .permit(
          await deployer.getAddress(),
          await spender.getAddress(),
          TEST_AMOUNT,
          deadline,
          v,
          r,
          s
        )
    )
      .to.emit(token, "Approval")
      .withArgs(
        await deployer.getAddress(),
        await spender.getAddress(),
        TEST_AMOUNT
      );
    expect(
      await token.allowance(
        await deployer.getAddress(),
        await spender.getAddress()
      )
    ).to.equal(TEST_AMOUNT);
    expect(await token.nonces(await deployer.getAddress())).to.equal(
      BigNumber.from(1)
    );
  });
});

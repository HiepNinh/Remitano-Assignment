// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import { writeFileSync } from "fs";
import CONFIG from "../config.json";
import { BigNumber } from "ethers";

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const [deployer] = await ethers.getSigners();
  console.log("Execution account:", await deployer.getAddress());
  let prevBal = await deployer.getBalance();
  console.log("Deployer Balance:", prevBal.toString());

  let config: any = CONFIG;

  // Load the Router Contract
  const RouterFactory = await ethers.getContractFactory("Router");
  const router = RouterFactory.attach(config.router.address);

  /// Init token test
  const TokenFactory = await ethers.getContractFactory("MockERC20");
  const token = TokenFactory.attach(config.pool.token);

  /// Mint
  const INITIAL_MINTED = ethers.utils.parseEther("1");
  const mintTx = await token
    .connect(deployer)
    .mint(await deployer.getAddress(), INITIAL_MINTED);
  await mintTx.wait();

  /// Approve
  const approveTx = await token
    .connect(deployer)
    .approve(router.address, ethers.constants.MaxUint256);
  await approveTx.wait();

  console.log("📄 Adding Liquidity .........");
  // Set Minter as Asset bouncer
  const tx = await router.addLiquidityETH(
    token.address,
    ethers.utils.parseEther("0.1"),
    0,
    0,
    await deployer.getAddress(),
    ethers.constants.MaxUint256,
    {
      value: ethers.utils.parseEther("0.01"),
    }
  );
  await tx.wait(3);
  console.log("✅ Successfully add liquidity to pool with rate 1:10");

  let afterBal = await deployer.getBalance();
  console.log(
    `📄 Cost for add liquidity to pool on Sepolia Testnet: ${ethers.utils.formatEther(
      prevBal.sub(afterBal)
    )} ETH`
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

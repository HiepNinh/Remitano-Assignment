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

  /// Init token test
  const TokenFactory = await ethers.getContractFactory("MockERC20");
  const tokenA = await TokenFactory.connect(deployer).deploy();

  // Load the UniswapV2Factory Contract
  const RegisterFactory = await ethers.getContractFactory("Factory");
  const factory = RegisterFactory.attach(config.factory.address);

  console.log("📄 Create a new pool .........");
  // Set Minter as Asset bouncer
  const tx = await factory
    .connect(deployer)
    .createPool(tokenA.address, config.router.weth);
  await tx.wait(3);
  console.log("✅ Successfully create new pool");

  let afterBal = await deployer.getBalance();
  console.log(
    `📄 Cost for create new Pool contract on Sepolia Testnet: ${ethers.utils.formatEther(
      prevBal.sub(afterBal)
    )} ETH`
  );

  // Write address to CONFIG
  console.log("📄 Writing Contract address .........");
  config.pool.address = await factory.getPool(
    tokenA.address,
    config.router.weth
  );
  config.pool.token = tokenA.address;

  writeFileSync(`${__dirname}/../config.json`, JSON.stringify(config, null, 2));
  console.log("✅ Wrote address to config file");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

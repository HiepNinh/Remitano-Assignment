// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import CONFIG from "../config.json";
import { writeFileSync } from "fs";

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const [deployer] = await ethers.getSigners();
  console.log("Deployer account:", await deployer.getAddress());
  let prevBal = await deployer.getBalance();
  console.log("Deployer Balance:", prevBal.toString());

  console.log("📄 Deploy Router contract on Sepolia Testnet .........");
  let config: any = CONFIG;
  const RouterFactory = await ethers.getContractFactory("Router");
  const router = await RouterFactory.deploy(
    config.factory.address,
    config.router.weth
  );
  await router.deployed();
  console.log("✅ Router Contract address: ", router.address);

  let afterBal = await deployer.getBalance();
  console.log(
    `📄 Cost for deploying Router contract on Sepolia Testnet: ${ethers.utils.formatEther(
      prevBal.sub(afterBal)
    )} ETH`
  );

  // Write address to CONFIG
  console.log("📄 Writing Contract address .........");
  config.router.address = router.address;

  writeFileSync(`${__dirname}/../config.json`, JSON.stringify(config, null, 2));
  console.log("✅ Wrote address to config file");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

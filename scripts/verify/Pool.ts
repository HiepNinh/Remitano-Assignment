// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import CONFIG from "../config.json";

const hre = require("hardhat");

async function main() {
  let config: any = CONFIG;

  console.log("Verify Pool Contract on Sepolia Testnet......");

  await hre.run("verify:verify", {
    address: config.pool.address,
    contract: "contracts/core/Pool.sol:Pool",
    constructorArguments: [],
  });

  console.log("✅ Verify Contract success");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

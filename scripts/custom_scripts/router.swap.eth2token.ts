// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import CONFIG from "../config.json";

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const [deployer, trader1st, trader2nd] = await ethers.getSigners();
  console.log("Execution account:", await deployer.getAddress());
  let prevBal = await deployer.getBalance();
  console.log("Deployer Balance:", prevBal.toString());

  let config: any = CONFIG;

  // Load the Router Contract
  const RouterFactory = await ethers.getContractFactory("Router");
  const router = RouterFactory.attach(config.router.address);

  console.log("📄 Swap ETH to Token .........");
  // Set Minter as Asset bouncer
  const tx = await router
    .connect(trader1st)
    .swapETHForTokens(
      0,
      [config.router.weth, config.pool.token],
      await trader1st.getAddress(),
      ethers.constants.MaxUint256,
      {
        value: ethers.utils.parseEther("0.001"),
      }
    );
  await tx.wait(3);
  console.log("✅ Successfully swap eth for token with rate 1:10");

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

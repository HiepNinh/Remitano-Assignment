import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-tracer";
import {
  HttpNetworkAccountsUserConfig,
  NetworkUserConfig,
} from "hardhat/types";

dotenv.config({ path: __dirname + "/.env" });

const mnemonic = process.env.MNEMONIC;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      gasPrice: 200000000000, // 200 Gwei,
    }, // LOCAL NETWORK
    localNode: {
      url: "http://127.0.0.1:8545",
      accounts: {
        mnemonic: mnemonic,
        count: 10,
      } as HttpNetworkAccountsUserConfig,
      live: false,
      saveDeployments: true,
    } as NetworkUserConfig, // Localhost (default: none)
    eth_mainnet: {
      url: process.env.ETH_PROVIDER,
      chainId: 1,
      accounts: [process.env.ETH_DEPLOYER!],
      gasPrice: 30000000000, // 30 Gwei
      timeout: 9000000,
    }, // MAIN NET
    sepolia: {
      url: process.env.SEPOLIA_PROVIDER,
      chainId: 11155111,
      accounts: [
        process.env.SEPOLIA_DEPLOYER!,
        process.env.TESTER_1!,
        process.env.TESTER_2!,
        process.env.TESTER_3!,
        process.env.TESTER_4!,
        process.env.TESTER_5!,
      ],
      gasPrice: 30000000000, // 30 Gwei
      timeout: 9000000,
    }, // TEST NET
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_APIKEY,
  },
};

export default config;

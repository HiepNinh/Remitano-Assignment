import { ethers } from "hardhat";

export const getCreate2Address = (
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  bytecode: string
): string => {
  const [token0, token1] =
    tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

  const create2Inputs = [
    "0xff",
    factoryAddress,
    ethers.utils.keccak256(
      ethers.utils.solidityPack(["address", "address"], [token0, token1])
    ),
    ethers.utils.keccak256(bytecode),
  ];

  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join("")}`;
  return ethers.utils.getAddress(
    `0x${ethers.utils.keccak256(sanitizedInputs).slice(-40)}`
  );
};

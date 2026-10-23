const hre = require("hardhat");

async function deploy(name, ...args) {
  const factory = await hre.ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  console.log(`${name}: ${address} (deployment block ${receipt.blockNumber})`);
  return { address, blockNumber: receipt.blockNumber };
}

async function main() {
  if (!(process.env.QBESU_RPC_URL || process.env.BESU_RPC_URL) || !process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("Set QBESU_RPC_URL (or legacy BESU_RPC_URL) and DEPLOYER_PRIVATE_KEY in the deploy environment.");
  }
  const collectorRegistry = await deploy("ArtIDCollectorRegistry");
  const factory = await deploy("ArtIDFactory", collectorRegistry.address);
  console.log(`Set collectorRegistryAddress=${collectorRegistry.address}`);
  console.log(`Set collectorRegistryDeploymentBlock=${collectorRegistry.blockNumber}`);
  console.log(`Set factoryAddress=${factory.address}`);
  console.log(`Set artworkFactoryDeploymentBlock=${factory.blockNumber}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

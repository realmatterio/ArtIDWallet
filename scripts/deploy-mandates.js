const hre = require("hardhat");

const expectedDeployer = "0xecc51175adaf8852b0494c53fc8c29cbfcaf7d0d";

async function main() {
  if (hre.network.name !== "qbesu") {
    throw new Error("Deploy mandates only with --network qbesu.");
  }
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("Configure the existing deployer account in the deployment environment.");
  }
  if (deployer.address.toLowerCase() !== expectedDeployer.toLowerCase()) {
    throw new Error(`Deployer must be ${expectedDeployer}; got ${deployer.address}.`);
  }
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 1337n) {
    throw new Error(`Expected qBESU chain ID 1337; got ${network.chainId}.`);
  }
  const factory = await hre.ethers.getContractFactory("ArtIDTransferMandates", deployer);
  const contract = await factory.deploy();
  const transaction = contract.deploymentTransaction();
  console.log(`Deployment transaction: ${transaction.hash}`);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Mandate contract deployment was not confirmed successfully.");
  }
  console.log(`ArtIDTransferMandates: ${await contract.getAddress()}`);
  console.log(`Deployment block: ${receipt.blockNumber}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

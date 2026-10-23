require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const networks = {};
const qbesuRpcUrl = process.env.QBESU_RPC_URL || process.env.BESU_RPC_URL;
if (qbesuRpcUrl) {
  networks.qbesu = {
    url: qbesuRpcUrl,
    chainId: Number(process.env.QBESU_CHAIN_ID || process.env.BESU_CHAIN_ID || 1337),
    accounts: process.env.DEPLOYER_PRIVATE_KEY
      ? [process.env.DEPLOYER_PRIVATE_KEY]
      : []
  };
}

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "london"
    }
  },
  networks
};

require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
// Pin the compiler through npm so builds do not require a separate binary host.
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, hre, runSuper) => {
  if (solcVersion !== "0.8.20") return runSuper();
  const longVersion = require("solc").version();
  if (!longVersion.startsWith("0.8.20+")) throw new Error("Expected pinned solc 0.8.20");
  return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true, version: solcVersion, longVersion };
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111,
    },
    "arbitrum-sepolia": {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 421614,
    },
  },

  // Etherscan V2 unified API: a single key covers Sepolia, Arbitrum Sepolia,
  // and ~50 other chains. Get it at https://etherscan.io/myapikey.
  // hardhat-verify v2.x resolves the right explorer per network automatically.
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

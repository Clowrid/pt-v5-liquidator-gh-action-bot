import { BaseProvider } from "@ethersproject/providers";
import {
  downloadContractsBlob,
  ContractsBlob,
} from "@generationsoftware/pt-v5-utils-js";
import {
  getProvider,
  instantiateRelayerAccount,
  loadLiquidatorEnvVars,
  runLiquidator,
  LiquidatorEnvVars,
  LiquidatorConfig,
  RelayerAccount,
} from "@generationsoftware/pt-v5-autotasks-library";

// ---------------------------------------------------------------------------
// Gnosis WXDAI price override
// WXDAI is a stablecoin pegged to $1. We intercept fetch() so the library
// receives a hardcoded $1.00 price instead of calling Covalent/Dexscreener
// which return errors and $NaN on Gnosis chain.
// ---------------------------------------------------------------------------
const GNOSIS_CHAIN_ID = 100;
const WXDAI_ADDRESS = "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d";

const originalFetch = globalThis.fetch;

const patchedFetch: typeof fetch = async (input, init?) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const urlLower = url.toLowerCase();

  // Intercept Dexscreener calls for WXDAI
  if (
    urlLower.includes("api.dexscreener.com") &&
    urlLower.includes(WXDAI_ADDRESS)
  ) {
    console.log("[WXDAI Override] Intercepted Dexscreener call → returning $1.00");
    return new Response(
      JSON.stringify({
        pairs: [
          {
            chainId: "gnosischain",
            dexId: "sushiswap",
            baseToken: { address: WXDAI_ADDRESS },
            priceUsd: "1.0",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Intercept Covalent calls for WXDAI
  if (
    urlLower.includes("api.covalenthq.com") &&
    urlLower.includes(WXDAI_ADDRESS)
  ) {
    console.log("[WXDAI Override] Intercepted Covalent call → returning $1.00");
    return new Response(
      JSON.stringify({
        data: [
          {
            contract_address: WXDAI_ADDRESS,
            prices: [{ price: 1.0 }],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  return originalFetch(input, init);
};

const main = async () => {
  const envVars: LiquidatorEnvVars = loadLiquidatorEnvVars();

  // Only patch fetch when running on Gnosis chain
  if (envVars.CHAIN_ID === GNOSIS_CHAIN_ID) {
    console.log("[WXDAI Override] Gnosis chain detected — WXDAI price fixed at $1.00");
    globalThis.fetch = patchedFetch;
  }

  const provider: BaseProvider = getProvider(envVars);

  const relayerAccount: RelayerAccount = await instantiateRelayerAccount(
    provider,
    envVars.CUSTOM_RELAYER_PRIVATE_KEY
  );

  const config: LiquidatorConfig = {
    ...relayerAccount,
    provider,
    covalentApiKey: envVars.COVALENT_API_KEY,
    chainId: envVars.CHAIN_ID,
    swapRecipient: envVars.SWAP_RECIPIENT,
    minProfitThresholdUsd: Number(envVars.MIN_PROFIT_THRESHOLD_USD),
    envTokenAllowList: envVars.ENV_TOKEN_ALLOW_LIST,
    claimRewards: envVars.CLAIM_REWARDS,
    pairsToLiquidate: envVars.PAIRS_TO_LIQUIDATE,
    contractJsonUrl: envVars.CONTRACT_JSON_URL,
  };

  const contracts: ContractsBlob = await downloadContractsBlob(
    config.contractJsonUrl
  );
  await runLiquidator(contracts, config);
};

main();

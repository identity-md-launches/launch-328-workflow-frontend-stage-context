import {
  createPublicClient,
  custom,
  defineChain,
  fallback,
  http,
  isAddress,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
} from "viem";

export interface Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
type Contract = {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
  abi: Abi;
};
export type Deployment = {
  version: number;
  launchId: string;
  sourceCommit: string;
  attestationHash: string;
  chainId: number;
  contracts: Contract[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<string, Address>;
  };
  walletAddChain: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const safePath = (p: string) =>
  typeof p === "string" &&
  !p.startsWith("/") &&
  !p.includes("..") &&
  !p.includes(":") &&
  !p.includes("\\");
export async function loadDeployment(): Promise<Deployment> {
  const response = await fetch(
    new URL("./imd-deployment.json", document.baseURI),
    { cache: "no-cache" },
  );
  if (!response.ok)
    throw Error("Deployment configuration is unavailable. Reload to retry.");
  const config: Deployment = await response.json();
  if (
    config.version !== 1 ||
    config.chainId !== config.network.chainId ||
    Number(config.walletAddChain.chainId) !== config.chainId
  )
    throw Error("Deployment network is inconsistent. Actions are disabled.");
  if (
    config.contracts.length !== 2 ||
    !["LaunchToken", "RentableNFT"].every(
      (n) => config.contracts.filter((c) => c.name === n).length === 1,
    )
  )
    throw Error("Unexpected deployment contract set.");
  for (const c of config.contracts) {
    if (
      !isAddress(c.address) ||
      !safePath(c.abiPath) ||
      !/^[a-f0-9]{64}$/.test(c.abiHash)
    )
      throw Error("Invalid deployment contract configuration.");
    const result = await fetch(new URL(c.abiPath, document.baseURI));
    if (!result.ok)
      throw Error(`Cannot load ${c.name} interface. Reload to retry.`);
    const abi: Abi = await result.json();
    if (
      !Array.isArray(abi) ||
      keccak256(stringToHex(canonical(abi))).slice(2) !== c.abiHash
    )
      throw Error(
        `${c.name} interface hash does not match the deployment. Actions are disabled.`,
      );
    c.abi = abi;
  }
  return config;
}
export function clients(config: Deployment, provider?: Provider) {
  const chain = defineChain({
    id: config.chainId,
    name: config.network.name,
    nativeCurrency: config.network.nativeCurrency,
    rpcUrls: { default: { http: config.network.rpcUrls } },
    testnet: config.network.testnet,
  });
  const transports = config.network.rpcUrls.map((url) =>
    http(url, { batch: { wait: 10 }, timeout: 8000, retryCount: 0 }),
  );
  return {
    chain,
    publicClient: createPublicClient({
      chain,
      transport: fallback(
        [
          ...transports,
          ...(provider ? [custom(provider, { retryCount: 0 })] : []),
        ],
        { rank: false, retryCount: 0 },
      ),
    }),
  };
}
export function contract(config: Deployment, name: string) {
  const found = config.contracts.find((c) => c.name === name);
  if (!found) throw Error(`Missing ${name} deployment.`);
  return found;
}
export async function switchNetwork(provider: Provider, config: Deployment) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.walletAddChain.chainId }],
    });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      e.code !== 4902 &&
      e.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(e.message || "")
    )
      throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [config.walletAddChain],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.walletAddChain.chainId }],
    });
  }
}

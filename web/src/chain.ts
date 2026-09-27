import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  custom,
  formatUnits,
  maxUint256,
  parseUnits,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { clients, contract, type Deployment, type Provider } from "./config";

export type Key = {
  id: bigint;
  owner: Address;
  lister: Address;
  price: bigint;
  user: Address;
  expires: bigint;
};
export type Snapshot = {
  total: bigint;
  maxSupply: bigint;
  maxMints: bigint;
  maxDays: bigint;
  minted: bigint;
  balance: bigint;
  allowance: bigint;
  decimals: number;
  token: Address;
  block: bigint;
  keys: Key[];
  page: number;
};
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const amount = (n: bigint, decimals = 18) => formatUnits(n, decimals);
export function parseAmount(value: string, decimals: number) {
  if (
    !/^\d+(\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length || 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const parsed = parseUnits(value, decimals);
  if (parsed <= 0n || parsed > maxUint256)
    throw Error("Enter an amount greater than zero within the token limit.");
  return parsed;
}
export function errorText(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError;
    const name = revert?.data?.errorName;
    const known: Record<string, string> = {
      TokenInUse:
        "This key is already in use. Choose another key or wait for expiry.",
      PriceAboveMaximum:
        "The price increased. Refresh and review the new price.",
      NotListed: "This listing is no longer available. Refresh the market.",
      SelfRental: "Choose a key owned by another wallet.",
      MintLimitReached: "This wallet has used its three lifetime mints.",
      SoldOut: "All 3,000 keys have been minted.",
      NotTokenOwner: "Only the current owner can change this listing.",
      ERC20InsufficientBalance:
        "Your LEAS balance is too low. Add LEAS, then refresh.",
      ERC20InsufficientAllowance: "Approve the rental cost before renting.",
    };
    if (name && known[name]) return known[name];
  }
  const e = error as { shortMessage?: string; message?: string; code?: number };
  const text =
    e.shortMessage || e.message || "Request failed. Refresh and try again.";
  const isRejection = (cause: unknown) => {
    const value = cause as { code?: number; name?: string } | undefined;
    return value?.code === 4001 || value?.name === "UserRejectedRequestError";
  };
  const walletRejected =
    isRejection(error) ||
    (error instanceof BaseError && isRejection(error.walk(isRejection)));
  return walletRejected ||
    /user rejected|user denied|rejected by user/i.test(text)
    ? "Wallet request declined. You can try again when ready."
    : text.slice(0, 320);
}
export async function readSnapshot(
  config: Deployment,
  account: Address | undefined,
  page: number,
  provider?: Provider,
): Promise<Snapshot> {
  const { publicClient: client } = clients(config, provider);
  const nft = contract(config, "RentableNFT"),
    leas = contract(config, "LaunchToken");
  const id = await client.getChainId();
  if (id !== config.chainId)
    throw Error(
      "RPC returned the wrong chain. Actions are disabled; refresh to retry.",
    );
  const block = await client.getBlockNumber({ cacheTime: 0 });
  const read = (
    c: typeof nft,
    functionName: string,
    args?: readonly unknown[],
  ) =>
    client.readContract({
      address: c.address,
      abi: c.abi,
      functionName,
      args,
      blockNumber: block,
    });
  const [
    nftCode,
    tokenCode,
    token,
    total,
    maxSupply,
    maxMints,
    maxDays,
    decimals,
  ] = await Promise.all([
    client.getBytecode({ address: nft.address, blockNumber: block }),
    client.getBytecode({ address: leas.address, blockNumber: block }),
    read(nft, "token"),
    read(nft, "totalMinted"),
    read(nft, "MAX_SUPPLY"),
    read(nft, "MAX_MINTS_PER_ADDRESS"),
    read(nft, "MAX_RENTAL_DAYS"),
    read(leas, "decimals"),
  ]);
  if (!nftCode || nftCode === "0x" || !tokenCode || tokenCode === "0x")
    throw Error("Deployed contract code is missing. Actions are disabled.");
  if ((token as string).toLowerCase() !== leas.address.toLowerCase())
    throw Error("The payment token does not match the verified deployment.");
  const actualPage = Math.min(
    page,
    Math.max(0, Math.ceil(Number(total) / 25) - 1),
  );
  const [minted, balance, allowance] = account
    ? await Promise.all([
        read(nft, "mintedBy", [account]),
        read(leas, "balanceOf", [account]),
        read(leas, "allowance", [account, nft.address]),
      ])
    : [0n, 0n, 0n];
  const keys: Key[] = await Promise.all(
    Array.from(
      { length: Math.min(25, Number(total) - actualPage * 25) },
      async (_, i) => {
        const tokenId = BigInt(actualPage * 25 + i + 1);
        const [owner, listing, user, expires] = await Promise.all([
          read(nft, "ownerOf", [tokenId]),
          read(nft, "listing", [tokenId]),
          read(nft, "userOf", [tokenId]),
          read(nft, "userExpires", [tokenId]),
        ]);
        const [lister, price] = listing as [Address, bigint];
        return {
          id: tokenId,
          owner: owner as Address,
          lister,
          price,
          user: user as Address,
          expires: expires as bigint,
        };
      },
    ),
  );
  return {
    total: total as bigint,
    maxSupply: maxSupply as bigint,
    maxMints: maxMints as bigint,
    maxDays: maxDays as bigint,
    minted: minted as bigint,
    balance: balance as bigint,
    allowance: allowance as bigint,
    decimals: Number(decimals),
    token: token as Address,
    block,
    keys,
    page: actualPage,
  };
}
export type TxUpdate = {
  phase: "simulating" | "signing" | "pending" | "confirmed" | "failed";
  message: string;
  hash?: Hash;
};
export async function transact(
  config: Deployment,
  provider: Provider,
  account: Address,
  target: "RentableNFT" | "LaunchToken",
  functionName: string,
  args: readonly unknown[],
  update: (s: TxUpdate) => void,
) {
  const { chain, publicClient } = clients(config, provider);
  const check = async () => {
    const [chainId, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    if (
      Number(chainId) !== config.chainId ||
      (accounts as string[])[0]?.toLowerCase() !== account.toLowerCase()
    )
      throw Error("Wallet changed. Reconnect and review the action.");
  };
  await check();
  const c = contract(config, target);
  update({
    phase: "simulating",
    message: "Checking this action against the current contract state…",
  });
  // Validate RPC chain, code, token binding and account state again before each signature.
  await readSnapshot(config, account, 0, provider);
  const simulation = await publicClient.simulateContract({
    address: c.address,
    abi: c.abi,
    functionName,
    args,
    account,
  });
  await check();
  update({
    phase: "signing",
    message: "Review the action and gas fee in your wallet.",
  });
  const wallet = createWalletClient({
    chain,
    transport: custom(provider),
    account,
  });
  const hash = await wallet.writeContract(simulation.request);
  update({
    phase: "pending",
    message: "Transaction submitted. Waiting for confirmation…",
    hash,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 120000,
    confirmations: 1,
  });
  if (receipt.status !== "success")
    throw Error(
      "Transaction reverted on chain. Refresh and review before retrying.",
    );
  update({
    phase: "confirmed",
    message: `${functionName === "approve" ? "Approval" : "Transaction"} confirmed. Refreshing contract state…`,
    hash: receipt.transactionHash,
  });
}
export const isAvailable = (key: Key) =>
  key.price > 0n &&
  key.lister.toLowerCase() === key.owner.toLowerCase() &&
  key.user === zeroAddress;

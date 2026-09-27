import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  decodeFunctionData,
  encodeFunctionResult,
  parseEther,
  zeroAddress,
  type Address,
  type Abi,
} from "viem";
import { readFileSync, writeFileSync } from "node:fs";

const deployment = JSON.parse(
  readFileSync("../dist/imd-deployment.json", "utf8"),
);
const nft = deployment.contracts.find(
  (c: { name: string }) => c.name === "RentableNFT",
);
const token = deployment.contracts.find(
  (c: { name: string }) => c.name === "LaunchToken",
);
const nftAbi = JSON.parse(
  readFileSync("../dist/" + nft.abiPath, "utf8"),
) as Abi;
const tokenAbi = JSON.parse(
  readFileSync("../dist/" + token.abiPath, "utf8"),
) as Abi;
const alice = "0x1111111111111111111111111111111111111111" as Address;
const bob = "0x2222222222222222222222222222222222222222" as Address;
const txHash = "0x" + "ab".repeat(32);
const blockHash = "0x" + "cd".repeat(32);
type Row = {
  owner: Address;
  lister: Address;
  price: bigint;
  user: Address;
  expires: bigint;
};
function makeState(total = 26) {
  return {
    total,
    chain: deployment.chainId,
    paymentToken: token.address as Address,
    minted: 0n,
    balance: parseEther("1000"),
    allowance: 0n,
    badCode: false,
    rpcFail: false,
    reject: false,
    revert: false,
    block: 12000000,
    rows: new Map(
      Array.from({ length: total }, (_, i) => [
        i + 1,
        {
          owner: i === 1 ? alice : bob,
          lister: bob,
          price: parseEther("10"),
          user: zeroAddress,
          expires: 0n,
        } as Row,
      ]),
    ),
    reads: [] as { method: string; id?: number }[],
    writes: [] as { method: string; args: readonly unknown[] }[],
  };
}
async function setup(
  page: Page,
  options: { wallet?: boolean; chain?: number; total?: number } = {},
) {
  const state = makeState(options.total);
  state.rows.get(2) && (state.rows.get(2)!.lister = alice);
  if (options.wallet !== false)
    await page.addInitScript(
      ({ account, chain, hash }) => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        const wallet = {
          chain,
          accounts: [account],
          calls: [] as { method: string; params?: unknown[] }[],
          reject: false,
          unknown: false,
          emit(event: string, payload: unknown) {
            for (const f of handlers[event] || []) f(payload);
          },
          async request(args: { method: string; params?: unknown[] }) {
            wallet.calls.push(args);
            if (
              wallet.reject &&
              ["eth_sendTransaction", "eth_requestAccounts"].includes(
                args.method,
              )
            )
              throw Object.assign(Error("User rejected the request"), {
                code: 4001,
              });
            if (
              args.method === "eth_requestAccounts" ||
              args.method === "eth_accounts"
            )
              return wallet.accounts;
            if (args.method === "eth_chainId")
              return "0x" + wallet.chain.toString(16);
            if (args.method === "wallet_switchEthereumChain") {
              if (wallet.unknown) {
                wallet.unknown = false;
                throw Object.assign(Error("Unknown chain"), { code: 4902 });
              }
              wallet.chain = Number(
                (args.params![0] as { chainId: string }).chainId,
              );
              wallet.emit("chainChanged", "0x" + wallet.chain.toString(16));
              return null;
            }
            if (args.method === "wallet_addEthereumChain") return null;
            if (args.method === "eth_sendTransaction") {
              await fetch("/__test/transaction", {
                method: "POST",
                body: JSON.stringify(args.params![0]),
              });
              return hash;
            }
            if (args.method === "eth_estimateGas") return "0x186a0";
            throw Error("Unexpected wallet method " + args.method);
          },
          on(event: string, f: (...args: unknown[]) => void) {
            (handlers[event] ||= []).push(f);
          },
          removeListener(event: string, f: (...args: unknown[]) => void) {
            handlers[event] = (handlers[event] || []).filter((x) => x !== f);
          },
        };
        Object.assign(window, { ethereum: wallet, __wallet: wallet });
      },
      {
        account: alice,
        chain: options.chain ?? deployment.chainId,
        hash: txHash,
      },
    );

  await page.route("**/__test/transaction", async (route) => {
    const tx = route.request().postDataJSON();
    const abi =
      tx.to.toLowerCase() === token.address.toLowerCase() ? tokenAbi : nftAbi;
    const data = decodeFunctionData({ abi, data: tx.data });
    const args = data.args || [];
    state.writes.push({ method: data.functionName, args });
    const row = state.rows.get(Number(args[0]));
    if (data.functionName === "approve") state.allowance = args[1] as bigint;
    if (data.functionName === "mint") {
      state.total++;
      state.minted++;
      state.rows.set(state.total, {
        owner: alice,
        lister: zeroAddress,
        price: 0n,
        user: zeroAddress,
        expires: 0n,
      });
    }
    if (data.functionName === "list") {
      row!.lister = alice;
      row!.price = args[1] as bigint;
    }
    if (data.functionName === "unlist") {
      row!.lister = zeroAddress;
      row!.price = 0n;
    }
    if (data.functionName === "rent") {
      const cost = row!.price * (args[1] as bigint);
      state.balance -= cost;
      state.allowance -= cost;
      row!.user = alice;
      row!.expires = 1900000000n;
    }
    if (data.functionName === "setUser") {
      row!.user = args[1] as Address;
      row!.expires = args[2] as bigint;
    }
    if (data.functionName === "safeTransferFrom") {
      const transferred = state.rows.get(Number(args[2]))!;
      transferred.owner = args[1] as Address;
      transferred.price = 0n;
      transferred.lister = zeroAddress;
    }
    state.block++;
    await route.fulfill({ json: { hash: txHash } });
  });
  for (const url of deployment.network.rpcUrls)
    await page.route(url, async (route) => {
      if (state.rpcFail) {
        await route.fulfill({ status: 503, body: "Temporarily unavailable" });
        return;
      }
      const requests = route.request().postDataJSON();
      function handle(req: { id: number; method: string; params: any[] }) {
        let result: unknown;
        if (req.method === "eth_chainId")
          result = "0x" + state.chain.toString(16);
        else if (req.method === "eth_blockNumber")
          result = "0x" + state.block.toString(16);
        else if (req.method === "eth_getCode")
          result = state.badCode ? "0x" : "0x60006000";
        else if (req.method === "eth_getTransactionReceipt")
          result = {
            transactionHash: txHash,
            transactionIndex: "0x0",
            blockHash,
            blockNumber: "0x" + state.block.toString(16),
            from: alice,
            to: nft.address,
            cumulativeGasUsed: "0x5208",
            gasUsed: "0x5208",
            contractAddress: null,
            logs: [],
            logsBloom: "0x" + "00".repeat(256),
            status: "0x1",
            effectiveGasPrice: "0x1",
            type: "0x2",
          };
        else if (req.method === "eth_call") {
          const call = req.params[0];
          const abi =
            call.to.toLowerCase() === token.address.toLowerCase()
              ? tokenAbi
              : nftAbi;
          const { functionName, args = [] } = decodeFunctionData({
            abi,
            data: call.data,
          });
          const id = Number(args[0]);
          state.reads.push({ method: functionName, id });
          const row = state.rows.get(id);
          const view: Record<string, unknown> = {
            token: state.paymentToken,
            totalMinted: BigInt(state.total),
            MAX_SUPPLY: 3000n,
            MAX_MINTS_PER_ADDRESS: 3n,
            MAX_RENTAL_DAYS: 30n,
            decimals: 18,
            mintedBy: state.minted,
            balanceOf: state.balance,
            allowance: state.allowance,
            ownerOf: row?.owner,
            listing: [row?.lister, row?.price],
            userOf: row?.user,
            userExpires: row?.expires,
          };
          if (functionName in view)
            result = encodeFunctionResult({
              abi,
              functionName,
              result: view[functionName],
            });
          else if (state.revert)
            return {
              jsonrpc: "2.0",
              id: req.id,
              error: {
                code: 3,
                message: "execution reverted: rejected simulation",
                data: "0x",
              },
            };
          else
            result =
              functionName === "approve"
                ? encodeFunctionResult({ abi, functionName, result: true })
                : functionName === "mint"
                  ? encodeFunctionResult({
                      abi,
                      functionName,
                      result: BigInt(state.total + 1),
                    })
                  : "0x";
        } else throw Error("Unexpected RPC method " + req.method);
        return { jsonrpc: "2.0", id: req.id, result };
      }
      await route.fulfill({
        json: Array.isArray(requests) ? requests.map(handle) : handle(requests),
      });
    });
  return state;
}
async function open(page: Page) {
  await page.goto("/lease/");
  await expect(page.getByText(/Live contract views/)).toBeVisible();
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeEnabled();
}
async function confirmed(page: Page) {
  await expect(page.getByText(/confirmed\./)).toBeVisible();
  await expect(page.getByText(/Live contract views/)).toBeVisible();
}

test("static gateway subpath, disconnected reads, pagination of exactly 25 IDs, missing wallet", async ({
  page,
}) => {
  const state = await setup(page, { wallet: false });
  await open(page);
  await expect(page.locator("tbody tr")).toHaveCount(25);
  expect(
    Math.max(
      ...state.reads.filter((r) => r.method === "ownerOf").map((r) => r.id!),
    ),
  ).toBe(25);
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Select key 26", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText(/No browser wallet found/)).toBeVisible();
});
test("wrong chain offers exact add-chain parameters after 4902", async ({
  page,
}) => {
  await setup(page, { chain: 1 });
  await open(page);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("Wallet is on the wrong network")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as any).__wallet.unknown = true;
  });
  await page.getByRole("button", { name: "Switch to Sepolia" }).click();
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).__wallet.calls);
  expect(
    calls.find((c: any) => c.method === "wallet_addEthereumChain").params,
  ).toEqual([deployment.walletAddChain]);
  expect(
    calls.filter((c: any) => c.method === "wallet_switchEthereumChain"),
  ).toHaveLength(2);
});
test("mint receipt and lifetime mint cap", async ({ page }) => {
  const state = await setup(page);
  state.minted = 2n;
  await open(page);
  await connect(page);
  await page.getByRole("button", { name: "Mint a free key" }).click();
  await confirmed(page);
  expect(state.writes[0].method).toBe("mint");
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeDisabled();
  await expect(
    page.getByText("3 of 3 minted by this wallet · gas fees apply"),
  ).toBeVisible();
});
test("owner lists, validates precision, and unlists without shortening a rental", async ({
  page,
}) => {
  const state = await setup(page);
  state.rows.get(2)!.user = bob;
  state.rows.get(2)!.expires = 1900000000n;
  await open(page);
  await connect(page);
  await page.getByRole("button", { name: "Select key 2", exact: true }).click();
  await page.getByLabel("Daily price").fill("0.0000000000000000001");
  await page.getByRole("button", { name: "Update listing" }).click();
  await expect(page.getByText(/at most 18 decimal places/)).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.getByLabel("Daily price").fill("12.5");
  await page.getByRole("button", { name: "Update listing" }).click();
  await confirmed(page);
  expect(state.rows.get(2)!.price).toBe(parseEther("12.5"));
  await page.getByRole("button", { name: "Unlist key", exact: true }).click();
  await confirmed(page);
  expect(state.rows.get(2)!.price).toBe(0n);
  expect(state.rows.get(2)!.user).toBe(bob);
  expect(state.rows.get(2)!.expires).toBe(1900000000n);
});
test("approve exact total, then rent with reviewed price ceiling and refreshed balances", async ({
  page,
}) => {
  const state = await setup(page);
  await open(page);
  await connect(page);
  await page.getByRole("button", { name: "Select key 1", exact: true }).click();
  await page.getByLabel("Rental duration").fill("3");
  await expect(
    page.getByRole("button", { name: "2. Rent key" }),
  ).toBeDisabled();
  await page
    .locator(".editor")
    .screenshot({ path: "../docs/evidence/rental-review.png" });
  await page.getByRole("button", { name: "1. Approve LEAS" }).click();
  await confirmed(page);
  expect(state.writes[0]).toEqual({
    method: "approve",
    args: [
      expect.stringMatching(new RegExp(nft.address, "i")),
      parseEther("30"),
    ],
  });
  await page.getByRole("button", { name: "2. Rent key" }).click();
  await confirmed(page);
  expect(state.writes[1]).toEqual({
    method: "rent",
    args: [1n, 3n, parseEther("10")],
  });
  expect(state.balance).toBe(parseEther("970"));
  expect(state.allowance).toBe(0n);
  await expect(page.getByText(/This key is in use\. Wait/)).toBeVisible();
});
test("price rise after approval is never silently accepted", async ({
  page,
}) => {
  const state = await setup(page);
  await open(page);
  await connect(page);
  await page.getByRole("button", { name: "Select key 1", exact: true }).click();
  await page.getByRole("button", { name: "1. Approve LEAS" }).click();
  await confirmed(page);
  state.rows.get(1)!.price = parseEther("20");
  await page.getByRole("button", { name: "Refresh state" }).click();
  await expect(page.getByText(/The listing price changed/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2. Rent key" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Review latest price" }).click();
  await expect(
    page.getByRole("button", { name: "1. Approve LEAS" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "2. Rent key" }),
  ).toBeDisabled();
  expect(state.writes).toHaveLength(1);
});
test("invalid days, self-rental, insufficient funds and active users block payment", async ({
  page,
}) => {
  const state = await setup(page);
  state.balance = 0n;
  await open(page);
  await connect(page);
  await page.getByRole("button", { name: "Select key 1", exact: true }).click();
  await expect(
    page.getByText(/balance is below the rental cost/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1. Approve LEAS" }),
  ).toBeDisabled();
  for (const days of ["0", "31", "1.5"]) {
    await page.getByLabel("Rental duration").fill(days);
    await expect(
      page.getByText("Enter a whole number from 1 to 30."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "2. Rent key" }),
    ).toBeDisabled();
  }
  await page.getByRole("button", { name: "Select key 2", exact: true }).click();
  await expect(page.getByRole("button", { name: "2. Rent key" })).toHaveCount(
    0,
  );
  state.rows.get(1)!.user = bob;
  state.rows.get(1)!.expires = 1900000000n;
  await page.getByRole("button", { name: "Refresh state" }).click();
  await expect(page.getByText(/Live contract views/)).toBeVisible();
  await page.getByRole("button", { name: "Select key 1", exact: true }).click();
  await expect(page.getByText(/This key is in use\. Wait/)).toBeVisible();
});
test("wallet rejection and failed simulation are recoverable without broadcast", async ({
  page,
}) => {
  const state = await setup(page);
  await open(page);
  await connect(page);
  await page.evaluate(() => {
    (window as any).__wallet.reject = true;
  });
  await page.getByRole("button", { name: "Mint a free key" }).click();
  await expect(
    page.getByText("Wallet request declined. You can try again when ready."),
  ).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.evaluate(() => {
    (window as any).__wallet.reject = false;
  });
  state.revert = true;
  await page.getByRole("button", { name: "Mint a free key" }).click();
  await expect(page.locator(".notice.error")).toContainText("reverted");
  expect(state.writes).toHaveLength(0);
});
test("chain, code and ABI integrity failures disable transactions", async ({
  page,
}) => {
  const state = await setup(page);
  state.badCode = true;
  await page.goto("/lease/");
  await expect(
    page.getByText(/Deployed contract code is missing/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeDisabled();
  state.badCode = false;
  state.chain = 1;
  await page.getByRole("button", { name: "Refresh state" }).click();
  await expect(page.getByText(/RPC returned the wrong chain/)).toBeVisible();
  state.chain = deployment.chainId;
  state.paymentToken = bob;
  await page.getByRole("button", { name: "Refresh state" }).click();
  await expect(page.getByText(/payment token does not match/)).toBeVisible();
  await page.route("**/abi/LaunchToken.json", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.reload();
  await expect(page.getByText(/interface hash does not match/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toBeDisabled();
});
test("account change discards selection, approval and wallet balances", async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await connect(page);
  await page.getByRole("button", { name: "Select key 1", exact: true }).click();
  await page.getByRole("button", { name: "1. Approve LEAS" }).click();
  await confirmed(page);
  await page.evaluate(
    ({ bob }) => {
      const w = (window as any).__wallet;
      w.accounts = [bob];
      w.emit("accountsChanged", [bob]);
    },
    { bob },
  );
  await expect(
    page.getByRole("heading", { name: "Make room for access." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "2. Rent key" })).toHaveCount(
    0,
  );
});
test("owner can assign free access, transfer with acknowledgement, and revoke allowance", async ({
  page,
}) => {
  const state = await setup(page);
  await open(page);
  await connect(page);
  await page.getByRole("button", { name: "Select key 2", exact: true }).click();
  await page.getByText("Transfer or assign access", { exact: true }).click();
  await page.getByLabel("Recipient address").fill(bob);
  await page.getByLabel("Access expiry (UTC)").fill("2030-01-01T12:00");
  await expect(
    page.getByRole("button", { name: "Assign free access" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Assign free access" }).click();
  await confirmed(page);
  expect(state.rows.get(2)!.user).toBe(bob);
  await expect(
    page.getByRole("button", { name: "Assign free access" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  await confirmed(page);
  expect(state.rows.get(2)!.owner).toBe(bob);
  expect(state.rows.get(2)!.user).toBe(bob);
  expect(state.rows.get(2)!.price).toBe(0n);
  state.allowance = parseEther("10");
  await page.getByRole("button", { name: "Refresh state" }).click();
  await expect(page.getByText(/Live contract views/)).toBeVisible();
  await page.locator("#deployment summary").click();
  await page.getByRole("button", { name: "Revoke rental allowance" }).click();
  await confirmed(page);
  expect(state.allowance).toBe(0n);
});
test("empty collection is actionable", async ({ page }) => {
  await setup(page, { total: 0 });
  await open(page);
  await expect(
    page.getByText(
      "No keys have been minted yet. Connect a wallet and mint the first one.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
});
test("RPC fallback and read failure recover without enabling stale actions", async ({
  page,
}) => {
  const state = await setup(page);
  await page.route(deployment.network.rpcUrls[0], (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await open(page);
  await connect(page);
  state.rpcFail = true;
  await page.getByRole("button", { name: "Refresh state" }).click();
  await expect(
    page.getByText(/Could not refresh contract state/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeDisabled();
  state.rpcFail = false;
  await page.getByRole("button", { name: "Retry reads" }).click();
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeEnabled();
});
test("keyboard alone completes connect, select, approve and rent", async ({
  page,
}) => {
  const state = await setup(page, { total: 1 });
  await open(page);
  async function tabTo(name: string) {
    const target = page.getByRole("button", { name, exact: true });
    for (let i = 0; i < 30; i++) {
      if (await target.evaluate((el) => document.activeElement === el)) return;
      await page.keyboard.press("Tab");
    }
    throw Error("Keyboard could not reach " + name);
  }
  await tabTo("Connect wallet");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeEnabled();
  await tabTo("Select key 1");
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Rental duration")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("2");
  await tabTo("1. Approve LEAS");
  await page.keyboard.press("Enter");
  await confirmed(page);
  await expect(page.getByRole("button", { name: "2. Rent key" })).toBeEnabled();
  await tabTo("2. Rent key");
  await page.keyboard.press("Enter");
  await confirmed(page);
  expect(state.writes.map((w) => w.method)).toEqual(["approve", "rent"]);
  expect(state.writes[1].args).toEqual([1n, 2n, parseEther("10")]);
});
test("desktop/mobile render, keyboard focus, zoom reflow, reduced motion and automated accessibility", async ({
  page,
}) => {
  test.setTimeout(90000);
  await setup(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  await open(page);
  await connect(page);
  const pairs = await page.evaluate(() => {
    return [
      "h1",
      ".intro h1 span",
      ".mint-button",
      ".mint-note",
      ".row-state",
      ".label",
    ].map((selector) => {
      const element = document.querySelector(selector)!;
      let ancestor: Element | null = element;
      let background = "rgba(0, 0, 0, 0)";
      while (ancestor && background === "rgba(0, 0, 0, 0)") {
        background = getComputedStyle(ancestor).backgroundColor;
        ancestor = ancestor.parentElement;
      }
      return {
        selector,
        foreground: getComputedStyle(element).color,
        background,
      };
    });
  });
  function luminance(rgb: string) {
    const [r, g, b] = rgb
      .match(/\d+/g)!
      .slice(0, 3)
      .map((n) => {
        const c = Number(n) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contrast = pairs.map((pair) => {
    const a = luminance(pair.foreground),
      b = luminance(pair.background);
    return {
      ...pair,
      ratio: Number(
        ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
      ),
    };
  });
  for (const pair of contrast) expect(pair.ratio).toBeGreaterThanOrEqual(4.5);
  writeFileSync(
    "../docs/evidence/contrast.json",
    JSON.stringify(contrast, null, 2),
  );
  const metrics = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({
      path: `../docs/evidence/market-${width}.png`,
      fullPage: true,
    });
    metrics.push({
      width,
      overflow: false,
      axeViolations: result.violations.length,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.getByText(/Live contract views/)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to marketplace" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toBeFocused();
  await page.screenshot({
    path: "../docs/evidence/keyboard-focus.png",
    fullPage: false,
  });
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Mint a free key" }),
  ).toBeEnabled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByRole("button", { name: "Mint a free key" })
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.setViewportSize({ width: 768, height: 1000 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 768);
  await page.screenshot({
    path: "../docs/evidence/text-resize.png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
  writeFileSync(
    "../docs/evidence/browser-summary.json",
    JSON.stringify(
      {
        metrics,
        keyboard: "Tab to connect; Enter connects; visible focus screenshot",
        textResize:
          "200% root font size at 768px; no page overflow (not native zoom)",
        reducedMotion: "0s button transitions",
        consoleErrors: errors,
        failedResources: failed,
        note: "Mocked chain and wallet; no real funds or transactions",
      },
      null,
      2,
    ),
  );
});

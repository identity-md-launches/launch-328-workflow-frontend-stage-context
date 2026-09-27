import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeFunctionData, decodeFunctionResult } from "viem";
const root = resolve(import.meta.dirname, "../..");
const deployment = JSON.parse(
  readFileSync(resolve(root, "dist/imd-deployment.json")),
);
const report = {
  timestamp: new Date().toISOString(),
  mode: "read-only; no transaction broadcast",
  endpoints: [],
};
const nft = deployment.contracts.find((c) => c.name === "RentableNFT");
const abi = JSON.parse(readFileSync(resolve(root, "dist", nft.abiPath)));
for (const url of deployment.network.rpcUrls) {
  const entry = { url, result: "unavailable" };
  try {
    const requests = [
      { method: "eth_chainId", params: [] },
      ...deployment.contracts.map((c) => ({
        method: "eth_getCode",
        params: [c.address, "latest"],
      })),
      ...["token", "totalMinted"].map((functionName) => ({
        method: "eth_call",
        params: [
          { to: nft.address, data: encodeFunctionData({ abi, functionName }) },
          "latest",
        ],
      })),
    ];
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        requests.map((r, id) => ({ jsonrpc: "2.0", id, ...r })),
      ),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const body = await res.json();
    const results = requests.map((_, i) => {
      const r = body.find((x) => x.id === i);
      if (r?.error || !r?.result)
        throw Error(r?.error?.message || "Missing RPC response");
      return r.result;
    });
    entry.chainId = Number(results[0]);
    entry.contracts = deployment.contracts.map((c, i) => ({
      name: c.name,
      codeBytes: (results[i + 1].length - 2) / 2,
    }));
    entry.token = decodeFunctionResult({
      abi,
      functionName: "token",
      data: results[3],
    });
    entry.totalMinted = decodeFunctionResult({
      abi,
      functionName: "totalMinted",
      data: results[4],
    }).toString();
    entry.result =
      entry.chainId === deployment.chainId &&
      entry.contracts.every((c) => c.codeBytes > 0) &&
      entry.token.toLowerCase() ===
        deployment.contracts
          .find((c) => c.name === "LaunchToken")
          .address.toLowerCase()
        ? "PASS"
        : "FAIL";
  } catch (e) {
    entry.error = e.message;
  }
  report.endpoints.push(entry);
}
writeFileSync(
  resolve(root, "docs/evidence/rpc-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));

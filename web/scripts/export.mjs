import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, stringToHex, isAddress } from "viem";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dist = resolve(root, "dist");
const handoff = JSON.parse(
  readFileSync(resolve(root, "web/config/deployment.json")),
);
const network = JSON.parse(
  readFileSync(resolve(root, "web/config/network.json")),
);
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
if (
  handoff.chainId !== network.network.chainId ||
  Number(network.walletAddChain.chainId) !== handoff.chainId
)
  throw Error("Handoff chain mismatch");
mkdirSync(resolve(dist, "abi"), { recursive: true });
const contracts = handoff.contracts.map(({ name, address, abiHash }) => {
  if (!/^[A-Za-z0-9_]+$/.test(name) || !isAddress(address))
    throw Error("Invalid contract");
  const bytes = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/abi/${name}.json`],
    { cwd: root },
  );
  const abi = JSON.parse(bytes);
  const hash = keccak256(stringToHex(canonical(abi))).slice(2);
  if (!Array.isArray(abi) || hash !== abiHash)
    throw Error(`${name}: ABI hash mismatch: ${hash}`);
  const abiPath = `abi/${name}.json`;
  writeFileSync(resolve(dist, abiPath), bytes);
  return { name, address, abiHash, abiPath };
});
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
  );
}
const assets = walk(dist)
  .filter((p) => relative(dist, p) !== "imd-deployment.json")
  .sort()
  .map((p) => {
    const bytes = readFileSync(p);
    if (bytes.length > 8388608) throw Error("Asset exceeds 8 MiB");
    return {
      path: relative(dist, p).split("\\").join("/"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
if (assets.length > 128) throw Error("Too many assets");
const { launchId, chainId, sourceCommit, attestationHash } = handoff;
writeFileSync(
  resolve(dist, "imd-deployment.json"),
  JSON.stringify(
    {
      version: 1,
      launchId,
      chainId,
      sourceCommit,
      attestationHash,
      contracts,
      assets,
      network: network.network,
      walletAddChain: network.walletAddChain,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Exported ${assets.length} assets; implementation ABIs match pinned handoff.`,
);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { keccak256, stringToHex } from "viem";
const root = resolve(import.meta.dirname, "../.."),
  dist = resolve(root, "dist");
const read = (p) => JSON.parse(readFileSync(p));
const manifest = read(resolve(dist, "imd-deployment.json"));
const handoff = read(resolve(root, "web/config/deployment.json"));
const net = read(resolve(root, "web/config/network.json"));
const canonical = (x) =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
for (const key of ["launchId", "chainId", "sourceCommit", "attestationHash"])
  assert.equal(manifest[key], handoff[key]);
assert.equal(manifest.version, 1);
assert.deepEqual(manifest.network, net.network);
assert.deepEqual(manifest.walletAddChain, net.walletAddChain);
assert.deepEqual(
  manifest.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
  handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
);
for (const c of manifest.contracts) {
  const bytes = readFileSync(resolve(dist, c.abiPath));
  assert.deepEqual(
    bytes,
    execFileSync(
      "git",
      ["show", `${handoff.sourceCommit}:docs/abi/${c.name}.json`],
      { cwd: root },
    ),
  );
  assert.equal(
    keccak256(stringToHex(canonical(JSON.parse(bytes)))).slice(2),
    c.abiHash,
  );
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(resolve(dir, e.name))
      : [relative(dist, resolve(dir, e.name))],
  );
}
const files = walk(dist)
  .filter((p) => p !== "imd-deployment.json")
  .sort();
assert.deepEqual(manifest.assets.map((a) => a.path).sort(), files);
assert(files.includes("index.html"));
assert(files.length <= 128);
let total = statSync(resolve(dist, "imd-deployment.json")).size;
for (const asset of manifest.assets) {
  assert(
    !asset.path.startsWith("/") &&
      !asset.path.includes("..") &&
      !asset.path.includes(":"),
  );
  const bytes = readFileSync(resolve(dist, asset.path));
  assert(bytes.length <= 8388608);
  total += bytes.length;
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
}
assert(total < 32 * 1024 * 1024);
assert(
  !/src="\/|href="\/assets/.test(
    readFileSync(resolve(dist, "index.html"), "utf8"),
  ),
);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      assets: files.length,
      exportBytes: total,
      abiChecks: "pinned bytes and canonical Keccak",
      network: "unchanged",
      inventory: "complete SHA-256",
    },
    null,
    2,
  ),
);

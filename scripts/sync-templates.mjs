import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourceRoot = resolve(repoRoot, "..", "mainz", "templates");
const destinationRoot = resolve(repoRoot, "templates");

await rm(destinationRoot, { recursive: true, force: true });
await cp(sourceRoot, destinationRoot, { recursive: true });

console.log(`[mainz-cli-node] Synced templates from ${sourceRoot}`);

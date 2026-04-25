import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..", "..");

export function resolveBuiltInTemplateRoot(kind, name) {
    return resolve(repoRoot, "templates", kind, name);
}

export async function loadTemplate(templateRoot) {
    const manifestPath = resolve(templateRoot, "template.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    if (!manifest.kind || !manifest.name) {
        throw new Error(`Invalid template manifest at "${manifestPath}".`);
    }

    return {
        manifest,
        root: templateRoot,
        filesRoot: resolve(templateRoot, "files"),
    };
}

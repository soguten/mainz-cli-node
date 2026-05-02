import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cachedCliVersion;
let cachedPackageJson;
let cachedCliHosts;

async function loadCurrentPackageJson() {
    if (cachedPackageJson) {
        return cachedPackageJson;
    }

    const packageJsonPath = resolve(
        fileURLToPath(new URL("../../package.json", import.meta.url)),
    );
    cachedPackageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return cachedPackageJson;
}

export async function resolveCurrentCliVersion() {
    if (cachedCliVersion) {
        return cachedCliVersion;
    }

    const packageJson = await loadCurrentPackageJson();
    const version = packageJson.version;
    if (typeof version !== "string" || !version.trim()) {
        throw new Error(
            'Could not resolve the current "@mainzjs/cli-node" package version.',
        );
    }

    cachedCliVersion = version.trim();
    return cachedCliVersion;
}

export async function resolveConfiguredCliHosts() {
    if (cachedCliHosts) {
        return cachedCliHosts;
    }

    const packageJson = await loadCurrentPackageJson();
    const configuredHosts = packageJson.mainzCliHosts;
    if (
        configuredHosts &&
        typeof configuredHosts === "object" &&
        !Array.isArray(configuredHosts) &&
        typeof configuredHosts.framework === "string" &&
        typeof configuredHosts.cliDeno === "string" &&
        typeof configuredHosts.cliBun === "string" &&
        typeof configuredHosts.cliNode === "string"
    ) {
        cachedCliHosts = {
            framework: configuredHosts.framework.trim(),
            cliDeno: configuredHosts.cliDeno.trim(),
            cliBun: configuredHosts.cliBun.trim(),
            cliNode: configuredHosts.cliNode.trim(),
        };
        return cachedCliHosts;
    }

    const version = await resolveCurrentCliVersion();
    cachedCliHosts = {
        framework: renderHostedCliPackageSpecifier("mainz", version),
        cliDeno: renderHostedCliPackageSpecifier("deno", version),
        cliBun: renderHostedCliPackageSpecifier("bun", version),
        cliNode: renderHostedCliPackageSpecifier("node", version),
    };
    return cachedCliHosts;
}

export async function resolveDefaultMainzSpecifierForRuntime(runtime = "node") {
    const hosts = await resolveConfiguredCliHosts();
    if (runtime === "deno") {
        return hosts.framework;
    }

    const version = await resolveCurrentCliVersion();
    return `npm:@jsr/mainz__mainz@${version}`;
}

export function renderGeneratedMainzCliSpecifier(mainzSpecifier) {
    const trimmed = mainzSpecifier.trim().replace(/\/+$/, "");
    const jsrMainzMatch = trimmed.match(/^jsr:@mainz\/mainz(@.+)?$/);
    if (jsrMainzMatch) {
        return `jsr:@mainz/cli-deno${jsrMainzMatch[1] ?? ""}`;
    }

    return trimmed;
}

export function renderHostedCliPackageSpecifier(cli, version) {
    if (cli === "deno") {
        return `jsr:@mainz/cli-deno@${version}`;
    }

    if (cli === "bun") {
        return `@mainzjs/cli-bun@${version}`;
    }

    if (cli === "node") {
        return `@mainzjs/cli-node@${version}`;
    }

    if (cli === "mainz") {
        return `jsr:@mainz/mainz@${version}`;
    }

    throw new Error(`Unsupported hosted CLI "${cli}".`);
}

export async function resolveHostedCliPackageSpecifier(cli) {
    const hosts = await resolveConfiguredCliHosts();

    if (cli === "mainz") {
        return hosts.framework;
    }

    if (cli === "deno") {
        return hosts.cliDeno;
    }

    if (cli === "bun") {
        return hosts.cliBun;
    }

    if (cli === "node") {
        return hosts.cliNode;
    }

    throw new Error(`Unsupported hosted CLI "${cli}".`);
}

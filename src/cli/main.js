import { access, readFile } from "node:fs/promises";
import process from "node:process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as upstreamMain } from "@mainz/cli-node";
import { runDevCommand } from "./dev.js";
import { materializeTemplate } from "../templates/index.js";
import { resolveBuiltInTemplateRoot } from "../templates/load-template.js";

export async function main(args = process.argv.slice(2)) {
    const { args: commandArgs, runtime: leadingRuntime } = extractLeadingGlobalOptions(args);
    const command = commandArgs[0];
    if (!command || command === "--help" || command === "-h" || command === "help") {
        printHelp();
        return 0;
    }

    if (command === "init") {
        await runInitCommand(commandArgs.slice(1), leadingRuntime);
        return 0;
    }

    if (command === "app") {
        assertSupportedNodeRuntime(leadingRuntime);
        await runAppCommand(commandArgs.slice(1));
        return 0;
    }

    if (command === "dev") {
        assertSupportedNodeRuntime(leadingRuntime);
        return await runDevCommand(commandArgs.slice(1));
    }

    assertSupportedNodeRuntime(leadingRuntime);
    return await upstreamMain(commandArgs, { hostRuntime: "node" });
}

async function runInitCommand(args, leadingRuntime) {
    const options = parseInitOptions(args);
    const projectName = basename(process.cwd()) || "mainz-app";
    const runtime = options.runtime ?? leadingRuntime ?? "node";
    const templateRoot = resolveBuiltInTemplateRoot("project", runtime === "deno" ? "empty-deno" : "empty-node");
    const mainzSpecifier = options.mainzSpecifier ?? await resolveDefaultMainzSpecifier(runtime);
    const plan = await materializeTemplate({
        templateRoot,
        outputDir: process.cwd(),
        params: {
            mainzSpecifier,
            projectName,
            denoConfigPath: "deno.json",
            mainzCliSpecifier: renderGeneratedMainzCliSpecifier(mainzSpecifier),
            mainzSubpathPrefix: renderGeneratedMainzSubpathPrefix(mainzSpecifier),
        },
        beforeWrite: assertCanCreateFile,
    });

    console.log(`[mainz] Initialized Mainz project in ${process.cwd()}.`);
    console.log(`[mainz] Created ${plan.files.map((file) => file.path).join(", ")}.`);
    console.log('[mainz] Add an app with "mainz app create <name>".');
}

async function assertCanCreateFile(path) {
    try {
        await access(path);
        throw new Error(`Refusing to overwrite existing file "${path}".`);
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return;
        }

        throw error;
    }
}

async function runAppCommand(args) {
    const [action, ...rest] = args;
    if (action === "create") {
        await runAppCreateCommand(rest);
        return;
    }

    return await upstreamMain(["app", action, ...rest], { hostRuntime: "node" });
}

async function runAppCreateCommand(args) {
    const options = parseAppCreateOptions(args);
    await assertNodeProjectConfig(options.configPath);

    const appName = normalizeAppName(options.name);
    const rootDir = normalizeAppRoot(options.root ?? `./${appName}`);
    const outDir = normalizeOutDir(options.outDir ?? `dist/${appName}`);
    const rootPath = resolve(process.cwd(), rootDir);
    const templateRoot = resolveBuiltInTemplateRoot("app", options.type);

    await materializeTemplate({
        templateRoot,
        outputDir: rootPath,
        params: {
            appName,
            appId: appName,
            appNavigation: options.navigation,
            appTitle: appName,
            customElementPrefix: `x-mainz-${toKebabCase(appName)}`,
        },
        beforeWrite: assertCanCreateFile,
    });

    await upsertConfigTarget(
        options.configPath,
        renderConfigTarget({
            name: appName,
            rootDir,
            appFile: `${rootDir}/src/app.ts`,
            appId: appName,
            outDir,
        }),
    );

    console.log(`[mainz] Created app "${appName}" in ${rootDir}.`);
}

function parseInitOptions(args) {
    const options = {
        mainzSpecifier: undefined,
        runtime: undefined,
    };

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index];

        if (current === "--mainz") {
            options.mainzSpecifier = readOptionValue(current, args[index + 1]);
            index += 1;
            continue;
        }

        if (current === "--runtime") {
            const runtime = readOptionValue(current, args[index + 1]);
            if (runtime !== "node" && runtime !== "deno") {
                throw new Error(
                    `Unsupported runtime "${runtime}". Use "node" or "deno".`,
                );
            }

            options.runtime = runtime;
            index += 1;
            continue;
        }

        throw new Error(`Unknown option "${current}".`);
    }

    return options;
}

function parseAppCreateOptions(args) {
    const options = {
        name: undefined,
        type: "routed",
        root: undefined,
        outDir: undefined,
        navigation: "enhanced-mpa",
        configPath: "mainz.config.ts",
    };

    const positionalName = args[0]?.startsWith("--") ? undefined : args[0];
    const remaining = positionalName ? args.slice(1) : args;

    if (positionalName) {
        options.name = positionalName;
    }

    for (let index = 0; index < remaining.length; index += 1) {
        const current = remaining[index];

        if (current === "--name") {
            options.name = readOptionValue(current, remaining[index + 1]);
            index += 1;
            continue;
        }

        if (current === "--type") {
            const type = readOptionValue(current, remaining[index + 1]);
            if (type !== "routed" && type !== "root") {
                throw new Error(`Unsupported app type "${type}". Use "routed" or "root".`);
            }

            options.type = type;
            index += 1;
            continue;
        }

        if (current === "--root") {
            options.root = readOptionValue(current, remaining[index + 1]);
            index += 1;
            continue;
        }

        if (current === "--out-dir") {
            options.outDir = readOptionValue(current, remaining[index + 1]);
            index += 1;
            continue;
        }

        if (current === "--navigation") {
            const navigation = readOptionValue(current, remaining[index + 1]);
            if (navigation !== "spa" && navigation !== "mpa" && navigation !== "enhanced-mpa") {
                throw new Error(
                    `Unsupported app navigation "${navigation}". Use "spa", "mpa", or "enhanced-mpa".`,
                );
            }

            options.navigation = navigation;
            index += 1;
            continue;
        }

        if (current === "--config") {
            options.configPath = readOptionValue(current, remaining[index + 1]);
            index += 1;
            continue;
        }

        if (current === "--runtime") {
            const runtime = readOptionValue(current, remaining[index + 1]);
            if (runtime !== "node") {
                throw new Error(
                    `This CLI package only supports runtime "node". Received "${runtime}".`,
                );
            }

            index += 1;
            continue;
        }

        throw new Error(`Unknown option "${current}".`);
    }

    if (!options.name?.trim()) {
        throw new Error('Command "app create" requires a name.');
    }

    return options;
}

function readOptionValue(option, value) {
    if (!value?.trim()) {
        throw new Error(`Option "${option}" requires a value.`);
    }

    return value;
}

async function resolveDefaultMainzSpecifier(runtime = "node") {
    const packageJsonPath = resolve(fileURLToPath(new URL("../../package.json", import.meta.url)));
    const packageJson = JSON.parse(
        await readFile(packageJsonPath, "utf8"),
    );
    const dependency = packageJson.dependencies?.["@mainz/cli-node"];
    if (typeof dependency !== "string") {
        throw new Error('Could not resolve the pinned "@mainz/cli-node" dependency.');
    }

    const match = dependency.match(/^npm:@jsr\/mainz__cli-node(@.+)$/);
    if (!match) {
        throw new Error(`Unsupported "@mainz/cli-node" dependency "${dependency}".`);
    }

    if (runtime === "deno") {
        return `jsr:@mainz/mainz${match[1]}`;
    }

    return `npm:@jsr/mainz__mainz${match[1]}`;
}

async function assertNodeProjectConfig(configPath) {
    const source = await readFile(resolve(process.cwd(), configPath), "utf8");
    if (!/\bruntime\s*:\s*["']node["']/.test(source)) {
        throw new Error(
            `Expected "${configPath}" to define runtime "node" before running "mainz app create".`,
        );
    }
}

async function upsertConfigTarget(configPath, targetSource) {
    const absoluteConfigPath = resolve(process.cwd(), configPath);
    const source = await readFile(absoluteConfigPath, "utf8");
    const updated = insertConfigTarget(source, targetSource);
    await writeTextFile(absoluteConfigPath, updated);
}

async function writeTextFile(path, content) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, content, "utf8");
}

function insertConfigTarget(source, targetSource) {
    const targetsArray = findTargetsArray(source);
    const existingBody = source.slice(targetsArray.openIndex + 1, targetsArray.closeIndex);

    if (existingBody.includes(targetNameNeedle(targetSource))) {
        throw new Error(`Target ${targetNameNeedle(targetSource)} already exists in Mainz config.`);
    }

    const beforeClose = source.slice(0, targetsArray.closeIndex).replace(/\s*$/, "");
    const afterClose = source.slice(targetsArray.closeIndex);
    const closeLineStart = source.lastIndexOf("\n", targetsArray.closeIndex) + 1;
    const closeIndent = source.slice(closeLineStart, targetsArray.closeIndex);
    const needsComma = !beforeClose.endsWith("[") && !beforeClose.endsWith(",");
    const separator = beforeClose.endsWith("[") ? "\n" : `${needsComma ? "," : ""}\n`;

    return `${beforeClose}${separator}${targetSource}\n${closeIndent}${afterClose}`;
}

function findTargetsArray(source) {
    const targetsIndex = source.indexOf("targets");
    if (targetsIndex === -1) {
        throw new Error('Could not find "targets" in Mainz config.');
    }

    const openIndex = source.indexOf("[", targetsIndex);
    if (openIndex === -1) {
        throw new Error('Could not find the "targets" array in Mainz config.');
    }

    const closeIndex = findMatchingBracket(source, openIndex, "[", "]");
    return { openIndex, closeIndex };
}

function findMatchingBracket(source, startIndex, open, close) {
    let depth = 0;
    let quote;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
        const char = source[index];

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === "\\") {
                escaped = true;
                continue;
            }

            if (char === quote) {
                quote = undefined;
            }

            continue;
        }

        if (char === '"' || char === "'" || char === "`") {
            quote = char;
            continue;
        }

        if (char === open) {
            depth += 1;
            continue;
        }

        if (char === close) {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    throw new Error(`Could not find matching "${close}" in Mainz config.`);
}

function renderConfigTarget(target) {
    return [
        "        {",
        `            name: ${JSON.stringify(target.name)},`,
        `            rootDir: ${JSON.stringify(target.rootDir)},`,
        `            appFile: ${JSON.stringify(target.appFile)},`,
        `            appId: ${JSON.stringify(target.appId)},`,
        `            outDir: ${JSON.stringify(target.outDir)},`,
        "        },",
    ].join("\n");
}

function targetNameNeedle(targetSource) {
    const match = targetSource.match(/name:\s*("[^"]+")/);
    return match?.[1] ? `name: ${match[1]}` : "target";
}

function normalizeAppName(name) {
    const normalized = name.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(normalized)) {
        throw new Error(
            `Invalid app name "${name}". Use letters, numbers, dashes, or underscores, starting with a letter.`,
        );
    }

    return normalized;
}

function normalizeAppRoot(root) {
    const normalized = root.trim().replaceAll("\\", "/").replace(/\/+$/, "");
    if (!normalized) {
        throw new Error("App root must not be empty.");
    }

    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
        throw new Error("App root must be a relative path.");
    }

    return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function normalizeOutDir(outDir) {
    const normalized = outDir.trim().replaceAll("\\", "/").replace(/\/+$/, "");
    if (!normalized) {
        throw new Error("App outDir must not be empty.");
    }

    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
        throw new Error("App outDir must be a relative path.");
    }

    return normalized.startsWith(".") ? normalized.slice(2) : normalized;
}

function toKebabCase(value) {
    return value.replaceAll("_", "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function printHelp() {
    console.log(
        [
            "Mainz CLI (Node)",
            "",
            "Usage:",
            "  mainz init [--runtime <node|deno>] [--mainz <specifier>]",
            "  mainz app create [<name>|--name <name>] [--type <routed|root>] [--root <path>] [--out-dir <path>] [--navigation <spa|mpa|enhanced-mpa>] [--config <path>]",
            "  mainz dev --target <name> [--host [host]] [--port <port>] [--config <path>]",
            "  mainz <other-command> [...args]",
            "",
            "Notes:",
            "  This package owns the Node-hosted init, app create, and dev flows.",
            "  Other commands are currently delegated to @mainz/cli-node.",
        ].join("\n"),
    );
}

function extractLeadingGlobalOptions(args) {
    const remaining = [...args];
    let runtime;

    while (remaining[0] === "--runtime") {
        const value = readOptionValue("--runtime", remaining[1]);
        if (value !== "node" && value !== "deno") {
            throw new Error(`Unsupported runtime "${value}". Use "node" or "deno".`);
        }

        runtime = value;
        remaining.splice(0, 2);
    }

    return { args: remaining, runtime };
}

function assertSupportedNodeRuntime(runtime) {
    if (!runtime || runtime === "node") {
        return;
    }

    throw new Error(
        `This CLI package only implements this command for runtime "node". Received "${runtime}".`,
    );
}

function renderGeneratedMainzCliSpecifier(mainzSpecifier) {
    const trimmed = mainzSpecifier.trim().replace(/\/+$/, "");
    const jsrMainzMatch = trimmed.match(/^jsr:@mainz\/mainz(@.+)?$/);
    if (jsrMainzMatch) {
        return `jsr:@mainz/cli-deno${jsrMainzMatch[1] ?? ""}`;
    }

    return trimmed;
}

function renderGeneratedMainzSubpathPrefix(mainzSpecifier) {
    const trimmed = mainzSpecifier.trim().replace(/\/+$/, "");
    if (trimmed.startsWith("jsr:@")) {
        return `jsr:/${trimmed.slice("jsr:".length)}/`;
    }

    return `${trimmed}/`;
}

import { spawn } from "node:child_process";
import {
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import process from "node:process";
import { extname, isAbsolute, resolve } from "node:path";
import { loadProjectConfig, resolveRequiredTarget } from "./project-config.js";

const MAINZ_PUBLIC_ENTRYPOINTS = [
    { specifier: "mainz", sourcePath: "mod.ts" },
    { specifier: "mainz/jsx-runtime", sourcePath: "src/jsx-runtime.ts" },
    { specifier: "mainz/jsx-dev-runtime", sourcePath: "src/jsx-dev-runtime.ts" },
    { specifier: "mainz/config", sourcePath: "src/public/config.ts" },
    { specifier: "mainz/i18n", sourcePath: "src/public/i18n.ts" },
    { specifier: "mainz/di", sourcePath: "src/public/di.ts" },
    { specifier: "mainz/http", sourcePath: "src/public/http.ts" },
    { specifier: "mainz/http/testing", sourcePath: "src/public/http-testing.ts" },
    { specifier: "mainz/testing", sourcePath: "src/public/testing.ts" },
];

export async function runDevCommand(args) {
    const options = parseDevOptions(args);
    const plan = await resolveNodeDevServerPlan(options);

    console.log(
        `[mainz] Starting dev server for target "${plan.target.name}" using config ${plan.configPath}`,
    );

    const workspace = await prepareViteWorkspace(
        plan.cwd,
        plan.target.name,
        plan.viteConfigSource,
    );

    try {
        return await runViteDevServer({
            cwd: plan.cwd,
            viteConfigPath: workspace.viteConfigPath,
            host: options.host,
            port: options.port,
        });
    } finally {
        await rm(workspace.directoryPath, { recursive: true, force: true });
    }
}

export async function prepareViteWorkspace(cwd, targetName, viteConfigSource) {
    await removeLegacyViteWorkspaces(cwd);

    const directoryPath = resolve(cwd, "node_modules", ".mainz", "vite");
    await rm(directoryPath, { recursive: true, force: true });
    await mkdir(directoryPath, { recursive: true });

    const viteConfigPath = resolve(directoryPath, `vite.config.${targetName}.generated.mjs`);
    await writeFile(viteConfigPath, viteConfigSource, "utf8");

    return {
        directoryPath,
        viteConfigPath,
    };
}

export async function resolveNodeDevServerPlan(options) {
    const cwd = process.cwd();
    const loadedConfig = await loadProjectConfig(options.configPath);
    if (loadedConfig.config.runtime && loadedConfig.config.runtime !== "node") {
        throw new Error(
            `This CLI package only supports runtime "node". Project runtime is "${loadedConfig.config.runtime}".`,
        );
    }

    const target = resolveRequiredTarget(loadedConfig.config, options.target, "dev");
    const targetMetadata = await resolveTargetDevMetadata(cwd, target);

    return {
        cwd,
        configPath: loadedConfig.path,
        target,
        viteConfigSource: renderGeneratedViteConfigModule({
            root: normalizePathSlashes(resolve(cwd, target.rootDir)),
            outDir: normalizePathSlashes(resolve(cwd, target.outDir)),
            cacheDir: normalizePathSlashes(resolve(cwd, "node_modules", ".vite", "mainz", target.name)),
            appType: targetMetadata.navigationMode === "spa" ? "spa" : "mpa",
            base: "/",
            aliases: [
                ...await resolveFrameworkAliases(cwd),
                ...resolveTargetAliases(cwd, target),
            ],
            define: {
                __MAINZ_RENDER_MODE__: JSON.stringify(targetMetadata.renderMode),
                __MAINZ_NAVIGATION_MODE__: JSON.stringify(targetMetadata.navigationMode),
                __MAINZ_TARGET_NAME__: JSON.stringify(target.name),
                __MAINZ_BASE_PATH__: JSON.stringify("/"),
                __MAINZ_APP_LOCALES__: JSON.stringify([]),
                __MAINZ_DEFAULT_LOCALE__: JSON.stringify(undefined),
                __MAINZ_LOCALE_PREFIX__: JSON.stringify("except-default"),
                __MAINZ_SITE_URL__: JSON.stringify(undefined),
                ...target.vite?.define,
            },
        }),
    };
}

function parseDevOptions(args) {
    const options = {
        target: undefined,
        host: undefined,
        port: undefined,
        configPath: "mainz.config.ts",
    };

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index];

        if (current === "--target") {
            options.target = readOptionValue(current, args[index + 1]);
            index += 1;
            continue;
        }

        if (current === "--host") {
            const nextValue = args[index + 1];
            if (!nextValue || nextValue.startsWith("--")) {
                options.host = true;
                continue;
            }

            options.host = nextValue;
            index += 1;
            continue;
        }

        if (current === "--port") {
            const nextValue = args[index + 1];
            const parsedPort = Number.parseInt(nextValue ?? "", 10);
            if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
                throw new Error(`Invalid --port value "${nextValue ?? ""}".`);
            }

            options.port = parsedPort;
            index += 1;
            continue;
        }

        if (current === "--config") {
            options.configPath = readOptionValue(current, args[index + 1]);
            index += 1;
            continue;
        }

        if (current === "--runtime") {
            const runtime = readOptionValue(current, args[index + 1]);
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

    return options;
}

async function resolveTargetDevMetadata(cwd, target) {
    if (typeof target.rootDir !== "string" || !target.rootDir.trim()) {
        throw new Error(`Target "${target.name}" must define "rootDir" for "mainz dev".`);
    }

    if (typeof target.appFile !== "string" || !target.appFile.trim()) {
        throw new Error(`Target "${target.name}" must define "appFile" for "mainz dev".`);
    }

    if (typeof target.outDir !== "string" || !target.outDir.trim()) {
        throw new Error(`Target "${target.name}" must define "outDir" for "mainz dev".`);
    }

    const absoluteAppFile = resolve(cwd, target.appFile);
    const appSource = await readFile(absoluteAppFile, "utf8");
    const navigationMatch = appSource.match(/\bnavigation\s*:\s*["'](spa|mpa|enhanced-mpa)["']/);

    return {
        navigationMode: navigationMatch?.[1] ?? "spa",
        renderMode: await inferRenderMode(resolve(cwd, target.rootDir)),
    };
}

async function inferRenderMode(rootDir) {
    const srcDir = resolve(rootDir, "src");
    let found = "csr";

    for await (const filePath of walkSourceFiles(srcDir)) {
        const source = await readFile(filePath, "utf8");
        if (source.includes('@RenderMode("ssr")') || source.includes("@RenderMode('ssr')")) {
            return "ssr";
        }

        if (source.includes('@RenderMode("ssg")') || source.includes("@RenderMode('ssg')")) {
            found = "ssg";
        }
    }

    return found;
}

async function* walkSourceFiles(directoryPath) {
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
        const entryPath = resolve(directoryPath, entry.name);
        if (entry.isDirectory()) {
            yield* walkSourceFiles(entryPath);
            continue;
        }

        const extension = extname(entry.name);
        if (extension === ".ts" || extension === ".tsx" || extension === ".js" || extension === ".jsx") {
            yield entryPath;
        }
    }
}

async function removeLegacyViteWorkspaces(cwd) {
    for (const entry of await readdir(cwd, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        if (entry.name === ".mainz-vite" || entry.name.startsWith(".mainz-vite-")) {
            await rm(resolve(cwd, entry.name), { recursive: true, force: true });
        }
    }
}

async function resolveFrameworkAliases(cwd) {
    const aliases = [];

    for (const entrypoint of MAINZ_PUBLIC_ENTRYPOINTS) {
        const replacement = normalizePathSlashes(resolve(cwd, entrypoint.sourcePath));
        if (!await pathExists(replacement)) {
            continue;
        }

        aliases.push({
            find: entrypoint.specifier,
            replacement,
        });
    }

    return aliases.sort((a, b) => b.find.length - a.find.length);
}

function resolveTargetAliases(cwd, target) {
    const alias = target.vite?.alias;
    if (!alias) {
        return [];
    }

    if (Array.isArray(alias)) {
        return alias.map((entry) => ({
            find: entry.find,
            replacement: normalizeAliasReplacement(cwd, entry.replacement),
        }));
    }

    return Object.entries(alias).map(([find, replacement]) => ({
        find,
        replacement: normalizeAliasReplacement(cwd, replacement),
    }));
}

async function pathExists(path) {
    try {
        await readFile(path);
        return true;
    } catch {
        return false;
    }
}

function normalizeAliasReplacement(cwd, replacement) {
    if (
        replacement.startsWith(".") || replacement.startsWith("/") ||
        replacement.startsWith("\\") || isAbsolute(replacement)
    ) {
        return normalizePathSlashes(resolve(cwd, replacement));
    }

    return replacement;
}

function renderGeneratedViteConfigModule(config) {
    const aliases = config.aliases.map((alias) =>
        `{ find: ${JSON.stringify(alias.find)}, replacement: ${JSON.stringify(alias.replacement)} }`
    );

    return [
        `import { defineConfig } from "vite";`,
        ``,
        `export default defineConfig({`,
        `    appType: ${JSON.stringify(config.appType)},`,
        `    base: ${JSON.stringify(config.base)},`,
        `    cacheDir: ${JSON.stringify(config.cacheDir)},`,
        `    resolve: {`,
        `        alias: [`,
        ...aliases.map((alias) => `            ${alias},`),
        `        ],`,
        `    },`,
        `    root: ${JSON.stringify(config.root)},`,
        `    build: {`,
        `        outDir: ${JSON.stringify(config.outDir)},`,
        `        emptyOutDir: true,`,
        `        sourcemap: true,`,
        `    },`,
        `    define: ${renderObjectLiteral(config.define, 4)},`,
        `    esbuild: {`,
        `        keepNames: true,`,
        `        jsx: "automatic",`,
        `        jsxImportSource: "mainz",`,
        `    },`,
        `});`,
        ``,
    ].join("\n");
}

function renderObjectLiteral(record, indent) {
    const entries = Object.entries(record);
    if (entries.length === 0) {
        return "{}";
    }

    const padding = " ".repeat(indent);
    const entryPadding = " ".repeat(indent + 4);

    return [
        `{`,
        ...entries.map(([key, value]) => `${entryPadding}${JSON.stringify(key)}: ${JSON.stringify(value)},`),
        `${padding}}`,
    ].join("\n");
}

async function runViteDevServer(options) {
    const viteArgs = [
        "vite",
        "--config",
        options.viteConfigPath,
    ];

    if (options.host !== undefined) {
        viteArgs.push("--host");
        if (options.host !== true) {
            viteArgs.push(options.host);
        }
    }

    if (options.port !== undefined) {
        viteArgs.push("--port", String(options.port));
    }

    const invocation = resolveViteDevInvocation(viteArgs);

    const exitCode = await new Promise((resolvePromise, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            cwd: options.cwd,
            stdio: "inherit",
            env: process.env,
        });

        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (signal) {
                resolvePromise(1);
                return;
            }

            resolvePromise(code ?? 1);
        });
    });

    return exitCode;
}

export function resolveViteDevInvocation(viteArgs) {
    if (process.platform === "win32") {
        const command = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
        return {
            command,
            args: ["/d", "/s", "/c", "npx", ...viteArgs],
        };
    }

    return {
        command: "npx",
        args: viteArgs,
    };
}

function readOptionValue(option, value) {
    if (!value?.trim()) {
        throw new Error(`Option "${option}" requires a value.`);
    }

    return value;
}

function normalizePathSlashes(path) {
    return path.replaceAll("\\", "/");
}

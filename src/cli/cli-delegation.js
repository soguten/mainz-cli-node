import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import process from "node:process";
import { delimiter, join, resolve } from "node:path";

export async function delegateToCli(cli, args, helpTopic = "main") {
    const candidates = resolveCliDelegationCandidates(cli, args);

    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (
            candidate.requiresPathLookup &&
            !(await canResolveExecutable(candidate.command))
        ) {
            continue;
        }

        try {
            return await runDelegatedCli(candidate.command, candidate.args);
        } catch (error) {
            if (error?.code === "ENOENT" && index < candidates.length - 1) {
                continue;
            }

            if (error?.code === "ENOENT") {
                throw createDelegationError(
                    `Could not execute a ${cli}-hosted Mainz CLI. Install the required ${cli} runtime or install the ${cli}-hosted Mainz CLI globally.`,
                    helpTopic,
                );
            }

            throw error;
        }
    }

    throw createDelegationError(
        `Could not resolve a ${cli}-hosted Mainz CLI delegation target.`,
        helpTopic,
    );
}

export async function delegateToDenoProject(cwd, args, helpTopic = "dev") {
    const invocation = await resolveDenoProjectCliInvocation(cwd, args);

    try {
        return await runDelegatedCliInCwd(invocation.command, invocation.args, cwd);
    } catch (error) {
        if (error?.code === "ENOENT") {
            throw createDelegationError(
                'Could not execute the Deno runtime required by this Mainz project. Install "deno" to run Deno-runtime commands from @mainzjs/cli-node.',
                helpTopic,
            );
        }

        throw error;
    }
}

function resolveCliDelegationCandidates(cli, args) {
    const explicit = {
        command: `mainz-cli-${cli}`,
        args,
        requiresPathLookup: true,
    };

    if (cli === "deno") {
        return [
            explicit,
            {
                command: "deno",
                args: ["run", "-A", "jsr:@mainz/cli-deno@alpha", ...args],
            },
        ];
    }

    if (cli === "bun") {
        return [
            explicit,
            {
                command: "bunx",
                args: ["@mainzjs/cli-bun@alpha", ...args],
            },
        ];
    }

    return [
        explicit,
        {
            command: "npx",
            args: ["-y", "@mainzjs/cli-node@alpha", ...args],
        },
    ];
}

async function canResolveExecutable(command) {
    const pathValue = process.env.PATH ?? "";
    const extensions =
        process.platform === "win32"
            ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
                .split(";")
                .filter(Boolean)
            : [""];
    const commandHasExtension = /\.[^\\/]+$/.test(command);

    for (const directory of pathValue.split(delimiter).filter(Boolean)) {
        const names =
            process.platform === "win32" && !commandHasExtension
                ? extensions.map((extension) => `${command}${extension.toLowerCase()}`)
                : [command];

        for (const name of names) {
            try {
                await access(join(directory, name));
                return true;
            } catch (error) {
                if (error?.code !== "ENOENT") {
                    throw error;
                }
            }
        }
    }

    return false;
}

async function runDelegatedCli(command, args) {
    return await runDelegatedCliInCwd(command, args, process.cwd());
}

async function runDelegatedCliInCwd(command, args, cwd) {
    const invocation = resolveCliInvocation(command, args);

    return await new Promise((resolvePromise, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            cwd,
            stdio: "inherit",
        });

        child.once("error", reject);
        child.once("exit", (code) => resolvePromise(code ?? 1));
    });
}

async function resolveDenoProjectCliInvocation(cwd, args) {
    const denoConfigPath = resolve(cwd, "deno.json");
    const source = await readFile(denoConfigPath, "utf8");
    const denoConfig = JSON.parse(source);

    if (!denoConfig || typeof denoConfig !== "object" || Array.isArray(denoConfig)) {
        throw createDelegationError(
            `Expected "${denoConfigPath}" to contain a JSON object.`,
            "dev",
        );
    }

    const explicitConfig = resolveDenoProjectCliConfig(denoConfig);
    if (explicitConfig) {
        return {
            command: "deno",
            args: [
                "run",
                "-A",
                "--config",
                explicitConfig.configPath,
                explicitConfig.cliSpecifier,
                ...args,
            ],
        };
    }

    const legacyConfig = resolveLegacyDenoProjectCliConfig(denoConfig);
    if (legacyConfig) {
        return {
            command: "deno",
            args: [
                "run",
                "-A",
                "--config",
                legacyConfig.configPath,
                legacyConfig.cliSpecifier,
                ...args,
            ],
        };
    }

    throw createDelegationError(
        `Could not resolve the Deno Mainz CLI specifier from "${denoConfigPath}". Expected mainz.cliSpecifier metadata or a generated Mainz task entry.`,
        "dev",
    );
}

function resolveDenoProjectCliConfig(denoConfig) {
    const mainz = denoConfig.mainz;
    if (!mainz || typeof mainz !== "object" || Array.isArray(mainz)) {
        return undefined;
    }

    if (typeof mainz.cliSpecifier !== "string" || !mainz.cliSpecifier.trim()) {
        return undefined;
    }

    return {
        cliSpecifier: mainz.cliSpecifier.trim(),
        configPath: typeof mainz.configPath === "string" && mainz.configPath.trim()
            ? mainz.configPath.trim()
            : "deno.json",
    };
}

function resolveLegacyDenoProjectCliConfig(denoConfig) {
    const tasks = denoConfig.tasks;
    if (!tasks || typeof tasks !== "object" || Array.isArray(tasks)) {
        return undefined;
    }

    for (const taskName of ["dev", "build", "preview", "test", "publish-info", "diagnose"]) {
        const task = tasks[taskName];
        if (typeof task !== "string") {
            continue;
        }

        const match = task.match(
            /^deno\s+run\s+-A(?:\s+--config\s+(\S+))?\s+(\S+)\s+(?:dev|build|preview|test|publish-info|diagnose)\b/,
        );
        if (!match) {
            continue;
        }

        return {
            configPath: match[1] ?? "deno.json",
            cliSpecifier: match[2],
        };
    }

    return undefined;
}

function resolveCliInvocation(executable, args) {
    if (process.platform !== "win32") {
        return { command: executable, args };
    }

    return {
        command: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", executable, ...args],
    };
}

function createDelegationError(message, helpTopic) {
    const error = new Error(message);
    error.name = "CliUsageError";
    error.helpTopic = helpTopic;
    return error;
}

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import process from "node:process";
import { delimiter, join } from "node:path";

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
    const invocation = resolveCliInvocation(command, args);

    return await new Promise((resolvePromise, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            cwd: process.cwd(),
            stdio: "inherit",
        });

        child.once("error", reject);
        child.once("exit", (code) => resolvePromise(code ?? 1));
    });
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

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadProjectConfig(configPath = "mainz.config.ts") {
    const absoluteConfigPath = resolve(process.cwd(), configPath);
    const source = await readFile(absoluteConfigPath, "utf8");
    const literal = extractDefineMainzConfigLiteral(source);

    let config;
    try {
        config = Function(`return (${literal});`)();
    } catch (error) {
        throw new Error(
            `Could not evaluate Mainz config at "${absoluteConfigPath}". Keep Node projects using an object-literal defineMainzConfig(...) export.`,
            { cause: error },
        );
    }

    if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error(`Mainz config at "${absoluteConfigPath}" did not evaluate to an object.`);
    }

    const targets = Array.isArray(config.targets) ? config.targets : [];

    return {
        path: absoluteConfigPath,
        source,
        config: {
            ...config,
            targets,
        },
    };
}

export function resolveRequiredTarget(config, targetName, command) {
    const normalizedTargetName = targetName?.trim();
    if (!normalizedTargetName || normalizedTargetName === "all") {
        throw new Error(`Command "${command}" requires a single --target <name>.`);
    }

    const target = config.targets.find((entry) => entry?.name === normalizedTargetName);
    if (!target) {
        throw new Error(
            `No targets matched "${normalizedTargetName}". Available targets: ${
                config.targets.map((entry) => entry?.name).filter(Boolean).join(", ")
            }`,
        );
    }

    return target;
}

function extractDefineMainzConfigLiteral(source) {
    const callIndex = source.indexOf("defineMainzConfig(");
    if (callIndex === -1) {
        throw new Error('Could not find "defineMainzConfig(" in Mainz config.');
    }

    const openIndex = source.indexOf("(", callIndex);
    if (openIndex === -1) {
        throw new Error('Could not find the "defineMainzConfig(" argument list.');
    }

    const closeIndex = findMatchingDelimiter(source, openIndex, "(", ")");
    return source.slice(openIndex + 1, closeIndex).trim();
}

function findMatchingDelimiter(source, startIndex, open, close) {
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

import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { basename, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDevCommand } from "./dev.js";
import { materializeTemplate } from "../templates/index.js";
import { resolveBuiltInTemplateRoot } from "../templates/load-template.js";

class CliUsageError extends Error {
    constructor(message, helpTopic = "main") {
        super(message);
        this.name = "CliUsageError";
        this.helpTopic = helpTopic;
    }
}

export async function main(args = process.argv.slice(2)) {
  try {
    return await runCli(args);
  } catch (error) {
    if (error instanceof Error) {
      printSoftError(
        error.message,
        error instanceof CliUsageError ? error.helpTopic : "main",
      );
      return 1;
    }

    throw error;
  }
}

async function runCli(args) {
  const { args: commandArgs, cli: leadingCli } =
    extractLeadingGlobalOptions(args);

  if (leadingCli && leadingCli !== "node") {
    return await delegateToCli(leadingCli, commandArgs);
  }

  const helpTopic = resolveHelpTopic(commandArgs);
  if (helpTopic) {
    printHelp(helpTopic);
    return 0;
  }

  const command = commandArgs[0];
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    printHelp();
    return 0;
  }

  if (command === "init") {
    await runInitCommand(commandArgs.slice(1));
    return 0;
  }

  if (command === "app") {
    await runAppCommand(commandArgs.slice(1));
    return 0;
  }

  if (command === "dev") {
    return await runDevCommand(commandArgs.slice(1));
  }

  if (command.startsWith("--")) {
    throw new CliUsageError(`Unknown command "${command}".`, "main");
  }

  throw new CliUsageError(
    `Command "${command}" is not implemented in @mainzjs/cli-node yet. ` +
    `This package currently supports "init", "app create", and "dev".`,
    "main",
  );
}

async function delegateToCli(cli, args) {
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
        throw new CliUsageError(
          `Could not execute a ${cli}-hosted Mainz CLI. Install the required ${cli} runtime or install the ${cli}-hosted Mainz CLI globally.`,
          "main",
        );
      }

      throw error;
    }
  }

  throw new CliUsageError(
    `Could not resolve a ${cli}-hosted Mainz CLI delegation target.`,
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

async function runInitCommand(args) {
  const options = parseInitOptions(args);
  const projectName = basename(process.cwd()) || "mainz-app";
  const runtime = options.runtime ?? "node";
  const templateRoot = resolveBuiltInTemplateRoot(
    "project",
    runtime === "deno" ? "empty-deno" : "empty-node",
  );
  const mainzSpecifier =
    options.mainzSpecifier ?? (await resolveDefaultMainzSpecifier(runtime));
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
  console.log(
    `[mainz] Created ${plan.files.map((file) => file.path).join(", ")}.`,
  );
  console.log('[mainz] Add an app with "mainz app create <name>".');
}

async function assertCanCreateFile(path) {
  try {
    await access(path);
    throw new CliUsageError(`Refusing to overwrite existing file "${path}".`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
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

  if (!action) {
    throw new CliUsageError('Command "app" requires a subcommand.', "app");
  }

  throw new CliUsageError(
    `Command "app ${action}" is not implemented in @mainzjs/cli-node yet. ` +
    `This package currently supports "app create" only.`,
    "app",
  );
}

async function runAppCreateCommand(args) {
  const options = parseAppCreateOptions(args);
  await assertNodeProjectConfig(options.configPath);

  const appName = normalizeAppName(options.name);
  const rootDir = normalizeAppRoot(options.root ?? `./${appName}`);
  const outDir = normalizeOutDir(options.outDir ?? `dist/${appName}`);
  const rootPath = resolve(process.cwd(), rootDir);
  const templateRoot = resolveBuiltInTemplateRoot("app", options.type);

  const plan = await materializeTemplate({
    templateRoot,
    outputDir: rootPath,
    params: {
      appName,
      appId: appName,
      appNavigation: options.navigation,
      appTitle: appName,
      customElementPrefix: `x-mainz-${toKebabCase(appName)}`,
      rootDir,
      outDir,
    },
    beforeWrite: assertCanCreateFile,
  });
  const target = resolveTemplateTarget(plan.manifest);

  await upsertConfigTarget(options.configPath, renderConfigTarget(target));

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
      options.mainzSpecifier = readOptionValue(
        current,
        args[index + 1],
        "init",
      );
      index += 1;
      continue;
    }

    if (current === "--runtime") {
      const runtime = readOptionValue(current, args[index + 1], "init");
      if (runtime !== "node" && runtime !== "deno") {
        throw new CliUsageError(
          `Unsupported runtime "${runtime}". Use "node" or "deno".`,
          "init",
        );
      }

      options.runtime = runtime;
      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown option "${current}".`, "init");
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
      options.name = readOptionValue(
        current,
        remaining[index + 1],
        "app-create",
      );
      index += 1;
      continue;
    }

    if (current === "--type") {
      const type = readOptionValue(current, remaining[index + 1], "app-create");
      if (type !== "routed" && type !== "root") {
        throw new CliUsageError(
          `Unsupported app type "${type}". Use "routed" or "root".`,
          "app-create",
        );
      }

      options.type = type;
      index += 1;
      continue;
    }

    if (current === "--root") {
      options.root = readOptionValue(
        current,
        remaining[index + 1],
        "app-create",
      );
      index += 1;
      continue;
    }

    if (current === "--out-dir") {
      options.outDir = readOptionValue(
        current,
        remaining[index + 1],
        "app-create",
      );
      index += 1;
      continue;
    }

    if (current === "--navigation") {
      const navigation = readOptionValue(
        current,
        remaining[index + 1],
        "app-create",
      );
      if (
        navigation !== "spa" &&
        navigation !== "mpa" &&
        navigation !== "enhanced-mpa"
      ) {
        throw new CliUsageError(
          `Unsupported app navigation "${navigation}". Use "spa", "mpa", or "enhanced-mpa".`,
          "app-create",
        );
      }

      options.navigation = navigation;
      index += 1;
      continue;
    }

    if (current === "--config") {
      options.configPath = readOptionValue(
        current,
        remaining[index + 1],
        "app-create",
      );
      index += 1;
      continue;
    }

    if (current === "--runtime") {
      const runtime = readOptionValue(
        current,
        remaining[index + 1],
        "app-create",
      );
      if (runtime !== "node") {
        throw new CliUsageError(
          `This CLI package only supports runtime "node". Received "${runtime}".`,
          "app-create",
        );
      }

      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown option "${current}".`, "app-create");
  }

  if (!options.name?.trim()) {
    throw new CliUsageError(
      'Command "app create" requires a name.',
      "app-create",
    );
  }

  return options;
}

function readOptionValue(option, value, helpTopic = "main") {
  if (!value?.trim()) {
    throw new CliUsageError(`Option "${option}" requires a value.`, helpTopic);
  }

  return value;
}

async function resolveDefaultMainzSpecifier(runtime = "node") {
  const packageJsonPath = resolve(
    fileURLToPath(new URL("../../package.json", import.meta.url)),
  );
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const version = packageJson.version;
  if (typeof version !== "string" || !version.trim()) {
    throw new Error(
      'Could not resolve the current "@mainzjs/cli-node" package version.',
    );
  }

  if (runtime === "deno") {
    return `jsr:@mainz/mainz@${version}`;
  }

  return `npm:@jsr/mainz__mainz@${version}`;
}

async function assertNodeProjectConfig(configPath) {
  const source = await readFile(resolve(process.cwd(), configPath), "utf8");
  if (!/\bruntime\s*:\s*["']node["']/.test(source)) {
    throw new CliUsageError(
      `Expected "${configPath}" to define runtime "node" before running "mainz app create".`,
      "app-create",
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
  const existingBody = source.slice(
    targetsArray.openIndex + 1,
    targetsArray.closeIndex,
  );

  if (existingBody.includes(targetNameNeedle(targetSource))) {
    throw new CliUsageError(
      `Target ${targetNameNeedle(
        targetSource,
      )} already exists in Mainz config.`,
      "app-create",
    );
  }

  const beforeClose = source
    .slice(0, targetsArray.closeIndex)
    .replace(/\s*$/, "");
  const afterClose = source.slice(targetsArray.closeIndex);
  const closeLineStart = source.lastIndexOf("\n", targetsArray.closeIndex) + 1;
  const closeIndent = source.slice(closeLineStart, targetsArray.closeIndex);
  const needsComma = !beforeClose.endsWith("[") && !beforeClose.endsWith(",");
  const separator = beforeClose.endsWith("[")
    ? "\n"
    : `${needsComma ? "," : ""}\n`;

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

function resolveTemplateTarget(manifest) {
  const target = manifest?.target;
  if (!target || typeof target !== "object") {
    throw new Error(
      `Template "${manifest?.name ?? "unknown"}" must define a target.`,
    );
  }

  for (const key of ["name", "rootDir", "appFile", "appId", "outDir"]) {
    if (typeof target[key] !== "string" || !target[key].trim()) {
      throw new Error(
        `Template "${manifest?.name ?? "unknown"}" target is missing "${key}".`,
      );
    }
  }

  return target;
}

function targetNameNeedle(targetSource) {
  const match = targetSource.match(/name:\s*("[^"]+")/);
  return match?.[1] ? `name: ${match[1]}` : "target";
}

function normalizeAppName(name) {
  const normalized = name.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(normalized)) {
    throw new CliUsageError(
      `Invalid app name "${name}". Use letters, numbers, dashes, or underscores, starting with a letter.`,
      "app-create",
    );
  }

  return normalized;
}

function normalizeAppRoot(root) {
  const normalized = root.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized) {
    throw new CliUsageError("App root must not be empty.", "app-create");
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
    throw new CliUsageError("App root must be a relative path.", "app-create");
  }

  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function normalizeOutDir(outDir) {
  const normalized = outDir.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized) {
    throw new CliUsageError("App outDir must not be empty.", "app-create");
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
    throw new CliUsageError(
      "App outDir must be a relative path.",
      "app-create",
    );
  }

  return normalized.startsWith(".") ? normalized.slice(2) : normalized;
}

function toKebabCase(value) {
  return value
    .replaceAll("_", "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function printHelp(topic = "main") {
  console.log(getHelpText(topic));
}

function extractLeadingGlobalOptions(args) {
  const remaining = [...args];
  let cli;

  while (remaining[0] === "--cli") {
    const option = remaining[0];
    const value = readOptionValue(option, remaining[1], "main");

    if (value !== "node" && value !== "deno" && value !== "bun") {
      throw new CliUsageError(
        `Unsupported CLI "${value}". Use "node", "deno", or "bun".`,
        "main",
      );
    }

    cli = value;
    remaining.splice(0, 2);
  }

  return { args: remaining, cli };
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

function resolveHelpTopic(args) {
  const hasHelp =
    args.includes("--help") || args.includes("-h") || args.includes("help");
  if (!hasHelp) {
    return undefined;
  }

  const filtered = args.filter(
    (arg) => arg !== "--help" && arg !== "-h" && arg !== "help",
  );
  const [command, subcommand] = filtered;

  if (command === "init") {
    return "init";
  }

  if (command === "app" && subcommand === "create") {
    return "app-create";
  }

  if (command === "app") {
    return "app";
  }

  if (command === "dev") {
    return "dev";
  }

  return "main";
}

function printSoftError(message, helpTopic = "main") {
  console.error(`[mainz] ${message}`);
  console.error(
    `[mainz] Run "mainz ${renderHelpCommand(helpTopic)}" for usage.`,
  );
}

function renderHelpCommand(helpTopic) {
  if (helpTopic === "main") {
    return "--help";
  }

  if (helpTopic === "app-create") {
    return "app create --help";
  }

  return `${helpTopic} --help`;
}

function getHelpText(topic) {
  if (topic === "init") {
    return [
      "Mainz CLI (Node) - init",
      "",
      "Usage:",
      "  mainz init [--runtime <node|deno>] [--mainz <specifier>]",
      "",
      "Options:",
      "  --runtime <node|deno>  Choose the runtime of the generated project.",
      "  --mainz <specifier>     Override the Mainz package specifier written to the project.",
      "",
      "Notes:",
      "  This command runs in the Node-hosted CLI, but it can still generate a Deno project.",
      "  Use --cli before the command only when delegating to another installed Mainz CLI host.",
    ].join("\n");
  }

  if (topic === "app") {
    return [
      "Mainz CLI (Node) - app",
      "",
      "Usage:",
      "  mainz app create [<name>|--name <name>] [--type <routed|root>] [--root <path>] [--out-dir <path>] [--navigation <spa|mpa|enhanced-mpa>] [--config <path>]",
    ].join("\n");
  }

  if (topic === "app-create") {
    return [
      "Mainz CLI (Node) - app create",
      "",
      "Usage:",
      "  mainz app create [<name>|--name <name>] [--type <routed|root>] [--root <path>] [--out-dir <path>] [--navigation <spa|mpa|enhanced-mpa>] [--config <path>]",
      "",
      "Options:",
      "  --name <name>                  App name when not using the positional form.",
      "  --type <routed|root>           Choose the app template kind.",
      "  --root <path>                  Relative root directory for the app files.",
      "  --out-dir <path>               Relative output directory for the target.",
      "  --navigation <spa|mpa|enhanced-mpa>",
      "                                 Navigation mode for routed apps.",
      "  --config <path>                Mainz config path. Defaults to mainz.config.ts.",
    ].join("\n");
  }

  if (topic === "dev") {
    return [
      "Mainz CLI (Node) - dev",
      "",
      "Usage:",
      "  mainz dev --target <name> [--host [host]] [--port <port>] [--config <path>]",
      "",
      "Options:",
      "  --target <name>  Target to run in dev mode.",
      "  --host [host]    Expose the dev server host. When omitted, Vite uses its default.",
      "  --port <port>    Override the dev server port.",
      "  --config <path>  Mainz config path. Defaults to mainz.config.ts.",
    ].join("\n");
  }

  return [
    "Mainz CLI (Node)",
    "",
    "Usage:",
    "  mainz init [--runtime <node|deno>] [--mainz <specifier>]",
    "  mainz app create [<name>|--name <name>] [--type <routed|root>] [--root <path>] [--out-dir <path>] [--navigation <spa|mpa|enhanced-mpa>] [--config <path>]",
    "  mainz dev --target <name> [--host [host]] [--port <port>] [--config <path>]",
    "",
    "Global options:",
    "  --cli <node|deno|bun>  Selects which installed Mainz CLI host should execute the command.",
    "",
    "Command options:",
    "  --runtime <node|deno>  Choose the runtime of the generated project.",
    "",
    "Notes:",
    "  This package owns the Node-hosted init, app create, and dev flows.",
    '  Use "mainz init --runtime deno" to generate a Deno project from the Node CLI.',
  ].join("\n");
}

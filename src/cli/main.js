import { access, readdir, readFile, rm } from "node:fs/promises";
import process from "node:process";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { delegateToCli } from "./cli-delegation.js";
import {
  renderGeneratedMainzCliSpecifier,
  resolveDefaultMainzSpecifierForRuntime,
  resolveHostedCliPackageSpecifier,
} from "./package-specifiers.js";
import { runDevCommand } from "./dev.js";
import {
  instantiateTemplate,
  materializeTemplatePlan,
} from "../templates/index.js";
import { resolveBuiltInTemplateRoot } from "../templates/load-template.js";
import { loadProjectConfig, resolveRequiredTarget } from "./project-config.js";

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

  if (command === "profile") {
    await runProfileCommand(commandArgs.slice(1));
    return 0;
  }

  if (command === "workflow") {
    await runWorkflowCommand(commandArgs.slice(1));
    return 0;
  }

  if (command.startsWith("--")) {
    throw new CliUsageError(`Unknown command "${command}".`, "main");
  }

  throw new CliUsageError(
    `Command "${command}" is not implemented in @mainzjs/cli-node yet. ` +
    `This package currently supports "init", "app", "profile", "workflow", and "dev".`,
    "main",
  );
}

async function runInitCommand(args) {
  const options = parseInitOptions(args);
  const outputDir = options.name ? resolve(process.cwd(), options.name) : process.cwd();
  const projectName = basename(outputDir) || "mainz-app";
  const runtime = options.runtime ?? "node";
  const templateName = options.template ?? "empty";
  const templateSource = await resolveInitProjectTemplateSource(templateName, runtime);
  const mainzSpecifier =
    options.mainzSpecifier ?? (await resolveDefaultMainzSpecifierForRuntime(runtime));
  const templateParams = {
    mainzSpecifier,
    projectName,
    denoConfigPath: "deno.json",
    mainzCliSpecifier: renderGeneratedMainzCliSpecifier(mainzSpecifier),
    mainzSubpathPrefix: renderGeneratedMainzSubpathPrefix(mainzSpecifier),
    appName: "app",
    appId: "app",
    appNavigation: "enhanced-mpa",
    appTitle: projectName,
    customElementPrefix: `x-mainz-${toKebabCase(projectName)}`,
    rootDir: "./app",
    outDir: "dist/app",
  };
  const plan = await instantiateTemplate({
    ...templateSource,
    params: templateParams,
  });
  validateTemplateRuntimeCompatibility(plan.manifest, runtime, templateName);

  await materializeTemplatePlan({
    plan,
    outputDir,
    beforeWrite: assertCanCreateFile,
  });

  console.log(
    `[mainz] Initialized Mainz ${
      templateName === "starter" ? "starter project" : "project"
    } in ${outputDir}.`,
  );
  console.log(
    `[mainz] Created ${plan.files.map((file) => file.path).join(", ")}.`,
  );
  if (templateName === "starter") {
    console.log('[mainz] Run "mainz dev --target app" to start the app.');
  } else {
    console.log('[mainz] Add an app with "mainz app create <name>".');
  }
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

  if (action === "remove") {
    await runAppRemoveCommand(rest);
    return;
  }

  if (action === "list") {
    await runAppListCommand(rest);
    return;
  }

  if (action === "info") {
    await runAppInfoCommand(rest);
    return;
  }

  if (!action) {
    throw new CliUsageError('Command "app" requires a subcommand.', "app");
  }

  throw new CliUsageError(`Unknown app subcommand "${action}".`, "app");
}

async function runAppCreateCommand(args) {
  const options = parseAppCreateOptions(args);
  const projectRuntime = await assertSupportedProjectConfig(options.configPath);

  const appName = normalizeAppName(options.name);
  const rootDir = normalizeAppRoot(options.root ?? `./${appName}`);
  const outDir = normalizeOutDir(options.outDir ?? `dist/${appName}`);
  const rootPath = resolve(process.cwd(), rootDir);
  const templateName = options.template ??
    resolveDefaultAppTemplateName(options.type ?? "routed");
  const templateSource = await resolveAppTemplateSource(templateName);
  const templateParams = {
    appName,
    appId: appName,
    appNavigation: options.navigation,
    appTitle: appName,
    customElementPrefix: `x-mainz-${toKebabCase(appName)}`,
    rootDir,
    outDir,
  };
  const plan = await instantiateTemplate({
    ...templateSource,
    params: templateParams,
  });
  validateTemplateRuntimeCompatibility(plan.manifest, projectRuntime, templateName);
  const dependencyUpdates = await prepareAppTemplateWorkspaceUpdates(
    plan.manifest,
    projectRuntime,
    appName,
    rootDir,
  );

  await materializeTemplatePlan({
    plan,
    outputDir: rootPath,
    beforeWrite: assertCanCreateFile,
  });
  const target = resolveTemplateTarget(plan.manifest);

  for (const update of dependencyUpdates) {
    await writeTextFile(update.path, update.content);
  }

  await upsertConfigTarget(options.configPath, renderConfigTarget(target));

  console.log(`[mainz] Created app "${appName}" in ${rootDir}.`);
}

async function runAppRemoveCommand(args) {
  const options = parseAppRemoveOptions(args);
  const appName = normalizeAppName(options.name);
  const absoluteConfigPath = resolve(process.cwd(), options.configPath);
  const source = await readFile(absoluteConfigPath, "utf8");
  const targetSource = findConfigTargetSource(source, appName);
  const updated = removeConfigTarget(source, appName);
  const rootDir = targetSource ? extractTargetRootDir(targetSource) : undefined;

  if (updated === source) {
    throw new CliUsageError(
      `No target named "${appName}" found in ${options.configPath}.`,
      "app-remove",
    );
  }

  if (options.deleteFiles) {
    if (!rootDir) {
      throw new CliUsageError(
        `Could not resolve the app root for "${appName}" in ${options.configPath}.`,
        "app-remove",
      );
    }

    await removeAppRoot(rootDir);
  }

  const projectRuntime = await resolveProjectRuntimeForWorkspaceUpdate(options.configPath);
  const workspaceUpdate = rootDir
    ? await prepareRemoveAppWorkspaceUpdate(projectRuntime, rootDir)
    : undefined;
  if (workspaceUpdate) {
    await writeTextFile(workspaceUpdate.path, workspaceUpdate.content);
  }

  await writeTextFile(absoluteConfigPath, updated);

  console.log(`[mainz] Removed app target "${appName}" from ${options.configPath}.`);
  if (options.deleteFiles) {
    console.log(`[mainz] Deleted app files for "${appName}".`);
  }
}

async function runAppListCommand(args) {
  const options = parseAppSharedOptions(args, "app-list");
  const loaded = await loadProjectConfig(options.configPath);
  const entries = loaded.config.targets.map((target) => ({
    target: target.name ?? "",
    appId: target.appId ?? null,
    rootDir: target.rootDir ?? null,
    appFile: target.appFile ?? null,
    outDir: target.outDir ?? null,
  }));

  console.log(JSON.stringify(entries, null, 2));
}

async function runAppInfoCommand(args) {
  const options = parseAppInfoOptions(args);
  const loaded = await loadProjectConfig(options.configPath);
  const target = loaded.config.targets.find((entry) => entry?.name === options.name);
  if (!target) {
    throw new CliUsageError(
      `No target named "${options.name}" found in ${options.configPath}.`,
      "app-info",
    );
  }

  console.log(JSON.stringify({
    target: target.name ?? options.name,
    appId: target.appId ?? null,
    rootDir: target.rootDir ?? null,
    appFile: target.appFile ?? null,
    outDir: target.outDir ?? null,
    vite: target.viteConfig ? {
      source: "explicit",
      configPath: target.viteConfig,
    } : {
      source: "generated",
      configPath: null,
    },
    build: {
      configPath: target.buildConfig ?? null,
    },
  }, null, 2));
}

async function runProfileCommand(args) {
  const options = parseProfileCreateOptions(args);
  const loaded = await loadProjectConfig(options.configPath);
  const target = resolveRequiredTarget(
    loaded.config,
    options.target,
    "profile create",
  );
  const buildConfigPath = resolveTargetBuildConfigFile(target);
  const profileSource = renderBuildProfileProperty(options.name, {
    basePath: options.basePath ?? inferDefaultProfileBasePath(target.name),
    siteUrl: options.siteUrl,
  });

  try {
    const source = await readFile(buildConfigPath, "utf8");
    await writeTextFile(
      buildConfigPath,
      upsertBuildProfile(source, options.name, profileSource),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }

    await writeTextFile(buildConfigPath, renderGeneratedBuildConfig(profileSource));
  }

  console.log(
    `[mainz] Updated profile "${options.name}" for target "${target.name}" in ${normalizePathSlashes(relative(process.cwd(), buildConfigPath) || buildConfigPath)}.`,
  );
}

async function runWorkflowCommand(args) {
  const options = parseWorkflowOptions(args);
  const loaded = await loadProjectConfig(options.configPath);
  const runtime = loaded.config.runtime ?? "node";

  if (runtime !== "deno") {
    throw new CliUsageError(
      'Workflow generation from @mainzjs/cli-node currently requires a project with runtime "deno".',
      options.action === "create" ? "workflow-create" : "workflow-update",
    );
  }

  const workflowPath = resolve(
    process.cwd(),
    ".github",
    "workflows",
    "deploy-github-pages.yml",
  );
  const workflowTemplateRoot = resolveBuiltInTemplateRoot("workflow", "gh-pages");
  const publishTargets = await resolveGithubPagesWorkflowTargets(loaded.config);

  if (publishTargets.length === 0) {
    throw new CliUsageError(
      'No targets define a "gh-pages" profile.',
      options.action === "create" ? "workflow-create" : "workflow-update",
    );
  }

  if (options.action === "create") {
    await assertCanCreateFile(workflowPath);
  } else {
    await assertPathExists(workflowPath, "workflow-update");
  }

  const plan = await instantiateTemplate({
    templateRoot: workflowTemplateRoot,
    params: await renderGithubPagesWorkflowTemplateParams({
      branch: options.branch ?? "main",
      trigger: options.trigger ?? "push",
      targets: publishTargets,
    }),
  });

  for (const file of plan.files) {
    await writeTextFile(resolve(process.cwd(), file.path), file.content);
  }

  console.log(`[mainz] Wrote GitHub Pages workflow to ${workflowPath}.`);
}

function parseInitOptions(args) {
  const options = {
    name: undefined,
    mainzSpecifier: undefined,
    runtime: undefined,
    template: undefined,
  };
  let positionalName;

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

    if (current === "--template") {
      options.template = normalizeTemplateName(
        readOptionValue(current, args[index + 1], "init"),
      );
      index += 1;
      continue;
    }

    if (current === "--runtime") {
      const runtime = readOptionValue(current, args[index + 1], "init");
      if (runtime !== "node" && runtime !== "deno" && runtime !== "bun") {
        throw new CliUsageError(
          `Unsupported runtime "${runtime}". Use "node", "deno", or "bun".`,
          "init",
        );
      }

      options.runtime = runtime;
      index += 1;
      continue;
    }

    if (!current.startsWith("--")) {
      if (positionalName) {
        throw new CliUsageError(
          `Command "init" received multiple project names "${positionalName}" and "${current}".`,
          "init",
        );
      }

      positionalName = current;
      continue;
    }

    throw new CliUsageError(`Unknown option "${current}".`, "init");
  }

  options.name = positionalName;
  return options;
}

function parseAppCreateOptions(args) {
  const options = {
    name: undefined,
    type: undefined,
    template: undefined,
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

    if (current === "--template") {
      options.template = normalizeTemplateName(
        readOptionValue(current, remaining[index + 1], "app-create"),
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
      if (runtime !== "node" && runtime !== "deno") {
        throw new CliUsageError(
          `This CLI package only supports runtime "node" or "deno". Received "${runtime}".`,
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

  if (options.template && options.type) {
    throw new CliUsageError(
      'Command "app create" cannot combine --template and --type.',
      "app-create",
    );
  }

  return options;
}

function parseProfileCreateOptions(args) {
  const [action, maybeName, ...rest] = args;
  if (action !== "create") {
    throw new CliUsageError('Command "profile" requires "create".', "profile");
  }

  const positionalName = maybeName?.startsWith("--") ? undefined : maybeName;
  const remaining = positionalName ? rest : [maybeName, ...rest].filter(Boolean);
  const options = {
    name: undefined,
    target: undefined,
    basePath: undefined,
    siteUrl: undefined,
    configPath: "mainz.config.ts",
  };

  if (positionalName) {
    options.name = positionalName;
  }

  for (let index = 0; index < remaining.length; index += 1) {
    const current = remaining[index];

    if (current === "--name") {
      options.name = readOptionValue(current, remaining[index + 1], "profile-create");
      index += 1;
      continue;
    }

    if (current === "--target") {
      options.target = readOptionValue(current, remaining[index + 1], "profile-create");
      index += 1;
      continue;
    }

    if (current === "--base-path") {
      options.basePath = readOptionValue(current, remaining[index + 1], "profile-create");
      index += 1;
      continue;
    }

    if (current === "--site-url") {
      options.siteUrl = readOptionValue(current, remaining[index + 1], "profile-create");
      index += 1;
      continue;
    }

    if (current === "--config") {
      options.configPath = readOptionValue(current, remaining[index + 1], "profile-create");
      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown option "${current}".`, "profile-create");
  }

  if (!options.name?.trim()) {
    throw new CliUsageError('Command "profile create" requires a name.', "profile-create");
  }

  if (!options.target?.trim()) {
    throw new CliUsageError('Command "profile create" requires --target <name>.', "profile-create");
  }

  return options;
}

function parseWorkflowOptions(args) {
  const [action, maybeProvider, ...rest] = args;
  if (action !== "create" && action !== "update") {
    throw new CliUsageError('Command "workflow" requires "create" or "update".', "workflow");
  }

  const provider = maybeProvider?.trim();
  if (provider !== "gh-pages" && provider !== "github-pages") {
    throw new CliUsageError(
      `Unsupported workflow provider "${provider ?? ""}". Use "gh-pages".`,
      action === "create" ? "workflow-create" : "workflow-update",
    );
  }

  const options = {
    action,
    branch: undefined,
    trigger: undefined,
    configPath: "mainz.config.ts",
  };

  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];

    if (current === "--branch") {
      options.branch = readOptionValue(current, rest[index + 1], `workflow-${action}`);
      index += 1;
      continue;
    }

    if (current === "--trigger") {
      const trigger = readOptionValue(current, rest[index + 1], `workflow-${action}`);
      if (trigger !== "push" && trigger !== "manual") {
        throw new CliUsageError(
          `Unsupported workflow trigger "${trigger}". Use "push" or "manual".`,
          action === "create" ? "workflow-create" : "workflow-update",
        );
      }

      options.trigger = trigger;
      index += 1;
      continue;
    }

    if (current === "--config") {
      options.configPath = readOptionValue(current, rest[index + 1], `workflow-${action}`);
      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown option "${current}".`, action === "create" ? "workflow-create" : "workflow-update");
  }

  return options;
}

function parseAppRemoveOptions(args) {
  const positionalName = args[0]?.startsWith("--") ? undefined : args[0];
  const remaining = positionalName ? args.slice(1) : args;
  const options = {
    name: positionalName,
    configPath: "mainz.config.ts",
    deleteFiles: false,
  };
  let flagName;

  for (let index = 0; index < remaining.length; index += 1) {
    const current = remaining[index];

    if (current === "--target") {
      flagName = readOptionValue(
        current,
        remaining[index + 1],
        "app-remove",
      );
      index += 1;
      continue;
    }

    if (current === "--config") {
      options.configPath = readOptionValue(
        current,
        remaining[index + 1],
        "app-remove",
      );
      index += 1;
      continue;
    }

    if (current === "--delete-files") {
      options.deleteFiles = true;
      continue;
    }

    throw new CliUsageError(`Unknown option "${current}".`, "app-remove");
  }

  options.name = resolveAppCommandName("remove", positionalName, flagName);
  return options;
}

function parseAppInfoOptions(args) {
  const positionalName = args[0]?.startsWith("--") ? undefined : args[0];
  const remaining = positionalName ? args.slice(1) : args;
  const options = parseAppSharedOptions(remaining, "app-info");
  let flagName;

  for (let index = 0; index < remaining.length; index += 1) {
    const current = remaining[index];

    if (current === "--target") {
      flagName = readOptionValue(current, remaining[index + 1], "app-info");
      index += 1;
      continue;
    }

    if (current === "--config") {
      index += 1;
      continue;
    }
  }

  return {
    ...options,
    name: resolveAppCommandName("info", positionalName, flagName),
  };
}

function parseAppSharedOptions(args, helpTopic) {
  const options = {
    configPath: "mainz.config.ts",
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--config") {
      options.configPath = readOptionValue(
        current,
        args[index + 1],
        helpTopic,
      );
      index += 1;
      continue;
    }

    if (current === "--target") {
      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown option "${current}".`, helpTopic);
  }

  return options;
}

function resolveAppCommandName(action, positionalName, flagName) {
  if (
    positionalName?.trim() &&
    flagName?.trim() &&
    positionalName.trim() !== flagName.trim()
  ) {
    throw new CliUsageError(
      `Command "app ${action}" received conflicting names "${positionalName}" and "${flagName}".`,
      `app-${action}`,
    );
  }

  const resolved = flagName?.trim() || positionalName?.trim();
  if (!resolved) {
    throw new CliUsageError(
      `Command "app ${action}" requires a name.`,
      `app-${action}`,
    );
  }

  return resolved;
}

function readOptionValue(option, value, helpTopic = "main") {
  if (!value?.trim()) {
    throw new CliUsageError(`Option "${option}" requires a value.`, helpTopic);
  }

  return value;
}

async function resolveInitProjectTemplateSource(template, runtime) {
  if (isTemplateSourceSpecifier(template)) {
    return await resolveExternalTemplateSource(template);
  }

  const runtimeRoot = resolveBuiltInTemplateRoot("project", runtime);
  const templateRoot = resolve(runtimeRoot, template);
  if (await pathExists(resolve(templateRoot, "template.json"))) {
    return { templateRoot };
  }

  const availableForRuntime = await listBuiltInTemplateNames(runtimeRoot);
  const availableTemplates = await listProjectTemplateNames();
  if (availableTemplates.includes(template)) {
    throw new CliUsageError(
      `Project template "${template}" is not available for runtime "${runtime}". Available templates for ${runtime}: ${
        formatTemplateNames(availableForRuntime)
      }.`,
      "init",
    );
  }

  throw new CliUsageError(
    `Project template "${template}" was not found. Available project templates: ${
      formatTemplateNames(availableTemplates)
    }.`,
    "init",
  );
}

async function resolveAppTemplateSource(template) {
  if (isTemplateSourceSpecifier(template)) {
    return await resolveExternalTemplateSource(template);
  }

  const appTemplatesRoot = resolveBuiltInTemplateRoot("app", ".");
  const templateRoot = resolve(appTemplatesRoot, template);
  if (await pathExists(resolve(templateRoot, "template.json"))) {
    return { templateRoot };
  }

  throw new CliUsageError(
    `App template "${template}" was not found. Available app templates: ${
      formatTemplateNames(await listBuiltInTemplateNames(appTemplatesRoot))
    }.`,
    "app-create",
  );
}

async function resolveExternalTemplateSource(source) {
  if (isHttpTemplateSource(source)) {
    return { templateUrl: source };
  }

  const templateRoot = resolveLocalTemplateSourcePath(source);
  if (await pathExists(resolve(templateRoot, "template.json"))) {
    return { templateRoot };
  }

  throw new CliUsageError(
    `Template source "${source}" was not found or does not contain template.json.`,
  );
}

function resolveLocalTemplateSourcePath(source) {
  if (source.startsWith("file://")) {
    return fileURLToPath(source);
  }

  return isAbsolute(source) ? source : resolve(process.cwd(), source);
}

function isTemplateSourceSpecifier(value) {
  return isHttpTemplateSource(value) ||
    value.startsWith("file://") ||
    isAbsolute(value) ||
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.includes("/") ||
    value.includes("\\");
}

function isHttpTemplateSource(value) {
  return value.startsWith("https://") || value.startsWith("http://");
}

function resolveDefaultAppTemplateName(type) {
  return type === "root" ? "default-root" : "default-routed";
}

async function listProjectTemplateNames() {
  const projectTemplatesRoot = resolveBuiltInTemplateRoot("project", ".");
  if (!(await pathExists(projectTemplatesRoot))) {
    return [];
  }

  const names = new Set();
  for (const entry of await readdir(projectTemplatesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const runtimeRoot = resolve(projectTemplatesRoot, entry.name);
    for (const templateName of await listBuiltInTemplateNames(runtimeRoot)) {
      names.add(templateName);
    }
  }

  return [...names].sort();
}

async function listBuiltInTemplateNames(root) {
  if (!(await pathExists(root))) {
    return [];
  }

  const names = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      await pathExists(resolve(root, entry.name, "template.json"))
    ) {
      names.push(entry.name);
    }
  }

  return names.sort();
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function formatTemplateNames(names) {
  return names.length > 0 ? names.join(", ") : "none";
}

async function assertSupportedProjectConfig(configPath) {
  const source = await readFile(resolve(process.cwd(), configPath), "utf8");
  const match = source.match(/\bruntime\s*:\s*["'](node|deno)["']/);
  if (!match) {
    throw new CliUsageError(
      `Expected "${configPath}" to define runtime "node" or "deno" before running "mainz app create".`,
      "app-create",
    );
  }

  return match[1];
}

async function resolveProjectRuntimeForWorkspaceUpdate(configPath) {
  const loaded = await loadProjectConfig(configPath);
  const runtime = loaded.config.runtime ?? "node";
  if (runtime !== "node" && runtime !== "deno") {
    throw new CliUsageError(
      `This CLI package only supports runtime "node" or "deno". Received "${runtime}".`,
      "app-remove",
    );
  }

  return runtime;
}

async function upsertConfigTarget(configPath, targetSource) {
  const absoluteConfigPath = resolve(process.cwd(), configPath);
  const source = await readFile(absoluteConfigPath, "utf8");
  const updated = insertConfigTarget(source, targetSource);
  await writeTextFile(absoluteConfigPath, updated);
}

async function writeTextFile(path, content) {
  const { writeFile } = await import("node:fs/promises");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
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

function removeConfigTarget(source, targetName) {
  const targetsArray = findTargetsArray(source);
  const objectRanges = findTopLevelObjectRanges(
    source,
    targetsArray.openIndex,
    targetsArray.closeIndex,
  );
  const matchingRange = objectRanges.find((range) =>
    source.slice(range.start, range.end).includes(`name: ${JSON.stringify(targetName)}`)
  );

  if (!matchingRange) {
    return source;
  }

  let removeStart = matchingRange.start;
  const lineStart = source.lastIndexOf("\n", matchingRange.start) + 1;
  if (source.slice(lineStart, matchingRange.start).trim() === "") {
    removeStart = lineStart;
  }

  let removeEnd = matchingRange.end;
  const afterObject = source.slice(removeEnd, targetsArray.closeIndex);
  const trailingCommaMatch = afterObject.match(/^\s*,/);

  if (trailingCommaMatch) {
    removeEnd += trailingCommaMatch[0].length;
    const nextNewline = source.indexOf("\n", removeEnd);
    if (nextNewline >= 0 && nextNewline < targetsArray.closeIndex) {
      removeEnd = nextNewline + 1;
    }
  } else {
    const beforeObject = source.slice(targetsArray.openIndex + 1, removeStart);
    const previousCommaIndex = beforeObject.lastIndexOf(",");
    if (
      previousCommaIndex >= 0 &&
      beforeObject.slice(previousCommaIndex + 1).trim() === ""
    ) {
      removeStart = targetsArray.openIndex + 1 + previousCommaIndex;
    }
  }

  return `${source.slice(0, removeStart)}${source.slice(removeEnd)}`.replace(
    /\[\s+\]/,
    "[]",
  );
}

function findConfigTargetSource(source, targetName) {
  const targetsArray = findTargetsArray(source);
  const objectRanges = findTopLevelObjectRanges(
    source,
    targetsArray.openIndex,
    targetsArray.closeIndex,
  );
  const matchingRange = objectRanges.find((range) =>
    source.slice(range.start, range.end).includes(`name: ${JSON.stringify(targetName)}`)
  );

  return matchingRange ? source.slice(matchingRange.start, matchingRange.end) : undefined;
}

function extractTargetRootDir(targetSource) {
  const match = targetSource.match(/\brootDir\s*:\s*(["'])(.*?)\1/);
  return match?.[2]?.trim() || undefined;
}

async function removeAppRoot(rootDir) {
  const cwd = process.cwd();
  const rootPath = resolve(cwd, rootDir);
  const relativeRoot = relative(cwd, rootPath);

  if (!relativeRoot || relativeRoot.startsWith("..") || isAbsolute(relativeRoot)) {
    throw new CliUsageError(
      `Refusing to delete app root outside the current workspace: "${rootDir}".`,
      "app-remove",
    );
  }

  await rm(rootPath, { recursive: true, force: true });
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

function findTopLevelObjectRanges(source, openIndex, closeIndex) {
  const ranges = [];
  for (let index = openIndex + 1; index < closeIndex; index += 1) {
    if (source[index] !== "{") {
      continue;
    }

    const end = findMatchingBracket(source, index, "{", "}") + 1;
    ranges.push({ start: index, end });
    index = end;
  }

  return ranges;
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

function validateTemplateRuntimeCompatibility(manifest, projectRuntime, templateName) {
  const compatibleRuntimes = resolveTemplateCompatibleRuntimes(manifest);
  if (!compatibleRuntimes || compatibleRuntimes.includes(projectRuntime)) {
    return;
  }

  throw new Error(
    `Template "${templateName}" is not compatible with runtime "${projectRuntime}". Compatible runtimes: ${
      formatTemplateNames(compatibleRuntimes)
    }.`,
  );
}

function resolveTemplateCompatibleRuntimes(manifest) {
  const compatibility = manifest.compatibility;
  if (compatibility === undefined) {
    return undefined;
  }

  if (!compatibility || typeof compatibility !== "object" || Array.isArray(compatibility)) {
    throw new Error(
      `Template "${manifest.name ?? "unknown"}" compatibility must be an object.`,
    );
  }

  const runtimes = compatibility.runtimes;
  if (runtimes === undefined) {
    return undefined;
  }

  if (!Array.isArray(runtimes)) {
    throw new Error(
      `Template "${manifest.name ?? "unknown"}" compatibility.runtimes must be an array.`,
    );
  }

  return [...new Set(runtimes.map((runtime) => {
    if (runtime !== "deno" && runtime !== "node" && runtime !== "bun") {
      throw new Error(
        `Template "${manifest.name ?? "unknown"}" declares unsupported runtime "${String(runtime)}".`,
      );
    }

    return runtime;
  }))].sort();
}

async function prepareAppTemplateWorkspaceUpdates(manifest, projectRuntime, appName, rootDir) {
  const dependencies = resolveTemplateDependencies(manifest);
  if (projectRuntime === "deno") {
    return await prepareDenoAppWorkspaceUpdates(dependencies, rootDir);
  }

  return await prepareNodeAppWorkspaceUpdates(dependencies, appName, rootDir);
}

async function prepareRemoveAppWorkspaceUpdate(projectRuntime, rootDir) {
  if (projectRuntime === "deno") {
    return await prepareRemoveDenoWorkspaceUpdate(rootDir);
  }

  return await prepareRemoveNodeWorkspaceUpdate(rootDir);
}

async function prepareRemoveDenoWorkspaceUpdate(rootDir) {
  const denoJsonPath = resolve(process.cwd(), "deno.json");
  if (!(await pathExists(denoJsonPath))) {
    return undefined;
  }

  const denoConfig = await readJsonObjectFile(
    denoJsonPath,
    `Expected "${denoJsonPath}" to exist.`,
  );
  const workspace = denoConfig.workspace;
  if (workspace === undefined) {
    return undefined;
  }

  if (!Array.isArray(workspace) || workspace.some((entry) => typeof entry !== "string")) {
    throw new Error('Expected "workspace" in deno.json to be an array of strings.');
  }

  const nextWorkspace = removeWorkspacePath(workspace, rootDir);
  if (nextWorkspace.length === workspace.length) {
    return undefined;
  }

  return {
    path: denoJsonPath,
    content: `${JSON.stringify({ ...denoConfig, workspace: nextWorkspace }, null, 4)}\n`,
  };
}

async function prepareRemoveNodeWorkspaceUpdate(rootDir) {
  const packageJsonPath = resolve(process.cwd(), "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return undefined;
  }

  const packageJson = await readJsonObjectFile(
    packageJsonPath,
    `Expected "${packageJsonPath}" to exist.`,
  );
  const workspaces = packageJson.workspaces;
  if (workspaces === undefined) {
    return undefined;
  }

  if (!Array.isArray(workspaces) || workspaces.some((entry) => typeof entry !== "string")) {
    throw new Error('Expected "workspaces" in package.json to be an array of strings.');
  }

  const nextWorkspaces = removeWorkspacePath(workspaces, rootDir);
  if (nextWorkspaces.length === workspaces.length) {
    return undefined;
  }

  return {
    path: packageJsonPath,
    content: `${JSON.stringify({ ...packageJson, workspaces: nextWorkspaces }, null, 4)}\n`,
  };
}

function resolveTemplateDependencies(manifest) {
  return [
    ...resolveTemplateDependencyList(manifest, "dependencies"),
    ...resolveTemplateDependencyList(manifest, "devDependencies"),
  ];
}

function resolveTemplateDependencyList(manifest, kind) {
  const value = manifest[kind];
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Template "${manifest.name ?? "unknown"}" ${kind} must be an array.`);
  }

  return value.map((dependency) => normalizeTemplateDependency(manifest, kind, dependency));
}

function normalizeTemplateDependency(manifest, kind, dependency) {
  const templateName = manifest.name ?? "unknown";
  if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
    throw new Error(`Template "${templateName}" ${kind} entries must be objects.`);
  }

  const specifier = normalizeDependencyString(
    templateName,
    kind,
    "specifier",
    dependency.specifier,
  );
  if (dependency.registry !== "npm" && dependency.registry !== "jsr") {
    throw new Error(
      `Template "${templateName}" dependency "${specifier}" must use registry "npm" or "jsr".`,
    );
  }

  return {
    kind,
    specifier,
    registry: dependency.registry,
    packageName: normalizeDependencyString(
      templateName,
      kind,
      "package",
      dependency.package ?? specifier,
    ),
    version: normalizeDependencyString(templateName, kind, "version", dependency.version),
    subpaths: normalizeDependencySubpaths(templateName, kind, specifier, dependency.subpaths),
  };
}

function normalizeDependencySubpaths(templateName, kind, specifier, value) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(
      `Template "${templateName}" ${kind} entry "${specifier}" subpaths must be an array.`,
    );
  }

  return value.map((subpath) => {
    if (typeof subpath !== "string" || !subpath.trim()) {
      throw new Error(
        `Template "${templateName}" ${kind} entry "${specifier}" subpaths must be strings.`,
      );
    }

    const normalized = subpath.trim().replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized.includes("..") || /\s/.test(normalized)) {
      throw new Error(
        `Template "${templateName}" ${kind} entry "${specifier}" has invalid subpath "${subpath}".`,
      );
    }

    return normalized;
  });
}

function normalizeDependencyString(templateName, kind, field, value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Template "${templateName}" ${kind} entry is missing "${field}".`);
  }

  const normalized = value.trim();
  if (/\s/.test(normalized)) {
    throw new Error(
      `Template "${templateName}" ${kind} field "${field}" must not contain whitespace.`,
    );
  }

  return normalized;
}

async function prepareDenoAppWorkspaceUpdates(dependencies, rootDir) {
  const denoJsonPath = resolve(process.cwd(), "deno.json");
  if (!(await pathExists(denoJsonPath))) {
    if (dependencies.length === 0) {
      return [];
    }

    throw new Error(
      'Template dependencies for runtime "deno" require deno.json. Run "mainz init" first.',
    );
  }

  const denoConfig = await readJsonObjectFile(
    denoJsonPath,
    'Template dependencies for runtime "deno" require deno.json. Run "mainz init" first.',
  );
  const workspace = denoConfig.workspace;
  if (
    workspace !== undefined &&
    (!Array.isArray(workspace) || workspace.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error('Expected "workspace" in deno.json to be an array of strings.');
  }

  const appDenoJsonPath = resolve(process.cwd(), rootDir, "deno.json");
  const appDenoConfig = await pathExists(appDenoJsonPath)
    ? await readJsonObjectFile(
      appDenoJsonPath,
      `Expected "${appDenoJsonPath}" to exist.`,
    )
    : {};
  const imports = appDenoConfig.imports;
  if (imports !== undefined && (!imports || typeof imports !== "object" || Array.isArray(imports))) {
    throw new Error(`Expected "imports" in ${appDenoJsonPath} to be an object.`);
  }

  const workspacePath = renderDenoWorkspacePath(rootDir);
  const nextWorkspace = appendUniqueString(workspace ?? [], workspacePath);
  const nextImports = { ...(imports ?? {}) };
  for (const dependency of dependencies) {
    const desired = renderDenoDependencySpecifier(dependency);
    assertDependencySlotAvailable(
      nextImports,
      dependency.specifier,
      desired,
      `${appDenoJsonPath} imports`,
    );
    nextImports[dependency.specifier] = desired;

    for (const subpath of dependency.subpaths) {
      const subpathSpecifier = `${dependency.specifier}/${subpath}`;
      const desiredSubpath = `${desired}/${subpath}`;
      assertDependencySlotAvailable(
        nextImports,
        subpathSpecifier,
        desiredSubpath,
        `${appDenoJsonPath} imports`,
      );
      nextImports[subpathSpecifier] = desiredSubpath;
    }
  }

  return [{
    path: denoJsonPath,
    content: `${JSON.stringify({ ...denoConfig, workspace: nextWorkspace }, null, 4)}\n`,
  }, {
    path: appDenoJsonPath,
    content: `${JSON.stringify({ ...appDenoConfig, imports: nextImports }, null, 4)}\n`,
  }];
}

async function prepareNodeAppWorkspaceUpdates(dependencies, appName, rootDir) {
  const packageJsonPath = resolve(process.cwd(), "package.json");
  if (!(await pathExists(packageJsonPath))) {
    if (dependencies.length === 0) {
      return [];
    }

    throw new Error(
      'Template dependencies for runtime "node" require package.json. Run "mainz init" first.',
    );
  }

  const packageJson = await readJsonObjectFile(
    packageJsonPath,
    'Template dependencies for runtime "node" require package.json. Run "mainz init" first.',
  );
  const workspaces = packageJson.workspaces;
  if (
    workspaces !== undefined &&
    (!Array.isArray(workspaces) || workspaces.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error('Expected "workspaces" in package.json to be an array of strings.');
  }

  const appPackageJsonPath = resolve(process.cwd(), rootDir, "package.json");
  const appPackageJson = await pathExists(appPackageJsonPath)
    ? await readJsonObjectFile(
      appPackageJsonPath,
      `Expected "${appPackageJsonPath}" to exist.`,
    )
    : {
      name: appName,
      private: true,
      type: "module",
    };
  const dependencySections = {
    dependencies: resolvePackageDependencySection(appPackageJson, "dependencies"),
    devDependencies: resolvePackageDependencySection(appPackageJson, "devDependencies"),
  };

  for (const dependency of dependencies) {
    const desired = renderNodeDependencySpecifier(dependency);
    const targetSection = dependencySections[dependency.kind];
    const otherKind = dependency.kind === "dependencies" ? "devDependencies" : "dependencies";
    const otherSection = dependencySections[otherKind];

    assertDependencySlotAvailable(
      targetSection,
      dependency.specifier,
      desired,
      `${appPackageJsonPath} ${dependency.kind}`,
    );

    if (
      Object.hasOwn(otherSection, dependency.specifier) &&
      otherSection[dependency.specifier] !== desired
    ) {
      throw new Error(
        `Template dependency "${dependency.specifier}" conflicts with existing package.json ${otherKind} value "${
          String(otherSection[dependency.specifier])
        }".`,
      );
    }

    if (!Object.hasOwn(otherSection, dependency.specifier)) {
      targetSection[dependency.specifier] = desired;
    }
  }

  const updates = [{
    path: packageJsonPath,
    content: `${JSON.stringify({
      ...packageJson,
      workspaces: appendUniqueString(workspaces ?? [], renderNodeWorkspacePath(rootDir)),
    }, null, 4)}\n`,
  }, {
    path: appPackageJsonPath,
    content: `${JSON.stringify({
      ...appPackageJson,
      dependencies: dependencySections.dependencies,
      devDependencies: dependencySections.devDependencies,
    }, null, 4)}\n`,
  }];

  if (dependencies.some((dependency) => dependency.registry === "jsr")) {
    const npmrcUpdate = await prepareJsrNpmrcUpdate();
    if (npmrcUpdate) {
      updates.push(npmrcUpdate);
    }
  }

  return updates;
}

async function readJsonObjectFile(path, missingMessage) {
  if (!(await pathExists(path))) {
    throw new Error(missingMessage);
  }

  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected "${path}" to contain a JSON object.`);
  }

  return parsed;
}

function renderDenoWorkspacePath(rootDir) {
  const relativePath = relative(process.cwd(), resolve(process.cwd(), rootDir)).replaceAll(
    "\\",
    "/",
  );
  if (!relativePath || relativePath === ".") {
    return ".";
  }

  if (relativePath.startsWith("../")) {
    return relativePath;
  }

  return relativePath.startsWith("./") ? relativePath : `./${relativePath}`;
}

function renderNodeWorkspacePath(rootDir) {
  const relativePath = relative(process.cwd(), resolve(process.cwd(), rootDir)).replaceAll(
    "\\",
    "/",
  );
  if (!relativePath || relativePath === ".") {
    return ".";
  }

  return relativePath;
}

function removeWorkspacePath(values, rootDir) {
  const workspacePath = normalizeWorkspacePath(renderDenoWorkspacePath(rootDir));
  return values.filter((value) => normalizeWorkspacePath(value) !== workspacePath);
}

function normalizeWorkspacePath(value) {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function appendUniqueString(values, value) {
  return values.includes(value) ? [...values] : [...values, value];
}

function resolvePackageDependencySection(packageJson, kind) {
  const section = packageJson[kind];
  if (section !== undefined && (!section || typeof section !== "object" || Array.isArray(section))) {
    throw new Error(`Expected "${kind}" in package.json to be an object.`);
  }

  return { ...(section ?? {}) };
}

function assertDependencySlotAvailable(target, specifier, desired, location) {
  if (!Object.hasOwn(target, specifier) || target[specifier] === desired) {
    return;
  }

  throw new Error(
    `Template dependency "${specifier}" conflicts with existing ${location} value "${
      String(target[specifier])
    }".`,
  );
}

function renderDenoDependencySpecifier(dependency) {
  return `${dependency.registry}:${dependency.packageName}@${dependency.version}`;
}

function renderNodeDependencySpecifier(dependency) {
  if (dependency.registry === "npm") {
    return dependency.specifier === dependency.packageName
      ? dependency.version
      : `npm:${dependency.packageName}@${dependency.version}`;
  }

  return `npm:${renderJsrNpmPackageName(dependency.packageName)}@${dependency.version}`;
}

function renderJsrNpmPackageName(packageName) {
  const match = packageName.match(/^@([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`JSR dependency "${packageName}" must be scoped as @scope/name.`);
  }

  return `@jsr/${match[1]}__${match[2]}`;
}

async function prepareJsrNpmrcUpdate() {
  const npmrcPath = resolve(process.cwd(), ".npmrc");
  const registryLine = "@jsr:registry=https://npm.jsr.io";
  const current = await pathExists(npmrcPath) ? await readFile(npmrcPath, "utf8") : "";

  if (current.split(/\r?\n/).some((line) => line.trim() === registryLine)) {
    return undefined;
  }

  const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  return {
    path: npmrcPath,
    content: `${current}${separator}${registryLine}\n`,
  };
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

function resolveTargetBuildConfigFile(target) {
  return target.buildConfig?.trim()
    ? resolve(process.cwd(), target.buildConfig)
    : resolve(process.cwd(), target.rootDir, "mainz.build.ts");
}

function renderGeneratedBuildConfig(profileSource) {
  return [
    'import { defineTargetBuild } from "mainz/config";',
    "",
    "export default defineTargetBuild({",
    "    profiles: {",
    profileSource,
    "    },",
    "});",
    "",
  ].join("\n");
}

function renderBuildProfileProperty(profileName, options) {
  const properties = [];
  if (options.basePath) {
    properties.push(`            basePath: ${JSON.stringify(options.basePath)},`);
  }
  if (options.siteUrl) {
    properties.push(`            siteUrl: ${JSON.stringify(options.siteUrl)},`);
  }

  return [
    `        ${JSON.stringify(profileName)}: {`,
    ...properties,
    "        },",
  ].join("\n");
}

function upsertBuildProfile(source, profileName, profileSource) {
  const profilesObject = findNamedObject(source, "profiles");
  const existingRange = findNamedPropertyRange(
    source,
    profilesObject.openIndex,
    profilesObject.closeIndex,
    profileName,
  );

  if (existingRange) {
    return `${source.slice(0, existingRange.start)}${profileSource}${source.slice(existingRange.end)}`;
  }

  const beforeClose = source.slice(0, profilesObject.closeIndex).replace(/\s*$/, "");
  const afterClose = source.slice(profilesObject.closeIndex);
  const closeLineStart = source.lastIndexOf("\n", profilesObject.closeIndex) + 1;
  const closeIndent = source.slice(closeLineStart, profilesObject.closeIndex);
  const needsComma = !beforeClose.endsWith("{") && !beforeClose.endsWith(",");
  const separator = beforeClose.endsWith("{") ? "\n" : `${needsComma ? "," : ""}\n`;

  return `${beforeClose}${separator}${profileSource}\n${closeIndent}${afterClose}`;
}

function findNamedObject(source, propertyName) {
  const propertyIndex = source.search(new RegExp(`\\b${propertyName}\\s*:`));
  if (propertyIndex < 0) {
    throw new CliUsageError(`Expected "${propertyName}" to be an object.`);
  }

  const openIndex = source.indexOf("{", propertyIndex);
  if (openIndex < 0) {
    throw new CliUsageError(`Expected "${propertyName}" to be an object.`);
  }

  return {
    openIndex,
    closeIndex: findMatchingBracket(source, openIndex, "{", "}"),
  };
}

function findNamedPropertyRange(source, openIndex, closeIndex, propertyName) {
  let quote;
  let escaped = false;
  let depth = 0;

  for (let index = openIndex + 1; index < closeIndex; index += 1) {
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

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      continue;
    }

    if (depth !== 0) {
      continue;
    }

    const needles = [`"${propertyName}"`, `'${propertyName}'`];
    const matchingNeedle = needles.find((needle) => source.startsWith(needle, index));
    if (!matchingNeedle) {
      continue;
    }

    const afterNeedle = source.slice(index + matchingNeedle.length);
    if (!afterNeedle.match(/^\s*:/)) {
      continue;
    }

    const valueStart = source.indexOf("{", index + matchingNeedle.length);
    if (valueStart < 0 || valueStart > closeIndex) {
      throw new CliUsageError(`Profile "${propertyName}" must use an object value.`);
    }

    const valueEnd = findMatchingBracket(source, valueStart, "{", "}") + 1;
    let propertyStart = index;
    const lineStart = source.lastIndexOf("\n", index) + 1;
    if (source.slice(lineStart, index).trim() === "") {
      propertyStart = lineStart;
    }

    let propertyEnd = valueEnd;
    const afterValue = source.slice(propertyEnd, closeIndex);
    const trailingCommaMatch = afterValue.match(/^\s*,/);
    if (trailingCommaMatch) {
      propertyEnd += trailingCommaMatch[0].length;
      const newlineIndex = source.indexOf("\n", propertyEnd);
      if (newlineIndex >= 0 && newlineIndex < closeIndex) {
        propertyEnd = newlineIndex + 1;
      }
    }

    return { start: propertyStart, end: propertyEnd };
  }

  return undefined;
}

function inferDefaultProfileBasePath(targetName) {
  return targetName === "site" ? "/" : `/${targetName}/`;
}

async function resolveGithubPagesWorkflowTargets(config) {
  const targets = [];
  const stagingPaths = new Map();

  for (const target of config.targets) {
    const buildConfigPath = resolveTargetBuildConfigFile(target);
    let source;
    try {
      source = await readFile(buildConfigPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    const profile = readProfileFromBuildConfig(source, "gh-pages");
    if (!profile) {
      continue;
    }

    const basePath = normalizeBuildProfileBasePath(profile.basePath ?? "/");
    const stagingPath = normalizeWorkflowStagingPath(basePath);
    const conflict = stagingPaths.get(stagingPath);
    if (conflict) {
      throw new CliUsageError(
        `Targets "${conflict}" and "${target.name}" both resolve to the GitHub Pages staging path "${stagingPath || "/"}".`,
        "workflow-create",
      );
    }

    stagingPaths.set(stagingPath, target.name);
    targets.push({
      name: target.name,
      basePath,
      outDir: resolvePublishOutDir(target),
      stagingPath,
    });
  }

  return targets;
}

function readProfileFromBuildConfig(source, profileName) {
  const literal = extractDefineTargetBuildLiteral(source);
  let config;
  try {
    config = Function(`return (${literal});`)();
  } catch (error) {
    throw new CliUsageError(
      'Could not evaluate target build config. Keep build configs using an object-literal defineTargetBuild(...) export.',
      "workflow-create",
    );
  }

  return config?.profiles?.[profileName];
}

function extractDefineTargetBuildLiteral(source) {
  const callIndex = source.indexOf("defineTargetBuild(");
  if (callIndex === -1) {
    throw new CliUsageError('Could not find "defineTargetBuild(" in target build config.');
  }

  const openIndex = source.indexOf("(", callIndex);
  const closeIndex = findMatchingBracket(source, openIndex, "(", ")");
  return source.slice(openIndex + 1, closeIndex).trim();
}

function normalizeBuildProfileBasePath(basePath) {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function normalizeWorkflowStagingPath(basePath) {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return trimmed.replace(/^\/+|\/+$/g, "");
}

function resolvePublishOutDir(target) {
  const outDir = target.outDir?.trim() || `dist/${target.name}`;
  return `${normalizePathSlashes(outDir)}/ssg`;
}

async function renderGithubPagesWorkflowTemplateParams(options) {
  const publishInfoCliSpecifier = await resolveHostedCliPackageSpecifier("deno");
  const triggerBlock = options.trigger === "manual"
    ? [
      "on:",
      "    workflow_dispatch:",
    ].join("\n")
    : [
      "on:",
      "    push:",
      "        branches:",
      `            - ${options.branch}`,
      "    workflow_dispatch:",
    ].join("\n");

  const buildSteps = options.targets.map((target) =>
    [
      `            - name: Build ${target.name}`,
      `              run: deno task build --target ${target.name} --profile gh-pages`,
    ].join("\n")
  ).join("\n\n");

  const metadataCommands = options.targets.map((target) =>
    `                  ${target.name}_metadata="$(deno run -A --config deno.json ${publishInfoCliSpecifier} publish-info --target ${target.name} --profile gh-pages)"`
  ).join("\n");

  const metadataEchoes = options.targets.map((target) =>
    `                  echo "$${target.name}_metadata"`
  ).join("\n");

  const artifactCommands = options.targets.map((target) =>
    `                  ${target.name}_artifact_dir="$(METADATA="$${target.name}_metadata" deno eval 'console.log(JSON.parse(Deno.env.get("METADATA")!).outDir)')"`
  ).join("\n");

  const stagingCommands = options.targets.map((target) => {
    if (!target.stagingPath) {
      return `                  cp -a "$${target.name}_artifact_dir"/. "$staging_dir"/`;
    }

    return [
      `                  mkdir -p "$staging_dir/${target.stagingPath}"`,
      `                  cp -a "$${target.name}_artifact_dir"/. "$staging_dir/${target.stagingPath}"/`,
    ].join("\n");
  }).join("\n");

  return {
    triggerBlock,
    buildSteps,
    metadataCommands,
    metadataEchoes,
    artifactCommands,
    stagingCommands,
  };
}

function normalizePathSlashes(path) {
  return path.replaceAll("\\", "/");
}

async function assertPathExists(path, helpTopic) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new CliUsageError(`Workflow file "${path}" does not exist yet.`, helpTopic);
    }

    throw error;
  }
}

function targetNameNeedle(targetSource) {
  const match = targetSource.match(/name:\s*("[^"]+")/);
  return match?.[1] ? `name: ${match[1]}` : "target";
}

function normalizeTemplateName(name) {
  const normalized = name.trim();
  if (isTemplateSourceSpecifier(normalized)) {
    return normalized;
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(normalized)) {
    throw new CliUsageError(
      `Invalid template name or source "${name}". Use a built-in template name, a local path, a file:// URL, or an http(s) URL.`,
    );
  }

  return normalized;
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

  if (command === "app" && subcommand === "remove") {
    return "app-remove";
  }

  if (command === "app" && subcommand === "list") {
    return "app-list";
  }

  if (command === "app" && subcommand === "info") {
    return "app-info";
  }

  if (command === "profile" && subcommand === "create") {
    return "profile-create";
  }

  if (command === "profile") {
    return "profile";
  }

  if (command === "workflow" && subcommand === "create") {
    return "workflow-create";
  }

  if (command === "workflow" && subcommand === "update") {
    return "workflow-update";
  }

  if (command === "workflow") {
    return "workflow";
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

  if (helpTopic === "profile-create") {
    return "profile create --help";
  }

  if (helpTopic === "workflow-create") {
    return "workflow create --help";
  }

  if (helpTopic === "workflow-update") {
    return "workflow update --help";
  }

  return `${helpTopic} --help`;
}

function getHelpText(topic) {
  if (topic === "init") {
    return [
      "Mainz CLI (Node) - init",
      "",
      "Usage:",
      "  mainz init [<name>] [--template <name|source>] [--runtime <node|deno|bun>] [--mainz <specifier>]",
      "",
      "Options:",
      "  --template <name|source>    Choose the project template. Defaults to empty.",
      "  --runtime <node|deno|bun>   Choose the runtime of the generated project.",
      "  --mainz <specifier>         Override the Mainz package specifier written to the project.",
      "",
      "Notes:",
      "  <name> creates the project in a new directory; omitting it initializes the current directory.",
      "  --template starter creates a routed app with a counter component.",
      "  --template also accepts a local path, file:// URL, or http(s) template source.",
      "  This command runs in the Node-hosted CLI, but it can still generate a Deno project.",
      "  Use --cli before the command only when delegating to another installed Mainz CLI host.",
    ].join("\n");
  }

  if (topic === "app") {
    return [
      "Mainz CLI (Node) - app",
      "",
      "Usage:",
      "  mainz app create [<name>|--name <name>] [--type <routed|root>|--template <name|source>] [--root <path>] [--out-dir <path>] [--navigation <spa|mpa|enhanced-mpa>] [--config <path>]",
      "  mainz app remove [<target>|--target <target>] [--delete-files] [--config <path>]",
      "  mainz app list [--config <path>]",
      "  mainz app info [<target>|--target <target>] [--config <path>]",
    ].join("\n");
  }

  if (topic === "app-create") {
    return [
      "Mainz CLI (Node) - app create",
      "",
      "Usage:",
      "  mainz app create [<name>|--name <name>] [--type <routed|root>|--template <name|source>] [--root <path>] [--out-dir <path>] [--navigation <spa|mpa|enhanced-mpa>] [--config <path>]",
      "",
      "Options:",
      "  --name <name>                  App name when not using the positional form.",
      "  --type <routed|root>           Choose the default app scaffold.",
      "  --template <name|source>       Choose an explicit app template or template source.",
      "  --root <path>                  Relative root directory for the app files.",
      "  --out-dir <path>               Relative output directory for the target.",
      "  --navigation <spa|mpa|enhanced-mpa>",
      "                                 Navigation mode for routed apps.",
      "  --config <path>                Mainz config path. Defaults to mainz.config.ts.",
      "",
      "Notes:",
      "  Without --template, Mainz uses default-routed; pass --type root for default-root.",
      "  --template accepts a built-in name, local path, file:// URL, or http(s) template source.",
      "  --template and --type are mutually exclusive.",
    ].join("\n");
  }

  if (topic === "app-remove") {
    return [
      "Mainz CLI (Node) - app remove",
      "",
      "Usage:",
      "  mainz app remove [<target>|--target <target>] [--delete-files] [--config <path>]",
    ].join("\n");
  }

  if (topic === "app-list") {
    return [
      "Mainz CLI (Node) - app list",
      "",
      "Usage:",
      "  mainz app list [--config <path>]",
    ].join("\n");
  }

  if (topic === "app-info") {
    return [
      "Mainz CLI (Node) - app info",
      "",
      "Usage:",
      "  mainz app info [<target>|--target <target>] [--config <path>]",
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
      "",
      "Notes:",
      "  Deno and Bun projects delegate to the matching installed Mainz CLI host.",
    ].join("\n");
  }

  if (topic === "profile") {
    return [
      "Mainz CLI (Node) - profile",
      "",
      "Usage:",
      "  mainz profile create [<name>|--name <name>] --target <name> [--base-path <path>] [--site-url <url>] [--config <path>]",
    ].join("\n");
  }

  if (topic === "profile-create") {
    return [
      "Mainz CLI (Node) - profile create",
      "",
      "Usage:",
      "  mainz profile create [<name>|--name <name>] --target <name> [--base-path <path>] [--site-url <url>] [--config <path>]",
    ].join("\n");
  }

  if (topic === "workflow") {
    return [
      "Mainz CLI (Node) - workflow",
      "",
      "Usage:",
      "  mainz workflow create gh-pages [--branch <name>] [--trigger <push|manual>] [--config <path>]",
      "  mainz workflow update gh-pages [--branch <name>] [--trigger <push|manual>] [--config <path>]",
    ].join("\n");
  }

  if (topic === "workflow-create") {
    return [
      "Mainz CLI (Node) - workflow create",
      "",
      "Usage:",
      "  mainz workflow create gh-pages [--branch <name>] [--trigger <push|manual>] [--config <path>]",
    ].join("\n");
  }

  if (topic === "workflow-update") {
    return [
      "Mainz CLI (Node) - workflow update",
      "",
      "Usage:",
      "  mainz workflow update gh-pages [--branch <name>] [--trigger <push|manual>] [--config <path>]",
    ].join("\n");
  }

  return [
    "Mainz CLI (Node)",
    "",
    "Usage:",
    "  mainz init [<name>] [--template <name|source>] [--runtime <node|deno|bun>] [--mainz <specifier>]",
    "  mainz app create [<name>|--name <name>] [--type <routed|root>|--template <name|source>] [--root <path>] [--out-dir <path>] [--navigation <spa|mpa|enhanced-mpa>] [--config <path>]",
    "  mainz app remove [<target>|--target <target>] [--delete-files] [--config <path>]",
    "  mainz app list [--config <path>]",
    "  mainz app info [<target>|--target <target>] [--config <path>]",
    "  mainz profile create [<name>|--name <name>] --target <name> [--base-path <path>] [--site-url <url>] [--config <path>]",
    "  mainz workflow create gh-pages [--branch <name>] [--trigger <push|manual>] [--config <path>]",
    "  mainz workflow update gh-pages [--branch <name>] [--trigger <push|manual>] [--config <path>]",
    "  mainz dev --target <name> [--host [host]] [--port <port>] [--config <path>]",
    "",
    "Global options:",
    "  --cli <node|deno|bun>  Selects which installed Mainz CLI host should execute the command.",
    "",
    "Command options:",
    "  --runtime <node|deno|bun>  Choose the runtime of the generated project.",
    "",
    "Notes:",
    "  This package owns the Node-hosted init, app lifecycle, profile, workflow, and Node-runtime dev flows.",
    '  Use "mainz init --runtime deno" to generate a Deno project from the Node CLI.',
    "  Deno and Bun projects delegate dev to the matching installed Mainz CLI host.",
  ].join("\n");
}

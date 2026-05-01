import test from "node:test";
import assert from "node:assert/strict";
import {
    chmod,
    mkdtemp,
    mkdir,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { main } from "./main.js";
import {
    prepareViteWorkspace,
    resolveNodeDevServerPlan,
    resolveViteDevInvocation,
} from "./dev.js";

test("cli: init should create a node project from the built-in template", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-init-"));

    try {
        process.chdir(cwd);

        const exitCode = await main([
            "init",
            "--mainz",
            "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
        ]);

        assert.equal(exitCode, 0);

        const config = await readFile(resolve(cwd, "mainz.config.ts"), "utf8");
        assert.match(config, /runtime: "node"/);

        const packageJson = await readFile(
            resolve(cwd, "package.json"),
            "utf8",
        );
        assert.match(packageJson, /"name": "mainz-cli-node-init-/);
        assert.match(packageJson, /"dev": "mainz dev"/);
        assert.match(packageJson, /"build": "mainz build"/);
        assert.match(packageJson, /npm:@jsr\/mainz__mainz@0.1.0-alpha.33/);

        const npmrc = await readFile(resolve(cwd, ".npmrc"), "utf8");
        assert.match(npmrc, /@jsr:registry=https:\/\/npm\.jsr\.io/);

        const tsconfig = await readFile(resolve(cwd, "tsconfig.json"), "utf8");
        assert.match(tsconfig, /"jsxImportSource": "mainz"/);
        assert.match(tsconfig, /"experimentalDecorators": true/);
        assert.match(tsconfig, /"useDefineForClassFields": false/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: init should create a deno project when --runtime deno is passed after the command", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-init-deno-"));

    try {
        process.chdir(cwd);

        const exitCode = await main([
            "init",
            "--runtime",
            "deno",
            "--mainz",
            "jsr:@mainz/mainz@0.1.0-alpha.33",
        ]);

        assert.equal(exitCode, 0);

        const config = await readFile(resolve(cwd, "mainz.config.ts"), "utf8");
        assert.match(config, /runtime: "deno"/);

        const denoConfig = await readFile(resolve(cwd, "deno.json"), "utf8");
        assert.match(denoConfig, /jsr:@mainz\/mainz@0.1.0-alpha.33/);
        assert.match(denoConfig, /jsr:@mainz\/cli-deno@0.1.0-alpha.33 dev/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: init should create a project in a named directory", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-init-named-"));

    try {
        process.chdir(cwd);

        const exitCode = await main([
            "init",
            "demo",
            "--mainz",
            "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
        ]);

        assert.equal(exitCode, 0);

        const config = await readFile(
            resolve(cwd, "demo", "mainz.config.ts"),
            "utf8",
        );
        assert.match(config, /runtime: "node"/);
        await assert.rejects(() =>
            readFile(resolve(cwd, "mainz.config.ts"), "utf8"),
        );
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: init should create a starter node project", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-init-starter-"),
    );

    try {
        process.chdir(cwd);

        const exitCode = await main([
            "init",
            "demo",
            "--template",
            "starter",
            "--mainz",
            "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
        ]);

        assert.equal(exitCode, 0);

        const config = await readFile(
            resolve(cwd, "demo", "mainz.config.ts"),
            "utf8",
        );
        assert.match(config, /runtime: "node"/);
        assert.match(config, /name: "app"/);
        assert.match(config, /appFile: "\.\/app\/src\/app\.ts"/);

        const packageJson = JSON.parse(
            await readFile(resolve(cwd, "demo", "package.json"), "utf8"),
        );
        assert.deepEqual(packageJson.workspaces, ["./app"]);

        const appPackageJson = JSON.parse(
            await readFile(resolve(cwd, "demo", "app", "package.json"), "utf8"),
        );
        assert.equal(appPackageJson.name, "app");

        const homePage = await readFile(
            resolve(cwd, "demo", "app", "src", "pages", "Home.page.tsx"),
            "utf8",
        );
        assert.match(homePage, /<Counter \/>/);

        const counter = await readFile(
            resolve(cwd, "demo", "app", "src", "components", "Counter.tsx"),
            "utf8",
        );
        assert.equal(counter.includes("@CustomElement"), false);
        assert.match(counter, /this\.setState\({ count: this\.state\.count \+ 1 }\)/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: init should reject an unknown project template", async () => {
    const { exitCode, stderr } = await runMainWithCapturedOutput([
        "init",
        "--template",
        "missing",
    ]);

    assert.equal(exitCode, 1);
    assert.match(stderr, /Project template "missing" was not found\./);
    assert.match(stderr, /Available project templates: empty, starter\./);
});

test("cli: init should accept a local project template source", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-init-local-template-"),
    );

    try {
        process.chdir(cwd);
        const templateDir = resolve(cwd, "project-template");
        await writeLocalProjectTemplate(templateDir);

        const exitCode = await main([
            "init",
            "demo",
            "--template",
            "./project-template",
        ]);

        assert.equal(exitCode, 0);

        const config = await readFile(
            resolve(cwd, "demo", "mainz.config.ts"),
            "utf8",
        );
        assert.match(config, /custom project template/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: should reject leading --runtime before the command", async () => {
    const { exitCode, stderr } = await runMainWithCapturedOutput([
        "--runtime",
        "deno",
        "init",
    ]);

    assert.equal(exitCode, 1);
    assert.match(stderr, /Unknown command "--runtime"\./);
    assert.match(stderr, /mainz --help/);
});

test("cli: init should allow matching --cli before the command", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-cli-init-deno-"),
    );

    try {
        process.chdir(cwd);

        const exitCode = await main([
            "--cli",
            "node",
            "init",
            "--runtime",
            "deno",
            "--mainz",
            "jsr:@mainz/mainz@0.1.0-alpha.33",
        ]);

        assert.equal(exitCode, 0);

        const config = await readFile(resolve(cwd, "mainz.config.ts"), "utf8");
        assert.match(config, /runtime: "deno"/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: init should reject runtime templates that are not implemented yet", async () => {
    const { exitCode, stderr } = await runMainWithCapturedOutput([
        "init",
        "--runtime",
        "bun",
    ]);
    assert.equal(exitCode, 1);
    assert.match(
        stderr,
        /Project template "empty" is not available for runtime "bun"\./,
    );
    assert.match(stderr, /Available templates for bun: none\./);
    assert.match(stderr, /mainz init --help/);
});

test("cli: should reject commands that are not implemented locally", async () => {
    const { exitCode, stderr } = await runMainWithCapturedOutput([
        "build",
        "--target",
        "site",
    ]);
    assert.equal(exitCode, 1);
    assert.match(
        stderr,
        /Command "build" is not implemented in @mainzjs\/cli-node yet/,
    );
    assert.match(stderr, /mainz --help/);
});

test("cli: should delegate non-host --cli values to explicit CLI executables", async () => {
    const previousPath = process.env.PATH;
    const binDir = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-bin-"));
    const markerPath = resolve(binDir, "delegated.txt");

    try {
        await writeFakeCliExecutable(binDir, "mainz-cli-deno", markerPath, 7);
        process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`;

        const exitCode = await main([
            "--cli",
            "deno",
            "init",
            "--runtime",
            "node",
        ]);

        assert.equal(exitCode, 7);
        assert.equal(
            (await readFile(markerPath, "utf8")).trim(),
            "init --runtime node",
        );
    } finally {
        process.env.PATH = previousPath;
        await rm(binDir, { recursive: true, force: true });
    }
});

test("cli: should fallback to the runtime runner when the explicit CLI executable is missing", async () => {
    const previousPath = process.env.PATH;
    const binDir = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-runner-bin-"),
    );
    const markerPath = resolve(binDir, "delegated-runner.txt");

    try {
        await writeFakeCliExecutable(binDir, "deno", markerPath, 9);
        process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`;

        const exitCode = await main([
            "--cli",
            "deno",
            "init",
            "--runtime",
            "node",
        ]);

        assert.equal(exitCode, 9);
        assert.equal(
            (await readFile(markerPath, "utf8")).trim(),
            "run -A jsr:@mainz/cli-deno@alpha init --runtime node",
        );
    } finally {
        process.env.PATH = previousPath;
        await rm(binDir, { recursive: true, force: true });
    }
});

test("cli: should reject unsupported --cli values softly", async () => {
    const { exitCode, stderr } = await runMainWithCapturedOutput([
        "--cli",
        "ruby",
        "init",
    ]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Unsupported CLI "ruby"/);
    assert.match(stderr, /mainz --help/);
});

test("package: should expose the generic and explicit node CLI bins", async () => {
    const packageJson = JSON.parse(
        await readFile(resolve("package.json"), "utf8"),
    );

    assert.equal(packageJson.bin.mainz, "bin/mainz.js");
    assert.equal(packageJson.bin["mainz-cli-node"], "bin/mainz.js");
});

test("cli: should print command help", async () => {
    const { exitCode, stdout } = await runMainWithCapturedOutput([
        "app",
        "create",
        "--help",
    ]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /Mainz CLI \(Node\) - app create/);
    assert.match(
        stdout,
        /\[--type <routed\|root>\|--template <name\|source>\]/,
    );
    assert.match(stdout, /--navigation <spa\|mpa\|enhanced-mpa>/);
});

test("cli: app create should scaffold a routed app and register the target", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-app-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const exitCode = await main(["app", "create", "site"]);
        assert.equal(exitCode, 0);

        const config = await readFile(resolve(cwd, "mainz.config.ts"), "utf8");
        assert.match(config, /name: "site"/);
        assert.match(config, /rootDir: "\.\/site"/);
        assert.match(config, /outDir: "dist\/site"/);
        assert.ok(!config.includes("targets:     {"));
        assert.match(config, /targets:\s*\[\s*{\s*name: "site",/s);

        const appFile = await readFile(
            resolve(cwd, "site", "src", "app.ts"),
            "utf8",
        );
        assert.match(appFile, /navigation: "enhanced-mpa"/);

        const packageJson = JSON.parse(
            await readFile(resolve(cwd, "package.json"), "utf8"),
        );
        assert.deepEqual(packageJson.workspaces, ["./site"]);

        const appPackageJson = JSON.parse(
            await readFile(resolve(cwd, "site", "package.json"), "utf8"),
        );
        assert.equal(appPackageJson.name, "site");

        const homePage = await readFile(
            resolve(cwd, "site", "src", "pages", "Home.page.tsx"),
            "utf8",
        );
        assert.match(homePage, /@Route\("\/"\)/);
        assert.equal(homePage.includes("@RenderMode"), false);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should scaffold a root app", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-root-app-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const exitCode = await main([
            "app",
            "create",
            "portal",
            "--type",
            "root",
        ]);
        assert.equal(exitCode, 0);

        const appFile = await readFile(
            resolve(cwd, "portal", "src", "app.ts"),
            "utf8",
        );
        assert.match(appFile, /root: AppRoot/);

        const rootComponent = await readFile(
            resolve(cwd, "portal", "src", "AppRoot.tsx"),
            "utf8",
        );
        assert.match(rootComponent, /<h1>portal<\/h1>/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should accept an explicit app template", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-app-template-"),
    );

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const exitCode = await main([
            "app",
            "create",
            "docs",
            "--template",
            "default-routed",
        ]);
        assert.equal(exitCode, 0);

        const config = await readFile(resolve(cwd, "mainz.config.ts"), "utf8");
        assert.match(config, /name: "docs"/);
        assert.match(config, /appFile: "\.\/docs\/src\/app\.ts"/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should apply template npm dependencies to node app workspaces", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-app-chart-node-"),
    );

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const exitCode = await main([
            "app",
            "create",
            "analytics",
            "--template",
            "chart",
        ]);
        assert.equal(exitCode, 0);

        const packageJson = JSON.parse(
            await readFile(resolve(cwd, "package.json"), "utf8"),
        );
        assert.equal(packageJson.dependencies["chart.js"], undefined);
        assert.deepEqual(packageJson.workspaces, ["./analytics"]);

        const appPackageJson = JSON.parse(
            await readFile(resolve(cwd, "analytics", "package.json"), "utf8"),
        );
        assert.equal(appPackageJson.dependencies["chart.js"], "^4.5.1");

        const homePage = await readFile(
            resolve(cwd, "analytics", "src", "pages", "Home.page.tsx"),
            "utf8",
        );
        assert.match(homePage, /<ChartWidget/);
        assert.equal(homePage.includes("@RenderMode"), false);

        const chartWidget = await readFile(
            resolve(cwd, "analytics", "src", "components", "ChartWidget.tsx"),
            "utf8",
        );
        assert.match(chartWidget, /from "chart\.js\/auto"/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should apply template npm dependencies to deno app workspaces", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-app-chart-deno-"),
    );

    try {
        process.chdir(cwd);

        await main([
            "init",
            "--runtime",
            "deno",
            "--mainz",
            "jsr:@mainz/mainz@0.1.0-alpha.33",
        ]);

        const exitCode = await main([
            "app",
            "create",
            "analytics",
            "--template",
            "chart",
        ]);
        assert.equal(exitCode, 0);

        const denoConfig = JSON.parse(
            await readFile(resolve(cwd, "deno.json"), "utf8"),
        );
        assert.deepEqual(denoConfig.workspace, ["./analytics"]);

        const appDenoConfig = JSON.parse(
            await readFile(resolve(cwd, "analytics", "deno.json"), "utf8"),
        );
        assert.equal(appDenoConfig.imports["chart.js"], "npm:chart.js@^4.5.1");
        assert.equal(appDenoConfig.imports["chart.js/"], undefined);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should reject templates incompatible with the project runtime", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-app-runtime-template-"),
    );

    try {
        process.chdir(cwd);
        const templateDir = resolve(cwd, "deno-only-template");
        await writeLocalAppTemplate(templateDir, {
            compatibility: {
                runtimes: ["deno"],
            },
        });

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const { exitCode, stderr } = await runMainWithCapturedOutput([
            "app",
            "create",
            "custom",
            "--template",
            "./deno-only-template",
        ]);

        assert.equal(exitCode, 1);
        assert.match(stderr, /not compatible with runtime "node"/);
        await assert.rejects(() => stat(resolve(cwd, "custom")));
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should accept a local app template source", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-app-local-template-"),
    );

    try {
        process.chdir(cwd);
        const templateDir = resolve(cwd, "app-template");
        await writeLocalAppTemplate(templateDir);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const exitCode = await main([
            "app",
            "create",
            "custom",
            "--template",
            "./app-template",
        ]);

        assert.equal(exitCode, 0);

        const appFile = await readFile(
            resolve(cwd, "custom", "src", "app.ts"),
            "utf8",
        );
        assert.match(appFile, /custom app template custom/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should accept a remote app template source", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-app-remote-template-"),
    );
    const server = await serveRemoteAppTemplate();

    try {
        process.chdir(cwd);
        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const exitCode = await main([
            "app",
            "create",
            "remote",
            "--template",
            `${server.url}template.tar.gz`,
        ]);

        assert.equal(exitCode, 0);

        const appFile = await readFile(
            resolve(cwd, "remote", "src", "app.ts"),
            "utf8",
        );
        assert.match(appFile, /marker = "remote remote"/);
    } finally {
        await server.close();
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should reject combining --template and --type", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-app-template-type-"),
    );

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const { exitCode, stderr } = await runMainWithCapturedOutput([
            "app",
            "create",
            "docs",
            "--template",
            "default-routed",
            "--type",
            "root",
        ]);

        assert.equal(exitCode, 1);
        assert.match(stderr, /cannot combine --template and --type/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app create should reject an unknown app template", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-app-template-missing-"),
    );

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const { exitCode, stderr } = await runMainWithCapturedOutput([
            "app",
            "create",
            "docs",
            "--template",
            "missing",
        ]);

        assert.equal(exitCode, 1);
        assert.match(stderr, /App template "missing" was not found\./);
        assert.match(
            stderr,
            /Available app templates: chart, default-root, default-routed\./,
        );
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app remove should unregister only the selected target", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-app-remove-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);
        await main(["app", "create", "site"]);
        await main(["app", "create", "docs"]);

        const exitCode = await main(["app", "remove", "site"]);
        assert.equal(exitCode, 0);

        const config = await readFile(resolve(cwd, "mainz.config.ts"), "utf8");
        assert.ok(!config.includes('name: "site"'));
        assert.match(config, /name: "docs"/);

        const packageJson = JSON.parse(
            await readFile(resolve(cwd, "package.json"), "utf8"),
        );
        assert.deepEqual(packageJson.workspaces, ["./docs"]);

        const appFile = await stat(resolve(cwd, "site", "src", "app.ts"));
        assert.equal(appFile.isFile(), true);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app remove --delete-files should remove the app root", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-app-delete-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);
        await main(["app", "create", "site"]);

        const exitCode = await main([
            "app",
            "remove",
            "site",
            "--delete-files",
        ]);
        assert.equal(exitCode, 0);

        const config = await readFile(resolve(cwd, "mainz.config.ts"), "utf8");
        assert.ok(!config.includes('name: "site"'));

        const packageJson = JSON.parse(
            await readFile(resolve(cwd, "package.json"), "utf8"),
        );
        assert.deepEqual(packageJson.workspaces, []);

        await assert.rejects(() => stat(resolve(cwd, "site")));
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app list should print configured targets as JSON", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-app-list-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);
        await main(["app", "create", "site"]);

        const { exitCode, stdout } = await runMainWithCapturedOutput([
            "app",
            "list",
        ]);
        assert.equal(exitCode, 0);

        const entries = JSON.parse(stdout);
        assert.deepEqual(entries, [
            {
                target: "site",
                appId: "site",
                rootDir: "./site",
                appFile: "./site/src/app.ts",
                outDir: "dist/site",
            },
        ]);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: app info should print one configured target as JSON", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-app-info-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);
        await main(["app", "create", "site"]);

        const { exitCode, stdout } = await runMainWithCapturedOutput([
            "app",
            "info",
            "site",
        ]);
        assert.equal(exitCode, 0);

        const info = JSON.parse(stdout);
        assert.equal(info.target, "site");
        assert.equal(info.appId, "site");
        assert.equal(info.rootDir, "./site");
        assert.equal(info.appFile, "./site/src/app.ts");
        assert.equal(info.outDir, "dist/site");
        assert.deepEqual(info.vite, {
            source: "generated",
            configPath: null,
        });
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: profile create should create a target build config", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-profile-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);
        await main(["app", "create", "site"]);

        const exitCode = await main([
            "profile",
            "create",
            "gh-pages",
            "--target",
            "site",
            "--base-path",
            "/",
            "--site-url",
            "https://example.com",
        ]);
        assert.equal(exitCode, 0);

        const buildConfig = await readFile(
            resolve(cwd, "site", "mainz.build.ts"),
            "utf8",
        );
        assert.match(buildConfig, /defineTargetBuild/);
        assert.match(buildConfig, /"gh-pages": \{/);
        assert.match(buildConfig, /basePath: "\/"/);
        assert.match(buildConfig, /siteUrl: "https:\/\/example\.com"/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: workflow create should generate a gh-pages workflow for deno projects", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-workflow-"));

    try {
        process.chdir(cwd);

        await main([
            "init",
            "--runtime",
            "deno",
            "--mainz",
            "jsr:@mainz/mainz@0.1.0-alpha.33",
        ]);
        await main(["app", "create", "site"]);
        await main(["app", "create", "docs"]);
        await main([
            "profile",
            "create",
            "gh-pages",
            "--target",
            "site",
            "--base-path",
            "/",
        ]);
        await main([
            "profile",
            "create",
            "gh-pages",
            "--target",
            "docs",
            "--base-path",
            "/docs/",
        ]);

        const exitCode = await main(["workflow", "create", "gh-pages"]);
        assert.equal(exitCode, 0);

        const workflow = await readFile(
            resolve(cwd, ".github", "workflows", "deploy-github-pages.yml"),
            "utf8",
        );
        assert.match(workflow, /name: Deploy to GitHub Pages/);
        assert.match(
            workflow,
            /run: deno task build --target site --profile gh-pages/,
        );
        assert.match(
            workflow,
            /run: deno task build --target docs --profile gh-pages/,
        );
        assert.match(workflow, /mkdir -p "\$staging_dir\/docs"/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: workflow create should reject node-runtime projects for now", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-workflow-node-"),
    );

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);

        const { exitCode, stderr } = await runMainWithCapturedOutput([
            "workflow",
            "create",
            "gh-pages",
        ]);
        assert.equal(exitCode, 1);
        assert.match(
            stderr,
            /currently requires a project with runtime "deno"/,
        );
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: workflow update should rewrite an existing gh-pages workflow", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-workflow-update-"),
    );

    try {
        process.chdir(cwd);

        await main([
            "init",
            "--runtime",
            "deno",
            "--mainz",
            "jsr:@mainz/mainz@0.1.0-alpha.33",
        ]);
        await main(["app", "create", "site"]);
        await main([
            "profile",
            "create",
            "gh-pages",
            "--target",
            "site",
            "--base-path",
            "/",
        ]);

        await mkdir(resolve(cwd, ".github", "workflows"), { recursive: true });
        await writeFile(
            resolve(cwd, ".github", "workflows", "deploy-github-pages.yml"),
            "old workflow\n",
            "utf8",
        );

        const exitCode = await main([
            "workflow",
            "update",
            "gh-pages",
            "--branch",
            "release",
        ]);
        assert.equal(exitCode, 0);

        const workflow = await readFile(
            resolve(cwd, ".github", "workflows", "deploy-github-pages.yml"),
            "utf8",
        );
        assert.match(workflow, /- release/);
        assert.equal(workflow.includes("old workflow"), false);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: dev should build a Vite plan for the generated routed app", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-dev-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);
        await main(["app", "create", "site"]);
        await mkdir(resolve(cwd, "src", "public"), { recursive: true });
        await writeFile(resolve(cwd, "mod.ts"), "export {};\n", "utf8");
        await writeFile(
            resolve(cwd, "src", "jsx-runtime.ts"),
            "export {};\n",
            "utf8",
        );
        await writeFile(
            resolve(cwd, "src", "jsx-dev-runtime.ts"),
            "export {};\n",
            "utf8",
        );
        await writeFile(
            resolve(cwd, "src", "public", "http-testing.ts"),
            "export {};\n",
            "utf8",
        );

        const plan = await resolveNodeDevServerPlan({
            target: "site",
            host: undefined,
            port: undefined,
            configPath: "mainz.config.ts",
        });

        assert.equal(plan.target.name, "site");
        assert.match(plan.viteConfigSource, /appType: "mpa"/);
        assert.match(
            plan.viteConfigSource,
            /"__MAINZ_RENDER_MODE__": "\\"csr\\""/,
        );
        assert.match(
            plan.viteConfigSource,
            /"__MAINZ_NAVIGATION_MODE__": "\\"enhanced-mpa\\""/,
        );
        assert.match(
            plan.viteConfigSource,
            /"__MAINZ_TARGET_NAME__": "\\"site\\""/,
        );
        assert.match(plan.viteConfigSource, /root: ".*\/site"/);
        assert.match(plan.viteConfigSource, /find: "mainz\/jsx-dev-runtime"/);
        assert.match(plan.viteConfigSource, /find: "mainz\/jsx-runtime"/);
        assert.match(plan.viteConfigSource, /find: "mainz\/http\/testing"/);
        assert.match(plan.viteConfigSource, /find: "mainz"/);
        assert.ok(
            plan.viteConfigSource.indexOf('find: "mainz/jsx-dev-runtime"') <
                plan.viteConfigSource.indexOf('find: "mainz"'),
        );
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: dev should validate --port values", async () => {
    const { exitCode, stderr } = await runMainWithCapturedOutput([
        "dev",
        "--target",
        "site",
        "--port",
        "nope",
    ]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Invalid --port value "nope"\./);
    assert.match(stderr, /mainz --help/);
});

test("cli: dev should use a Windows-safe npx invocation", async () => {
    const invocation = resolveViteDevInvocation(["vite", "--version"]);

    if (process.platform === "win32") {
        assert.match(invocation.command, /cmd\.exe$/i);
        assert.deepEqual(invocation.args, [
            "/d",
            "/s",
            "/c",
            "npx",
            "vite",
            "--version",
        ]);
        return;
    }

    assert.equal(invocation.command, "npx");
    assert.deepEqual(invocation.args, ["vite", "--version"]);
});

test("cli: dev should prepare a deterministic vite workspace and remove legacy ones", async () => {
    const cwd = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-vite-workspace-"),
    );

    try {
        await mkdir(resolve(cwd, ".mainz-vite-old-a"));
        await mkdir(resolve(cwd, ".mainz-vite-old-b"));
        await mkdir(resolve(cwd, ".mainz-vite"));

        const workspace = await prepareViteWorkspace(
            cwd,
            "site",
            "export default {};",
        );

        assert.equal(
            workspace.directoryPath,
            resolve(cwd, "node_modules", ".mainz", "vite"),
        );
        assert.equal(
            workspace.viteConfigPath,
            resolve(
                cwd,
                "node_modules",
                ".mainz",
                "vite",
                "vite.config.site.generated.mjs",
            ),
        );
        assert.match(
            await readFile(workspace.viteConfigPath, "utf8"),
            /export default \{\};/,
        );

        await assert.rejects(() => stat(resolve(cwd, ".mainz-vite-old-a")));
        await assert.rejects(() => stat(resolve(cwd, ".mainz-vite-old-b")));
        await assert.rejects(() => stat(resolve(cwd, ".mainz-vite")));
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

async function runMainWithCapturedOutput(args) {
    const originalLog = console.log;
    const originalError = console.error;
    const stdout = [];
    const stderr = [];

    console.log = (...values) => {
        stdout.push(values.join(" "));
    };
    console.error = (...values) => {
        stderr.push(values.join(" "));
    };

    try {
        const exitCode = await main(args);
        return {
            exitCode,
            stdout: stdout.join("\n"),
            stderr: stderr.join("\n"),
        };
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
}

async function writeLocalProjectTemplate(templateDir) {
    await mkdir(resolve(templateDir, "files"), { recursive: true });
    await writeFile(
        resolve(templateDir, "template.json"),
        JSON.stringify(
            {
                kind: "project",
                name: "local-project",
            },
            null,
            4,
        ),
        "utf8",
    );
    await writeFile(
        resolve(templateDir, "files", "mainz.config.ts.tpl"),
        [
            'import { defineMainzConfig } from "mainz/config";',
            "",
            "export default defineMainzConfig({",
            '    runtime: "node",',
            "    // custom project template",
            "    targets: [],",
            "});",
            "",
        ].join("\n"),
        "utf8",
    );
}

async function writeLocalAppTemplate(templateDir, manifestFields = {}) {
    await mkdir(resolve(templateDir, "files", "src"), { recursive: true });
    await writeFile(
        resolve(templateDir, "template.json"),
        JSON.stringify(
            {
                kind: "app",
                name: "local-app",
                ...manifestFields,
                target: {
                    name: "{{appName}}",
                    rootDir: "{{rootDir}}",
                    appFile: "{{rootDir}}/src/app.ts",
                    appId: "{{appId}}",
                    outDir: "{{outDir}}",
                },
            },
            null,
            4,
        ),
        "utf8",
    );
    await writeFile(
        resolve(templateDir, "files", "index.html.tpl"),
        '<main id="{{appId}}"></main>\n',
        "utf8",
    );
    await writeFile(
        resolve(templateDir, "files", "src", "app.ts.tpl"),
        'export const marker = "custom app template {{appName}}";\n',
        "utf8",
    );
}

async function serveRemoteAppTemplate() {
    const archive = createTarGz({
        "remote-template/template.json": JSON.stringify({
            kind: "app",
            name: "remote-app",
            target: {
                name: "{{appName}}",
                rootDir: "{{rootDir}}",
                appFile: "{{rootDir}}/src/app.ts",
                appId: "{{appId}}",
                outDir: "{{outDir}}",
            },
        }),
        "remote-template/files/index.html.tpl": '<main id="{{appId}}"></main>\n',
        "remote-template/files/src/app.ts.tpl": 'export const marker = "remote {{appName}}";\n',
    });

    const server = createServer((request, response) => {
        if (request.url === "/template.tar.gz") {
            response.writeHead(200, { "content-type": "application/gzip" });
            response.end(archive);
            return;
        }

        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
    });

    await new Promise((resolvePromise) => {
        server.listen(0, "127.0.0.1", resolvePromise);
    });

    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);

    return {
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
            new Promise((resolvePromise, reject) => {
                server.close((error) =>
                    error ? reject(error) : resolvePromise(),
                );
            }),
    };
}

function createTarGz(files) {
    const chunks = [];
    const encoder = new TextEncoder();

    for (const [path, content] of Object.entries(files)) {
        const contentBytes = encoder.encode(content);
        chunks.push(createTarHeader(path, contentBytes.length));
        chunks.push(contentBytes);
        chunks.push(new Uint8Array(paddedTarSize(contentBytes.length) - contentBytes.length));
    }

    chunks.push(new Uint8Array(1024));

    return gzipSync(concatBytes(chunks));
}

function createTarHeader(path, size) {
    const header = new Uint8Array(512);
    writeTarString(header, 0, 100, path);
    writeTarString(header, 100, 8, "0000644");
    writeTarString(header, 108, 8, "0000000");
    writeTarString(header, 116, 8, "0000000");
    writeTarString(header, 124, 12, size.toString(8).padStart(11, "0"));
    writeTarString(header, 136, 12, "00000000000");
    header.fill(32, 148, 156);
    writeTarString(header, 156, 1, "0");
    writeTarString(header, 257, 6, "ustar");
    writeTarString(header, 263, 2, "00");

    const checksum = header.reduce((total, byte) => total + byte, 0);
    writeTarString(header, 148, 8, checksum.toString(8).padStart(6, "0"));
    header[154] = 0;
    header[155] = 32;

    return header;
}

function writeTarString(target, offset, length, value) {
    const bytes = new TextEncoder().encode(value);
    target.set(bytes.subarray(0, length), offset);
}

function paddedTarSize(size) {
    return Math.ceil(size / 512) * 512;
}

function concatBytes(chunks) {
    const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}

async function writeFakeCliExecutable(binDir, name, markerPath, exitCode) {
    if (process.platform === "win32") {
        await writeFile(
            resolve(binDir, `${name}.cmd`),
            [
                "@echo off",
                `echo %*>${JSON.stringify(markerPath)}`,
                `exit /b ${exitCode}`,
            ].join("\r\n"),
            "utf8",
        );
        return;
    }

    const path = resolve(binDir, name);
    await writeFile(
        path,
        [
            "#!/bin/sh",
            `printf '%s\\n' "$*" > ${JSON.stringify(markerPath)}`,
            `exit ${exitCode}`,
        ].join("\n"),
        "utf8",
    );
    await chmod(path, 0o755);
}

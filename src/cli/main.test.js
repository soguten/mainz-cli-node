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

test("cli: init should reject unsupported runtimes", async () => {
    const { exitCode, stderr } = await runMainWithCapturedOutput([
        "init",
        "--runtime",
        "bun",
    ]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Unsupported runtime "bun"\. Use "node" or "deno"\./);
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

        const homePage = await readFile(
            resolve(cwd, "site", "src", "pages", "Home.page.tsx"),
            "utf8",
        );
        assert.match(homePage, /@Route\("\/"\)/);
        assert.match(homePage, /@RenderMode\("ssg"\)/);
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

test("cli: dev should build a Vite plan for the generated routed app", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-dev-"));

    try {
        process.chdir(cwd);

        await main(["init", "--mainz", "npm:@jsr/mainz__mainz@0.1.0-alpha.33"]);
        await main(["app", "create", "site"]);

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
            /"__MAINZ_RENDER_MODE__": "\\"ssg\\""/,
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

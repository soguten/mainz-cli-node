import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { main } from "./main.js";
import { resolveNodeDevServerPlan, resolveViteDevInvocation } from "./dev.js";

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

        const packageJson = await readFile(resolve(cwd, "package.json"), "utf8");
        assert.match(packageJson, /"name": "mainz-cli-node-init-/);
        assert.match(packageJson, /"dev": "mainz dev"/);
        assert.match(packageJson, /"build": "mainz build"/);
        assert.match(packageJson, /npm:@jsr\/mainz__mainz@0.1.0-alpha.33/);

        const npmrc = await readFile(resolve(cwd, ".npmrc"), "utf8");
        assert.match(npmrc, /@jsr:registry=https:\/\/npm\.jsr\.io/);

        const tsconfig = await readFile(resolve(cwd, "tsconfig.json"), "utf8");
        assert.match(tsconfig, /"jsxImportSource": "mainz"/);
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

test("cli: init should create a deno project when --runtime deno is passed before the command", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-leading-init-deno-"));

    try {
        process.chdir(cwd);

        const exitCode = await main([
            "--runtime",
            "deno",
            "init",
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
    await assert.rejects(
        () => main(["init", "--runtime", "bun"]),
        /Unsupported runtime "bun"\. Use "node" or "deno"\./,
    );
});

test("cli: app create should scaffold a routed app and register the target", async () => {
    const previousCwd = process.cwd();
    const cwd = await mkdtemp(resolve(tmpdir(), "mainz-cli-node-app-"));

    try {
        process.chdir(cwd);

        await main([
            "init",
            "--mainz",
            "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
        ]);

        const exitCode = await main(["app", "create", "site"]);
        assert.equal(exitCode, 0);

        const config = await readFile(resolve(cwd, "mainz.config.ts"), "utf8");
        assert.match(config, /name: "site"/);
        assert.match(config, /rootDir: "\.\/site"/);
        assert.match(config, /outDir: "dist\/site"/);
        assert.ok(!config.includes("targets:     {"));
        assert.match(
            config,
            /targets:\s*\[\s*{\s*name: "site",/s,
        );

        const appFile = await readFile(resolve(cwd, "site", "src", "app.ts"), "utf8");
        assert.match(appFile, /navigation: "enhanced-mpa"/);

        const homePage = await readFile(resolve(cwd, "site", "src", "pages", "Home.page.tsx"), "utf8");
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

        await main([
            "init",
            "--mainz",
            "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
        ]);

        const exitCode = await main(["app", "create", "portal", "--type", "root"]);
        assert.equal(exitCode, 0);

        const appFile = await readFile(resolve(cwd, "portal", "src", "app.ts"), "utf8");
        assert.match(appFile, /root: AppRoot/);

        const rootComponent = await readFile(resolve(cwd, "portal", "src", "AppRoot.tsx"), "utf8");
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

        await main([
            "init",
            "--mainz",
            "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
        ]);
        await main(["app", "create", "site"]);

        const plan = await resolveNodeDevServerPlan({
            target: "site",
            host: undefined,
            port: undefined,
            configPath: "mainz.config.ts",
        });

        assert.equal(plan.target.name, "site");
        assert.match(plan.viteConfigSource, /appType: "mpa"/);
        assert.match(plan.viteConfigSource, /"__MAINZ_RENDER_MODE__": "\\"ssg\\""/);
        assert.match(plan.viteConfigSource, /"__MAINZ_NAVIGATION_MODE__": "\\"enhanced-mpa\\""/);
        assert.match(plan.viteConfigSource, /"__MAINZ_TARGET_NAME__": "\\"site\\""/);
        assert.match(plan.viteConfigSource, /root: ".*\/site"/);
    } finally {
        process.chdir(previousCwd);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli: dev should validate --port values", async () => {
    await assert.rejects(
        () => main(["dev", "--target", "site", "--port", "nope"]),
        /Invalid --port value "nope"\./,
    );
});

test("cli: dev should use a Windows-safe npx invocation", async () => {
    const invocation = resolveViteDevInvocation(["vite", "--version"]);

    if (process.platform === "win32") {
        assert.match(invocation.command, /cmd\.exe$/i);
        assert.deepEqual(invocation.args, ["/d", "/s", "/c", "npx", "vite", "--version"]);
        return;
    }

    assert.equal(invocation.command, "npx");
    assert.deepEqual(invocation.args, ["vite", "--version"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { instantiateTemplate, materializeTemplate } from "./index.js";
import { resolveBuiltInTemplateRoot } from "./load-template.js";

test("templates: should instantiate the built-in empty project template", async () => {
    const templateRoot = resolveBuiltInTemplateRoot("project", "node/empty");
    const plan = await instantiateTemplate({
        templateRoot,
        params: {
            mainzSpecifier: "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
            projectName: "mainz-app",
        },
    });

    assert.equal(plan.manifest.kind, "project");
    assert.equal(plan.manifest.name, "empty");
    assert.deepEqual(plan.files.map((file) => file.path).sort(), [
        ".npmrc",
        "mainz.config.ts",
        "package.json",
        "tsconfig.json",
    ]);

    const config = plan.files.find((file) => file.path === "mainz.config.ts");
    assert.ok(config);
    assert.match(config.content, /runtime: "node"/);

    const packageJson = plan.files.find((file) => file.path === "package.json");
    assert.ok(packageJson);
    assert.match(packageJson.content, /npm:@jsr\/mainz__mainz@0.1.0-alpha.33/);

    const tsconfig = plan.files.find((file) => file.path === "tsconfig.json");
    assert.ok(tsconfig);
    assert.match(tsconfig.content, /"experimentalDecorators": true/);
    assert.match(tsconfig.content, /"useDefineForClassFields": false/);
});

test("templates: should materialize the built-in empty project template to disk", async () => {
    const outputDir = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-template-"),
    );

    try {
        await materializeTemplate({
            templateRoot: resolveBuiltInTemplateRoot("project", "node/empty"),
            outputDir,
            params: {
                mainzSpecifier: "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
                projectName: "mainz-app",
            },
        });

        const packageJson = await readFile(
            resolve(outputDir, "package.json"),
            "utf8",
        );
        assert.match(packageJson, /"mainz-app"/);
        assert.match(
            packageJson,
            /"mainz": "npm:@jsr\/mainz__mainz@0.1.0-alpha.33"/,
        );
    } finally {
        await rm(outputDir, { recursive: true, force: true });
    }
});

test("templates: should preflight every destination before writing any project files", async () => {
    const outputDir = await mkdtemp(
        resolve(tmpdir(), "mainz-cli-node-template-"),
    );

    try {
        await assert.rejects(
            materializeTemplate({
                templateRoot: resolveBuiltInTemplateRoot(
                    "project",
                    "node/empty",
                ),
                outputDir,
                params: {
                    mainzSpecifier: "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
                    projectName: "mainz-app",
                },
                async beforeWrite(absolutePath) {
                    if (absolutePath.endsWith("mainz.config.ts")) {
                        throw new Error("Refusing to overwrite existing file");
                    }
                },
            }),
            /Refusing to overwrite existing file/,
        );

        await assert.rejects(
            readFile(resolve(outputDir, "package.json"), "utf8"),
            /ENOENT/,
        );
        await assert.rejects(
            readFile(resolve(outputDir, "mainz.config.ts"), "utf8"),
            /ENOENT/,
        );
    } finally {
        await rm(outputDir, { recursive: true, force: true });
    }
});

test("templates: should instantiate the built-in empty deno project template", async () => {
    const templateRoot = resolveBuiltInTemplateRoot("project", "deno/empty");
    const plan = await instantiateTemplate({
        templateRoot,
        params: {
            mainzSpecifier: "jsr:@mainz/mainz@0.1.0-alpha.33",
            mainzCliSpecifier: "jsr:@mainz/cli-deno@0.1.0-alpha.33",
            mainzSubpathPrefix: "jsr:/@mainz/mainz@0.1.0-alpha.33/",
            denoConfigPath: "deno.json",
            projectName: "mainz-app",
        },
    });

    assert.equal(plan.manifest.kind, "project");
    assert.equal(plan.manifest.name, "empty");
    assert.deepEqual(plan.files.map((file) => file.path).sort(), [
        "deno.json",
        "mainz.config.ts",
    ]);

    const config = plan.files.find((file) => file.path === "mainz.config.ts");
    assert.ok(config);
    assert.match(config.content, /runtime: "deno"/);

    const denoConfig = plan.files.find((file) => file.path === "deno.json");
    assert.ok(denoConfig);
    assert.match(denoConfig.content, /jsr:@mainz\/cli-deno@0.1.0-alpha.33 dev/);
});

test("templates: should instantiate the built-in starter node project template", async () => {
    const templateRoot = resolveBuiltInTemplateRoot("project", "node/starter");
    const plan = await instantiateTemplate({
        templateRoot,
        params: {
            mainzSpecifier: "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
            mainzCliSpecifier: "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
            mainzSubpathPrefix: "npm:@jsr/mainz__mainz@0.1.0-alpha.33/",
            denoConfigPath: "deno.json",
            projectName: "mainz-app",
            appName: "app",
            appId: "app",
            appNavigation: "enhanced-mpa",
            appTitle: "mainz-app",
            customElementPrefix: "x-mainz-app",
            rootDir: "./app",
            outDir: "dist/app",
        },
    });

    assert.equal(plan.manifest.kind, "project");
    assert.equal(plan.manifest.name, "starter");
    const files = new Map(
        plan.files.map((file) => [file.path.replaceAll("\\", "/"), file]),
    );
    assert.ok(files.get("app/src/components/Counter.tsx"));
    assert.ok(files.get("app/package.json"));
    assert.deepEqual([...files.keys()].sort(), [
        ".npmrc",
        "app/index.html",
        "app/package.json",
        "app/src/app.ts",
        "app/src/components/Counter.tsx",
        "app/src/main.tsx",
        "app/src/pages/Home.page.tsx",
        "app/src/pages/NotFound.page.tsx",
        "mainz.config.ts",
        "package.json",
        "tsconfig.json",
    ]);

    const homePage = files.get("app/src/pages/Home.page.tsx");
    assert.ok(homePage);
    assert.match(homePage.content, /<Counter \/>/);

    const counter = files.get("app/src/components/Counter.tsx");
    assert.ok(counter);
    assert.equal(counter.content.includes("@CustomElement"), false);
});

test("templates: should render target metadata from the built-in default-routed app template", async () => {
    const templateRoot = resolveBuiltInTemplateRoot("app", "default-routed");
    const plan = await instantiateTemplate({
        templateRoot,
        params: {
            appName: "site",
            appId: "site",
            appNavigation: "enhanced-mpa",
            appTitle: "site",
            customElementPrefix: "x-mainz-site",
            rootDir: "./site",
            outDir: "dist/site",
        },
    });

    assert.deepEqual(plan.manifest.target, {
        name: "site",
        rootDir: "./site",
        appFile: "./site/src/app.ts",
        appId: "site",
        outDir: "dist/site",
    });
});

test("templates: should instantiate the built-in chart app template", async () => {
    const templateRoot = resolveBuiltInTemplateRoot("app", "chart");
    const plan = await instantiateTemplate({
        templateRoot,
        params: {
            appName: "analytics",
            appId: "analytics",
            appNavigation: "enhanced-mpa",
            appTitle: "analytics",
            customElementPrefix: "x-mainz-analytics",
            rootDir: "./analytics",
            outDir: "dist/analytics",
        },
    });

    assert.equal(plan.manifest.name, "chart");
    assert.deepEqual(plan.manifest.dependencies, [
        {
            specifier: "chart.js",
            registry: "npm",
            package: "chart.js",
            version: "^4.5.1",
        },
    ]);

    const files = new Map(
        plan.files.map((file) => [file.path.replaceAll("\\", "/"), file]),
    );
    assert.ok(files.get("src/components/ChartWidget.tsx"));
    assert.match(
        files.get("src/components/ChartWidget.tsx").content,
        /from "chart\.js\/auto"/,
    );
});

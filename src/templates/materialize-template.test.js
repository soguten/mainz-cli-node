import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { instantiateTemplate, materializeTemplate } from "./index.js";
import { resolveBuiltInTemplateRoot } from "./load-template.js";

test("templates: should instantiate the built-in empty project template", async () => {
    const templateRoot = resolveBuiltInTemplateRoot("project", "empty-node");
    const plan = await instantiateTemplate({
        templateRoot,
        params: {
            mainzSpecifier: "npm:@jsr/mainz__mainz@0.1.0-alpha.33",
            projectName: "mainz-app",
        },
    });

    assert.equal(plan.manifest.kind, "project");
    assert.equal(plan.manifest.name, "empty-node");
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
            templateRoot: resolveBuiltInTemplateRoot("project", "empty-node"),
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
                    "empty-node",
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
    const templateRoot = resolveBuiltInTemplateRoot("project", "empty-deno");
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
    assert.equal(plan.manifest.name, "empty-deno");
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

test("templates: should render target metadata from the built-in routed app template", async () => {
    const templateRoot = resolveBuiltInTemplateRoot("app", "routed");
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

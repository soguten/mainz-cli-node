import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { loadTemplate } from "./load-template.js";

export async function instantiateTemplate(options) {
    const template = await loadTemplate(options.templateRoot);
    const relativePaths = await collectTemplateFiles(template.filesRoot);

    return {
        manifest: template.manifest,
        files: await Promise.all(
            relativePaths.map(async (relativePath) => {
                const sourcePath = resolve(template.filesRoot, relativePath);
                const renderedPath = stripTemplateSuffix(
                    replaceTemplateTokens(relativePath, options.params ?? {}),
                );
                const renderedContent = replaceTemplateTokens(
                    await readFile(sourcePath, "utf8"),
                    options.params ?? {},
                );

                return {
                    path: renderedPath,
                    content: renderedContent,
                };
            }),
        ),
    };
}

export async function materializeTemplate(options) {
    const plan = await instantiateTemplate(options);

    for (const file of plan.files) {
        const absolutePath = resolve(options.outputDir, file.path);
        if (typeof options.beforeWrite === "function") {
            await options.beforeWrite(absolutePath, file);
        }
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, file.content, "utf8");
    }

    return plan;
}

async function collectTemplateFiles(root, current = root) {
    const entries = await readdir(current, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = resolve(current, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectTemplateFiles(root, absolutePath));
            continue;
        }

        files.push(relative(root, absolutePath));
    }

    return files;
}

function replaceTemplateTokens(value, params) {
    return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key) => {
        if (!(key in params)) {
            throw new Error(`Missing template parameter "${key}".`);
        }

        const replacement = params[key];
        if (replacement === undefined || replacement === null) {
            throw new Error(`Missing template parameter "${key}".`);
        }

        return String(replacement);
    });
}

function stripTemplateSuffix(path) {
    return path.endsWith(".tpl") ? path.slice(0, -".tpl".length) : path;
}

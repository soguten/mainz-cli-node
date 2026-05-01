import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..", "..");
const gunzipAsync = promisify(gunzip);
const tarBlockSize = 512;

export function resolveBuiltInTemplateRoot(kind, name) {
    return resolve(repoRoot, "templates", kind, name);
}

export async function loadTemplate(templateRoot) {
    const manifestPath = resolve(templateRoot, "template.json");
    const manifestSource = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestSource);

    if (!manifest.kind || !manifest.name) {
        throw new Error(`Invalid template manifest at "${manifestPath}".`);
    }

    return {
        manifest,
        manifestSource,
        root: templateRoot,
        filesRoot: resolve(templateRoot, "files"),
    };
}

export async function loadRemoteTemplate(templateSourceUrl) {
    const archiveUrl = resolveRemoteTemplateArchiveUrl(templateSourceUrl);
    const archiveEntries = parseTarArchive(
        await ungzip(await fetchRemoteTemplateBytes(archiveUrl)),
        archiveUrl.href,
    );
    const manifestEntry = resolveRemoteTemplateManifestEntry(archiveEntries, archiveUrl.href);
    const manifestSource = manifestEntry.content;
    const manifest = JSON.parse(manifestSource);

    if (!manifest.kind || !manifest.name) {
        throw new Error(`Invalid remote template source manifest in "${archiveUrl.href}".`);
    }

    const templateRoot = dirname(manifestEntry.path).replaceAll("\\", "/");
    const filesRoot = templateRoot === "." ? "files/" : `${templateRoot}/files/`;
    const files = archiveEntries
        .filter((entry) => entry.path.startsWith(filesRoot) && entry.path !== filesRoot)
        .map((entry) => ({
            path: entry.path.slice(filesRoot.length),
            content: entry.content,
        }))
        .filter((file) => file.path.length > 0);

    return {
        manifest,
        manifestSource,
        root: archiveUrl.href,
        filesRoot,
        files,
    };
}

function resolveRemoteTemplateArchiveUrl(templateSourceUrl) {
    const url = new URL(templateSourceUrl);
    if (url.pathname.endsWith(".tar.gz") || url.pathname.endsWith(".tgz")) {
        return url;
    }

    throw new Error(
        `Remote template source "${templateSourceUrl}" must point to a .tar.gz or .tgz archive.`,
    );
}

async function fetchRemoteTemplateBytes(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Could not fetch remote template source archive "${url.href}": ${response.status} ${response.statusText}.`,
        );
    }

    return new Uint8Array(await response.arrayBuffer());
}

async function ungzip(bytes) {
    return new Uint8Array(await gunzipAsync(bytes));
}

function parseTarArchive(bytes, source) {
    const entries = [];
    let offset = 0;

    while (offset + tarBlockSize <= bytes.length) {
        const header = bytes.subarray(offset, offset + tarBlockSize);
        if (header.every((value) => value === 0)) {
            break;
        }

        const path = normalizeRemoteTemplateFilePath(readTarString(header, 0, 100));
        const prefix = readTarString(header, 345, 155);
        const fullPath = prefix ? normalizeRemoteTemplateFilePath(`${prefix}/${path}`) : path;
        const typeFlag = readTarString(header, 156, 1);
        const size = readTarOctal(header, 124, 12);
        const contentOffset = offset + tarBlockSize;
        const nextOffset = contentOffset + Math.ceil(size / tarBlockSize) * tarBlockSize;

        if (nextOffset > bytes.length) {
            throw new Error(`Remote template archive "${source}" has a truncated tar entry.`);
        }

        if (typeFlag === "" || typeFlag === "0") {
            entries.push({
                path: fullPath,
                content: textDecode(bytes.subarray(contentOffset, contentOffset + size)),
            });
        }

        offset = nextOffset;
    }

    return entries;
}

function resolveRemoteTemplateManifestEntry(entries, source) {
    const manifests = entries.filter((entry) =>
        entry.path.endsWith("/template.json") ||
        entry.path === "template.json"
    );
    if (manifests.length === 0) {
        throw new Error(`Remote template archive "${source}" must contain a template.json file.`);
    }

    const manifestWithFiles = manifests.find((entry) => {
        const templateRoot = dirname(entry.path).replaceAll("\\", "/");
        const filesRoot = templateRoot === "." ? "files/" : `${templateRoot}/files/`;
        return entries.some((candidate) => candidate.path.startsWith(filesRoot));
    });

    return manifestWithFiles ?? manifests[0];
}

function normalizeRemoteTemplateFilePath(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) {
        throw new Error("Remote template source file paths must be non-empty strings.");
    }

    const normalized = filePath.trim().replaceAll("\\", "/").replace(/^\/+/, "");
    if (
        normalized.includes("://") ||
        normalized.split("/").some((segment) => segment === "..")
    ) {
        throw new Error(`Invalid remote template source file path "${filePath}".`);
    }

    return normalized;
}

function readTarString(bytes, offset, length) {
    const slice = bytes.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return textDecode(end >= 0 ? slice.subarray(0, end) : slice).trim();
}

function readTarOctal(bytes, offset, length) {
    const value = readTarString(bytes, offset, length).replace(/\0/g, "").trim();
    return value ? Number.parseInt(value, 8) : 0;
}

function textDecode(bytes) {
    return new TextDecoder().decode(bytes);
}

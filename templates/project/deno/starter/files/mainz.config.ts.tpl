import { defineMainzConfig } from "mainz/config";

export default defineMainzConfig({
    runtime: "deno",
    targets: [
        {
            name: "{{appName}}",
            rootDir: "{{rootDir}}",
            appFile: "{{rootDir}}/src/app.ts",
            appId: "{{appId}}",
            outDir: "{{outDir}}",
        },
    ],
});

import { defineMainzConfig } from "mainz/config";

export default defineMainzConfig({
    runtime: "node",
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

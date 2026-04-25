#!/usr/bin/env node

import process from "node:process";
import { main } from "../src/cli/main.js";

try {
    const exitCode = await main(process.argv.slice(2), { hostRuntime: "node" });
    if (exitCode !== 0) {
        process.exit(exitCode);
    }
} catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
}

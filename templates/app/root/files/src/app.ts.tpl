import { defineApp } from "mainz";
import { AppRoot } from "./AppRoot.tsx";

export const app = defineApp({
    id: "{{appId}}",
    root: AppRoot,
});

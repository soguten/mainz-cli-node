import { defineApp } from "mainz";
import { HomePage } from "./pages/Home.page.tsx";
import { NotFoundPage } from "./pages/NotFound.page.tsx";

export const app = defineApp({
    id: "{{appId}}",
    navigation: "{{appNavigation}}",
    pages: [HomePage],
    notFound: NotFoundPage,
});

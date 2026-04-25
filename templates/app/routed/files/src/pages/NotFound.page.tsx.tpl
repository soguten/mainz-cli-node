import { CustomElement, Page, RenderMode } from "mainz";

@CustomElement("{{customElementPrefix}}-not-found-page")
@RenderMode("ssg")
export class NotFoundPage extends Page {
    override head() {
        return {
            title: "404 | {{appTitle}}",
        };
    }

    override render() {
        return (
            <main>
                <h1>Page not found</h1>
                <a href="/">Go home</a>
            </main>
        );
    }
}

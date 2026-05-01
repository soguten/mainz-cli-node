import { Page } from "mainz";

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

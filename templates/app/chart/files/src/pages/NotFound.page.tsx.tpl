import { Page } from "mainz";

export class NotFoundPage extends Page {
    override head() {
        return {
            title: "404 | chart",
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

import { Page, Route } from "mainz";

@Route("/")
export class HomePage extends Page {
    override head() {
        return {
            title: "{{appTitle}}",
        };
    }

    override render() {
        return (
            <main>
                <h1>{{appTitle}}</h1>
            </main>
        );
    }
}

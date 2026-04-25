import { CustomElement, Page, RenderMode, Route } from "mainz";

@CustomElement("{{customElementPrefix}}-home-page")
@Route("/")
@RenderMode("ssg")
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

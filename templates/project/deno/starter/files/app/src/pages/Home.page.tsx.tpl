import { Page, Route } from "mainz";
import { Counter } from "../components/Counter.tsx";

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
                <p>Welcome to your Mainz starter app.</p>
                <Counter />
            </main>
        );
    }
}

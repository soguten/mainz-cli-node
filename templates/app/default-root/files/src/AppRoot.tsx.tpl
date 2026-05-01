import { Component } from "mainz";

export class AppRoot extends Component {
    override render() {
        return (
            <main>
                <h1>{{appTitle}}</h1>
            </main>
        );
    }
}

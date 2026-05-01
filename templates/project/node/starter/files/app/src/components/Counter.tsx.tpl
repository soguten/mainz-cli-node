import { Component } from "mainz";

type CounterState = {
    count: number;
};

export class Counter extends Component<{}, CounterState> {
    protected override initState(): CounterState {
        return { count: 0 };
    }

    private decrement = () => {
        this.setState({ count: this.state.count - 1 });
    };

    private increment = () => {
        this.setState({ count: this.state.count + 1 });
    };

    override render() {
        return (
            <section className="counter" aria-label="Counter example">
                <p>Count: {this.state.count}</p>
                <div>
                    <button type="button" onClick={this.decrement}>-</button>
                    <button type="button" onClick={this.increment}>+</button>
                </div>
            </section>
        );
    }
}

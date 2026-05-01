import { Component } from "mainz";
import Chart from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";

interface ChartCardProps {
    title: string;
    description?: string;
    config: ChartConfiguration;
}

export class ChartWidget extends Component<ChartCardProps> {
    private chart?: Chart;

    override onMount() {
        this.createChart();
    }

    override onUnmount() {
        this.chart?.destroy();
        this.chart = undefined;
    }

    private createChart() {
        const canvas = this.querySelector<HTMLCanvasElement>("[data-chart]");

        if (!canvas) return;

        this.chart?.destroy();
        this.chart = new Chart(canvas, this.props.config);
    }

    override render() {
        return (
            <article>
                <header>
                    <h2>{this.props.title}</h2>

                    {this.props.description && (
                        <p>
                            {this.props.description}
                        </p>
                    )}
                </header>

                <div>
                    <canvas data-chart></canvas>
                </div>
            </article>
        );
    }
}

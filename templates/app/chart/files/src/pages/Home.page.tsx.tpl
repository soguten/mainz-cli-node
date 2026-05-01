import { Page, Route } from "mainz";
import { ChartWidget } from "../components/ChartWidget.tsx";
import { categoriesPieChartConfig } from "../charts/categoriesPieChartConfig.ts";

@Route("/")
export class HomePage extends Page {
    override head() {
        return {
            title: "chart",
        };
    }

    override render() {
        return (
            <main>
                <header>
                    <h1>chart</h1>
                    <p>Mainz + Chart.js</p>
                </header>

                <ChartWidget
                    title="Sales by category"
                    config={categoriesPieChartConfig}
                />
            </main>
        );
    }
}

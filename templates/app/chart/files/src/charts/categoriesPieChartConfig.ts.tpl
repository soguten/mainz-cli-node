import type { ChartConfiguration } from "chart.js";

export const categoriesPieChartConfig: ChartConfiguration = {
    type: "pie",
    data: {
        labels: ["Electronics", "Clothing", "Home", "Books", "Other"],
        datasets: [
            {
                label: "Categories",
                data: [35, 25, 20, 10, 10],
            },
        ],
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: "bottom",
            },
        },
    },
};

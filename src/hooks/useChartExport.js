import { useCallback } from "react";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

Chart.register(ChartDataLabels);

export function useChartExport() {
  const exportToExcel = useCallback(async (dailyLog) => {
    if (!dailyLog || dailyLog.length === 0) {
      alert("No data to export!");
      return;
    }

    try {
      // 1. Aggregate data by date
      const aggregated = {};
      dailyLog.forEach((record) => {
        const dateKey = record.date;
        if (!aggregated[dateKey]) {
          aggregated[dateKey] = {
            date: dateKey,
            plus_dc: 0,
            minus_dc: 0,
            total_cable: 0,
            workers: 0,
            subcontractor: record.subcontractor || "",
          };
        }
        aggregated[dateKey].plus_dc += record.plus_dc || 0;
        aggregated[dateKey].minus_dc += record.minus_dc || 0;
        aggregated[dateKey].total_cable += record.total_cable || 0;
        aggregated[dateKey].workers = Math.max(
          aggregated[dateKey].workers,
          record.workers || 0
        );
      });

      // 2. Sort by date
      const sorted = Object.values(aggregated).sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );

      // 3. Prepare chart data
      const labels = sorted.map((r) => r.date);
      const cableData = sorted.map((r) => r.total_cable);
      const workerData = sorted.map((r) => r.workers);
      const subData = sorted.map((r) =>
        r.subcontractor ? r.subcontractor.slice(0, 3).toUpperCase() : ""
      );

      // 4. Create hidden canvas for chart
      let canvas = document.getElementById("exportChart");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "exportChart";
        canvas.width = 800;
        canvas.height = 400;
        canvas.style.display = "none";
        document.body.appendChild(canvas);
      }

      const ctx = canvas.getContext("2d");

      // 5. Create chart
      const chart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: labels,
          datasets: [
            {
              label: "DC Cable (m)",
              data: cableData,
              backgroundColor: "rgba(54, 162, 235, 0.8)",
              borderColor: "rgba(54, 162, 235, 1)",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: false,
          plugins: {
            title: {
              display: true,
              text: "Daily DC Cable Installation Progress",
              font: { size: 16 },
            },
            legend: {
              display: true,
            },
            datalabels: {
              anchor: "end",
              align: "top",
              formatter: (value, context) => {
                const workers = workerData[context.dataIndex];
                const sub = subData[context.dataIndex];
                return `${workers}\n${sub}`;
              },
              font: {
                size: 10,
                weight: "bold",
              },
              color: "#333",
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: "Cable Length (m)",
              },
            },
            x: {
              title: {
                display: true,
                text: "Date",
              },
            },
          },
        },
      });

      // 6. Wait for chart to render
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 7. Convert chart to image
      const chartImage = canvas.toDataURL("image/png");

      // 8. Destroy chart
      chart.destroy();

      // 9. Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "DC Cable Tracking System";
      workbook.created = new Date();

      // Sheet 1: Data
      const dataSheet = workbook.addWorksheet("Daily Progress");
      dataSheet.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "+DC Cable (m)", key: "plus_dc", width: 15 },
        { header: "-DC Cable (m)", key: "minus_dc", width: 15 },
        { header: "Total Cable (m)", key: "total_cable", width: 15 },
        { header: "Workers", key: "workers", width: 10 },
        { header: "Subcontractor", key: "subcontractor", width: 20 },
      ];

      // Style header
      dataSheet.getRow(1).font = { bold: true };
      dataSheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4472C4" },
      };
      dataSheet.getRow(1).font = { color: { argb: "FFFFFFFF" }, bold: true };

      // Add data
      sorted.forEach((row) => {
        dataSheet.addRow({
          date: row.date,
          plus_dc: Math.round(row.plus_dc),
          minus_dc: Math.round(row.minus_dc),
          total_cable: Math.round(row.total_cable),
          workers: row.workers,
          subcontractor: row.subcontractor,
        });
      });

      // Add totals row
      const totalRow = dataSheet.addRow({
        date: "TOTAL",
        plus_dc: sorted.reduce((sum, r) => sum + r.plus_dc, 0),
        minus_dc: sorted.reduce((sum, r) => sum + r.minus_dc, 0),
        total_cable: sorted.reduce((sum, r) => sum + r.total_cable, 0),
        workers: "",
        subcontractor: "",
      });
      totalRow.font = { bold: true };
      totalRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9E1F2" },
      };

      // Sheet 2: Chart
      const chartSheet = workbook.addWorksheet("Chart");

      // Add chart image
      const imageId = workbook.addImage({
        base64: chartImage,
        extension: "png",
      });

      chartSheet.addImage(imageId, {
        tl: { col: 0, row: 0 },
        ext: { width: 800, height: 400 },
      });

      // 10. Generate and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const fileName = `DC_Cable_Progress_${new Date().toISOString().split("T")[0]}.xlsx`;
      saveAs(blob, fileName);

      console.log("Excel exported successfully!");
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export Excel. Check console for details.");
    }
  }, []);

  return { exportToExcel };
}

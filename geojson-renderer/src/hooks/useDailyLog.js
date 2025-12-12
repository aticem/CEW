import { useState, useEffect } from "react";

export default function useDailyLog() {
  const [dailyLog, setDailyLog] = useState([]);

  useEffect(() => {
    const stored = localStorage.getItem("dcCableDailyLog");
    if (stored) {
      try {
        setDailyLog(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse daily log:", e);
        setDailyLog([]);
      }
    }
  }, []);

  const addRecord = (record) => {
    const updated = [...dailyLog, record];
    setDailyLog(updated);
    localStorage.setItem("dcCableDailyLog", JSON.stringify(updated));
  };

  const resetLog = () => {
    if (window.confirm("Are you sure you want to clear all daily logs?")) {
      localStorage.removeItem("dcCableDailyLog");
      setDailyLog([]);
    }
  };

  return { dailyLog, addRecord, resetLog };
}

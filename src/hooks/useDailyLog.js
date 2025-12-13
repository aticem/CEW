import { useState, useEffect } from "react";

export default function useDailyLog(moduleKey = "DC") {
  const storageKey = `cew:dailyLog:${String(moduleKey || "DC").toUpperCase()}`;
  const [dailyLog, setDailyLog] = useState([]);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setDailyLog(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse daily log:", e);
        setDailyLog([]);
      }
    }
  }, [storageKey]);

  const addRecord = (record) => {
    const updated = [...dailyLog, record];
    setDailyLog(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  };

  const resetLog = () => {
    if (window.confirm("Are you sure you want to clear all daily logs?")) {
      localStorage.removeItem(storageKey);
      setDailyLog([]);
    }
  };

  return { dailyLog, addRecord, resetLog };
}

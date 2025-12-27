import { useState } from "react";

export default function useDailyLog(moduleKey = "DC") {
  // Don't persist to localStorage - history resets on page refresh (same as selections)
  const [dailyLog, setDailyLog] = useState([]);

  const addRecord = (record) => {
    const updated = [...dailyLog, record];
    setDailyLog(updated);
    // Don't save to localStorage - history should reset with page refresh
  };

  const resetLog = () => {
    if (window.confirm("Are you sure you want to clear all daily logs?")) {
      setDailyLog([]);
    }
  };

  return { dailyLog, addRecord, resetLog };
}

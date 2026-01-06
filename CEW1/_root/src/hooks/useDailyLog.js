import { useState } from "react";

export default function useDailyLog(moduleKey = "DC") {
  // Don't persist to localStorage - history resets on page refresh (same as selections)
  const [dailyLog, setDailyLog] = useState([]);

  const addRecord = (record) => {
    // Generate unique ID for the record
    const id = `${record.date}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const recordWithId = { ...record, id };
    setDailyLog(prev => [...prev, recordWithId]);
  };

  const updateRecord = (id, updates) => {
    setDailyLog(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const deleteRecord = (id) => {
    setDailyLog(prev => prev.filter(r => r.id !== id));
  };

  const resetLog = () => {
    if (window.confirm("Are you sure you want to clear all daily logs?")) {
      setDailyLog([]);
    }
  };

  return { dailyLog, addRecord, updateRecord, deleteRecord, resetLog };
}

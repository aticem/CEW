import { useState, useEffect, useCallback } from "react";

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

  // Add a new record with unique ID and optional selections
  const addRecord = useCallback((record) => {
    const newRecord = {
      ...record,
      id: record.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      selections: record.selections || [], // Array of selected feature IDs
    };
    const updated = [...dailyLog, newRecord];
    setDailyLog(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    return newRecord;
  }, [dailyLog, storageKey]);

  // Update an existing record by ID
  const updateRecord = useCallback((recordId, updates) => {
    const updated = dailyLog.map(r => 
      r.id === recordId ? { ...r, ...updates, lastModified: new Date().toISOString() } : r
    );
    setDailyLog(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  }, [dailyLog, storageKey]);

  // Delete a record by ID
  const deleteRecord = useCallback((recordId) => {
    const updated = dailyLog.filter(r => r.id !== recordId);
    setDailyLog(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  }, [dailyLog, storageKey]);

  // Update selections for a specific record
  const updateRecordSelections = useCallback((recordId, selections, newAmount) => {
    const updated = dailyLog.map(r => {
      if (r.id === recordId) {
        return {
          ...r,
          selections: selections || [],
          total_cable: newAmount !== undefined ? newAmount : r.total_cable,
          lastModified: new Date().toISOString()
        };
      }
      return r;
    });
    setDailyLog(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  }, [dailyLog, storageKey]);

  // Get a record by ID
  const getRecord = useCallback((recordId) => {
    return dailyLog.find(r => r.id === recordId) || null;
  }, [dailyLog]);

  const resetLog = () => {
    if (window.confirm("Are you sure you want to clear all daily logs?")) {
      localStorage.removeItem(storageKey);
      setDailyLog([]);
    }
  };

  return { 
    dailyLog, 
    addRecord, 
    updateRecord, 
    deleteRecord, 
    updateRecordSelections,
    getRecord,
    resetLog 
  };
}

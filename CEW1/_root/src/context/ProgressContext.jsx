/**
 * Progress Context
 * 
 * Allows BaseModule to share real-time progress data with AIAssistant.
 * This enables context-aware AI responses based on what the user sees on screen.
 */
import { createContext, useContext, useState, useCallback } from 'react';

const ProgressContext = createContext(null);

export function ProgressProvider({ children }) {
  const [progressData, setProgressData] = useState({
    module: null,
    total: null,
    completed: null,
    remaining: null,
    unit: null,
    percentage: null,
    additionalData: {},
  });

  const updateProgress = useCallback((data) => {
    setProgressData(prev => ({
      ...prev,
      ...data,
      // Calculate percentage if total and completed are provided
      percentage: data.total && data.completed 
        ? ((data.completed / data.total) * 100).toFixed(1)
        : prev.percentage,
    }));
  }, []);

  const clearProgress = useCallback(() => {
    setProgressData({
      module: null,
      total: null,
      completed: null,
      remaining: null,
      unit: null,
      percentage: null,
      additionalData: {},
    });
  }, []);

  return (
    <ProgressContext.Provider value={{ progressData, updateProgress, clearProgress }}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress() {
  const context = useContext(ProgressContext);
  if (!context) {
    // Return a no-op version if used outside provider
    return {
      progressData: {},
      updateProgress: () => {},
      clearProgress: () => {},
    };
  }
  return context;
}

export default ProgressContext;

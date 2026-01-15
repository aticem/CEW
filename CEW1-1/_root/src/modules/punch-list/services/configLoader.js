/**
 * Configuration Loader Service
 * Loads contractors and disciplines from TXT files and syncs to IndexedDB.
 * Assigns unique colors to contractors for map markers and legend.
 */

import db from './db.js';

// Predefined color palette for contractors (visually distinct colors)
const COLOR_PALETTE = [
    '#E53935', // Red
    '#1E88E5', // Blue
    '#43A047', // Green
    '#FB8C00', // Orange
    '#8E24AA', // Purple
    '#00ACC1', // Cyan
    '#F4511E', // Deep Orange
    '#3949AB', // Indigo
    '#7CB342', // Light Green
    '#FFB300', // Amber
    '#5E35B1', // Deep Purple
    '#00897B', // Teal
    '#C0CA33', // Lime
    '#D81B60', // Pink
    '#039BE5', // Light Blue
    '#6D4C41', // Brown
    '#546E7A', // Blue Grey
    '#757575', // Grey
];

/**
 * Fetches and parses a TXT file, returning an array of non-empty lines.
 * @param {string} filePath - Path to the TXT file
 * @returns {Promise<string[]>}
 */
async function fetchTxtFile(filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            console.warn(`Could not fetch ${filePath}: ${response.statusText}`);
            return [];
        }
        const text = await response.text();
        return text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
    } catch (error) {
        console.error(`Error fetching ${filePath}:`, error);
        return [];
    }
}

/**
 * Loads contractors from TXT file and syncs to IndexedDB.
 * Assigns colors to new contractors while preserving existing color assignments.
 * @returns {Promise<Array>} Array of contractor objects with id, name, and color
 */
export async function loadContractors() {
    const lines = await fetchTxtFile('/PUNCH_LIST/contractors.txt');

    // Get existing contractors from DB
    const existingContractors = await db.getAllContractors();
    // Map by normalized name for ID/Color preservation
    const existingByName = new Map(
        existingContractors.map(c => [c.name.toLowerCase().trim(), c])
    );

    // Get used colors
    const usedColors = new Set(existingContractors.map(c => c.color));

    const finalContractors = [];
    const processedNames = new Set();

    // 1. Process TXT contractors (preserve ID/Color if exists, else create new)
    lines.forEach((name, index) => {
        const normName = name.toLowerCase().trim();
        if (!normName) return;

        processedNames.add(normName);

        let contractor = existingByName.get(normName);

        if (contractor) {
            // Update casing to match TXT if it changed, but keep ID and Color
            contractor = { ...contractor, name: name.trim() };
        } else {
            // New contractor from TXT
            let color = null;
            // Find first unused color from palette
            for (const paletteColor of COLOR_PALETTE) {
                if (!usedColors.has(paletteColor)) {
                    color = paletteColor;
                    usedColors.add(paletteColor);
                    break;
                }
            }
            if (!color) {
                color = `hsl(${(index * 137.5) % 360}, 70%, 50%)`;
            }

            // Generate stable-ish ID if possible, or random
            // Using a prefix to distinguish config-loaded ones can be helpful but not strictly necessary
            const safeName = normName.replace(/[^a-z0-9]/g, '_');
            const newId = `contractor_cfg_${safeName}_${Math.random().toString(36).substr(2, 4)}`;

            contractor = {
                id: newId,
                name: name.trim(),
                color: color
            };
        }
        finalContractors.push(contractor);
    });

    // 2. Strict Mode: Do NOT append user-added contractors.
    // The TXT file is the single source of truth.

    // Save to IndexedDB
    await db.clearContractors();
    await db.saveContractors(finalContractors);

    return finalContractors;
}

/**
 * Loads disciplines from TXT file and syncs to IndexedDB.
 * @returns {Promise<Array>} Array of discipline objects with id and name
 */
export async function loadDisciplines() {
    const lines = await fetchTxtFile('/PUNCH_LIST/types.txt');

    const disciplines = lines.map((name, index) => ({
        id: `discipline-${index}`,
        name: name,
    }));

    // Save to IndexedDB
    await db.clearDisciplines();
    await db.saveDisciplines(disciplines);

    return disciplines;
}

/**
 * Loads both contractors and disciplines.
 * Call this on module initialization.
 * @returns {Promise<{contractors: Array, disciplines: Array}>}
 */
export async function loadConfig() {
    const [contractors, disciplines] = await Promise.all([
        loadContractors(),
        loadDisciplines(),
    ]);

    return { contractors, disciplines };
}

export default {
    loadContractors,
    loadDisciplines,
    loadConfig,
    fetchTxtFile,
};

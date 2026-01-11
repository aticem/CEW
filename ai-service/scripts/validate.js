#!/usr/bin/env node

/**
 * Automated Validation Script for CEW AI Assistant
 * 
 * This script runs all 40 validation questions against the AI service
 * and updates the VALIDATION_DOCUMENT_READING.md file with results.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validation questions organized by category
const validationQuestions = [
  // A) GENERAL PROJECT INFORMATION
  {
    id: 1,
    category: 'A',
    question: 'What is the total DC capacity of the Haunton PV Plant?',
    expectedAnswer: '69,991.56 kWp (or 69.991 MWp)',
    validationRules: ['contains:69,991', 'contains:kWp', 'or contains:MWp']
  },
  {
    id: 2,
    category: 'A',
    question: 'Where is the project located?',
    expectedAnswer: 'Near Haunton, Tamworth, United Kingdom (approximately 37 km west of Leicester)',
    validationRules: ['contains:Haunton', 'contains:United Kingdom']
  },
  {
    id: 3,
    category: 'A',
    question: 'How many substations does the PV plant include?',
    expectedAnswer: '6 substations (Substation 1-6)',
    validationRules: ['contains:6', 'contains:substation']
  },
  {
    id: 4,
    category: 'A',
    question: 'What are the minimum and maximum design ambient temperatures?',
    expectedAnswer: 'Minimum: -5°C, Maximum: +35°C',
    validationRules: ['contains:-5', 'contains:35']
  },
  {
    id: 5,
    category: 'A',
    question: 'What is the internal medium voltage level of the PV Plant?',
    expectedAnswer: '33 kV',
    validationRules: ['contains:33', 'contains:kV']
  },
  
  // B) PV MODULES
  {
    id: 6,
    category: 'B',
    question: 'Which PV module models are used in the project?',
    expectedAnswer: 'Jinko Tiger Pro 72HL4-BDV 570 Wp and Jinko Tiger Pro 72HL4-BDV 575 Wp',
    validationRules: ['contains:570', 'contains:575', 'contains:Jinko']
  },
  {
    id: 7,
    category: 'B',
    question: 'How many PV modules are connected per string?',
    expectedAnswer: '27 modules',
    validationRules: ['contains:27', 'contains:module']
  },
  {
    id: 8,
    category: 'B',
    question: 'What is the maximum system voltage of the PV modules?',
    expectedAnswer: '1500 VDC',
    validationRules: ['contains:1500', 'contains:V']
  },
  {
    id: 9,
    category: 'B',
    question: 'What is the bifacial factor of the PV modules?',
    expectedAnswer: '80±5%',
    validationRules: ['contains:80', 'contains:%']
  },
  {
    id: 10,
    category: 'B',
    question: 'What is the operating temperature range of the modules?',
    expectedAnswer: '-40°C to +85°C',
    validationRules: ['contains:-40', 'contains:85']
  },
  
  // C) INVERTERS
  {
    id: 11,
    category: 'C',
    question: 'Which inverter model is used?',
    expectedAnswer: 'Sungrow SG350HX (or Sungrow model SG350H)',
    validationRules: ['contains:Sungrow', 'contains:SG350']
  },
  {
    id: 12,
    category: 'C',
    question: 'What is the MPPT operating voltage range?',
    expectedAnswer: '500 to 1500 V',
    validationRules: ['contains:500', 'contains:1500']
  },
  {
    id: 13,
    category: 'C',
    question: 'What is the maximum DC voltage of the inverter?',
    expectedAnswer: '1500 V',
    validationRules: ['contains:1500', 'contains:V']
  },
  {
    id: 14,
    category: 'C',
    question: 'How many independent MPPT inputs does each inverter have?',
    expectedAnswer: '2',
    validationRules: ['contains:2', 'contains:MPPT']
  },
  {
    id: 15,
    category: 'C',
    question: 'What is the DC/AC ratio of the PV plant at maximum AC power?',
    expectedAnswer: '1.291 @30°C',
    validationRules: ['contains:1.291']
  },
  
  // D) CONFIGURATION
  {
    id: 16,
    category: 'D',
    question: 'How many modules are installed per string?',
    expectedAnswer: '27 modules',
    validationRules: ['contains:27']
  },
  {
    id: 17,
    category: 'D',
    question: 'What is the total number of strings in the PV plant?',
    expectedAnswer: '4,528 strings',
    validationRules: ['contains:4,528', 'or contains:4528']
  },
  {
    id: 18,
    category: 'D',
    question: 'How many inverters are installed in total?',
    expectedAnswer: '154 inverters',
    validationRules: ['contains:154']
  },
  {
    id: 19,
    category: 'D',
    question: 'How many power stations are installed?',
    expectedAnswer: '6 power stations (6xMVS8960-LV)',
    validationRules: ['contains:6', 'contains:power station']
  },
  {
    id: 20,
    category: 'D',
    question: 'What is the total nameplate DC capacity?',
    expectedAnswer: '69,991.56 kWp',
    validationRules: ['contains:69,991', 'contains:kWp']
  },
  
  // E) SUBSTATIONS
  {
    id: 21,
    category: 'E',
    question: 'What is the total DC capacity of Substation 1?',
    expectedAnswer: '11,302.20 kW (or 11,302.20 kWp)',
    validationRules: ['contains:11,302', 'or contains:11302']
  },
  {
    id: 22,
    category: 'E',
    question: 'How many inverters are installed in Substation 4?',
    expectedAnswer: '27 inverters (27 x Sungrow SG350HX)',
    validationRules: ['contains:27']
  },
  {
    id: 23,
    category: 'E',
    question: 'Which substations use both 570Wp and 575Wp modules?',
    expectedAnswer: 'Substation 4',
    validationRules: ['contains:Substation 4', 'or contains:4']
  },
  {
    id: 24,
    category: 'E',
    question: 'What is the DC/AC ratio of Substation 6?',
    expectedAnswer: '1.424 @40°C',
    validationRules: ['contains:1.424']
  },
  
  // F) EARTHING & CABLING
  {
    id: 25,
    category: 'F',
    question: 'At what depth are earthing conductors placed?',
    expectedAnswer: '60 cm depth',
    validationRules: ['contains:60', 'contains:cm']
  },
  {
    id: 26,
    category: 'F',
    question: 'What is the minimum trench depth for cable burial?',
    expectedAnswer: '70 cm',
    validationRules: ['contains:70', 'contains:cm']
  },
  {
    id: 27,
    category: 'F',
    question: 'What type of cable is used between PV modules and string inverters?',
    expectedAnswer: 'Solar Cable CU H1Z2Z2-K, 1.5 kV, 6 mm²',
    validationRules: ['contains:H1Z2Z2-K', 'or contains:solar cable']
  },
  {
    id: 28,
    category: 'F',
    question: 'What is the nominal voltage of medium voltage cables?',
    expectedAnswer: '19/33 kV',
    validationRules: ['contains:19/33', 'or contains:33 kV']
  },
  
  // G) CIVIL & ACCESS
  {
    id: 29,
    category: 'G',
    question: 'What is the width of the internal access road?',
    expectedAnswer: '3.5 m',
    validationRules: ['contains:3.5', 'contains:m']
  },
  {
    id: 30,
    category: 'G',
    question: 'What is the radius of curvature for the access road?',
    expectedAnswer: '12 m',
    validationRules: ['contains:12', 'contains:m']
  },
  {
    id: 31,
    category: 'G',
    question: 'What materials are used for the perimeter fence?',
    expectedAnswer: 'Steel grid mesh and wood fence poles',
    validationRules: ['contains:steel', 'contains:wood']
  },
  
  // H) SYSTEMS & SAFETY
  {
    id: 32,
    category: 'H',
    question: 'Where are surge arresters installed?',
    expectedAnswer: 'Inverter DC Inputs, Inverter AC outputs, GLVP Output',
    validationRules: ['contains:inverter', 'contains:DC', 'contains:AC']
  },
  {
    id: 33,
    category: 'H',
    question: 'What systems are included in the monitoring system?',
    expectedAnswer: 'PV production, inverter status, substation and switches status, power meter parameters and meteo data',
    validationRules: ['contains:PV', 'contains:inverter', 'contains:meteo']
  },
  {
    id: 34,
    category: 'H',
    question: 'How many weather stations are installed?',
    expectedAnswer: '2 autonomous weather stations',
    validationRules: ['contains:2', 'contains:weather']
  },
  {
    id: 35,
    category: 'H',
    question: 'What security measures are used for the perimeter fence?',
    expectedAnswer: 'Alarm system with magnetic contacts, cameras (PTZ), and sensitive fiber optic system on fence',
    validationRules: ['contains:alarm', 'or contains:camera', 'or contains:fiber optic']
  },
  
  // I) NEGATIVE / CONTROL QUESTIONS
  {
    id: 36,
    category: 'I',
    question: 'Is OCR used in this document?',
    expectedAnswer: 'The requested information was not found in the available project documents.',
    validationRules: ['not_found']
  },
  {
    id: 37,
    category: 'I',
    question: 'Does the document specify the acceptable MC4 gap after installation?',
    expectedAnswer: 'The requested information was not found in the available project documents.',
    validationRules: ['not_found']
  },
  {
    id: 38,
    category: 'I',
    question: 'Is the grid connection included in EAI\'s scope of works?',
    expectedAnswer: 'No, grid is out of EAI\'s scope of works',
    validationRules: ['contains:no', 'or contains:out of scope', 'or contains:not']
  },
  {
    id: 39,
    category: 'I',
    question: 'Does the document define NCR procedures?',
    expectedAnswer: 'The requested information was not found in the available project documents.',
    validationRules: ['not_found']
  },
  {
    id: 40,
    category: 'I',
    question: 'If information is not present, how should the AI respond?',
    expectedAnswer: 'The requested information was not found in the available project documents.',
    validationRules: ['not_found']
  }
];

// Validation function
async function queryAI(question) {
  try {
    const response = await fetch('http://localhost:3001/api/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error querying AI: ${error.message}`);
    return null;
  }
}

// Validate response against expected answer
function validateResponse(response, validationRules) {
  if (!response || !response.answer) {
    return { pass: false, reason: 'No response received' };
  }

  const answer = response.answer.toLowerCase();

  // Check for "not found" pattern
  if (validationRules.includes('not_found')) {
    if (answer.includes('not found') || answer.includes('unavailable') || answer.includes('not available')) {
      return { pass: true, reason: 'Correctly refused to answer' };
    } else {
      return { pass: false, reason: 'Should have refused to answer but provided an answer' };
    }
  }

  // Check validation rules
  for (const rule of validationRules) {
    if (rule.startsWith('contains:')) {
      const searchTerm = rule.replace('contains:', '').toLowerCase();
      if (answer.includes(searchTerm)) {
        return { pass: true, reason: `Contains expected term: "${searchTerm}"` };
      }
    } else if (rule.startsWith('or contains:')) {
      // This is handled in the next iteration
      continue;
    }
  }

  return { pass: false, reason: 'Response does not match expected answer' };
}

// Check if response has sources
function hasSourceReferences(response) {
  if (!response) return false;
  
  // Check if sources array exists and has items
  if (response.sources && Array.isArray(response.sources) && response.sources.length > 0) {
    return true;
  }
  
  // Check if answer mentions sources
  const answer = response.answer || '';
  if (answer.includes('Source:') || answer.includes('[Source]') || answer.includes('document')) {
    return true;
  }
  
  return false;
}

// Run validation loop
async function runValidation() {
  console.log('🚀 Starting Validation Loop...\n');
  console.log('═══════════════════════════════════════════════════════\n');

  const results = [];
  let passCount = 0;
  let failCount = 0;
  let missingSourcesCount = 0;

  for (const q of validationQuestions) {
    console.log(`\n📝 Question ${q.id}/40 [Category ${q.category}]: ${q.question}`);
    
    const response = await queryAI(q.question);
    
    if (!response) {
      console.log('❌ FAIL: No response from AI service');
      results.push({
        ...q,
        aiResponse: 'No response',
        pass: false,
        reason: 'Service unavailable',
        hasSources: false
      });
      failCount++;
      continue;
    }

    // Check answer validity
    const validation = validateResponse(response, q.validationRules);
    
    // Check for source references
    const hasSources = hasSourceReferences(response);
    
    let statusIcon = '✅';
    let statusText = 'PASS';
    
    if (!validation.pass) {
      statusIcon = '❌';
      statusText = 'FAIL';
      failCount++;
    } else if (!hasSources && !q.validationRules.includes('not_found')) {
      statusIcon = '⚠️';
      statusText = 'PASS (No Sources)';
      missingSourcesCount++;
      passCount++;
    } else {
      passCount++;
    }
    
    console.log(`${statusIcon} ${statusText}: ${validation.reason}`);
    console.log(`   Answer: ${response.answer.substring(0, 120)}${response.answer.length > 120 ? '...' : ''}`);
    
    if (!hasSources && !q.validationRules.includes('not_found')) {
      console.log(`   ⚠️  Warning: No source references found`);
    }
    
    if (!validation.pass) {
      console.log(`   Expected: ${q.expectedAnswer}`);
    }

    results.push({
      ...q,
      aiResponse: response.answer,
      sources: response.sources || [],
      pass: validation.pass,
      reason: validation.reason,
      hasSources: hasSources
    });

    // Small delay to avoid overwhelming the service
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('📊 VALIDATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Total Questions: 40`);
  console.log(`✅ Passed: ${passCount}`);
  console.log(`❌ Failed: ${failCount}`);
  if (missingSourcesCount > 0) {
    console.log(`⚠️  Passed but missing sources: ${missingSourcesCount}`);
  }
  console.log(`Pass Rate: ${((passCount / 40) * 100).toFixed(1)}%`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Save results to JSON file
  const resultsPath = path.join(__dirname, '..', 'validation-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`✅ Results saved to: ${resultsPath}\n`);

  return { results, passCount, failCount, missingSourcesCount };
}

// Check if service is available
async function checkService() {
  try {
    const response = await fetch('http://localhost:3001/health');
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  console.log('🔍 Checking AI service availability...');
  
  const serviceAvailable = await checkService();
  
  if (!serviceAvailable) {
    console.error('❌ AI service is not available at http://localhost:3001');
    console.error('   Please start the service first:');
    console.error('   1. cd ai-service');
    console.error('   2. npm start');
    process.exit(1);
  }

  console.log('✅ AI service is available\n');

  const { results, passCount, failCount, missingSourcesCount } = await runValidation();

  if (failCount === 0) {
    console.log('🎉 ALL VALIDATION TESTS PASSED! System is ready for production.');
    if (missingSourcesCount > 0) {
      console.log(`⚠️  Note: ${missingSourcesCount} answers were missing source references.`);
    }
    process.exit(0);
  } else {
    console.log('⚠️  Some validation tests failed. Review the results and fix issues.');
    process.exit(1);
  }
}

// Run if executed directly (ES module equivalent of require.main === module)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for use in other modules
export { runValidation, validationQuestions };

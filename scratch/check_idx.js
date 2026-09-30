const fs = require('fs');
const code = fs.readFileSync('scratch/spatial_queries_gen.ts', 'utf8');
const lines = code.split('\n');

let insideClass = false;
let currentFunction = '';
let currentParams = '';

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('export class SpatialIndex')) insideClass = true;
  if (insideClass && line.startsWith('}')) insideClass = false;
  
  if (line.startsWith('function ')) {
    currentFunction = line;
    currentParams = '';
    let j = i;
    while (j < lines.length && !lines[j].includes('{')) {
      currentParams += lines[j] + ' ';
      j++;
    }
  }

  if (!insideClass) {
    const match = line.match(/\bidx\b/);
    if (match) {
      if (!currentParams.includes('idx:') && !line.includes('const idx') && !line.includes('let idx') && !line.includes('idx:')) {
        console.log(`Line ${i + 1}: ${line.trim()} (in fn: ${currentFunction.slice(0, 40)})`);
      }
    }
  }
}

const fs = require('fs');
const path = require('path');

const reportPath = path.resolve(__dirname, '../notes-excel-analysis-report.json');
const outputPath = path.resolve(__dirname, '../notes-excel-analysis-summary.md');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const lines = [];
lines.push('# Analyse notes-excel');
lines.push('');
lines.push(`- Fichiers scannés: ${report.totalFiles}`);
lines.push(`- Fichiers lus: ${report.successfullyParsed}`);
lines.push(`- Templates détectés: ${report.principal.length}`);
lines.push('');
lines.push('## Tableau principal');
lines.push('');
lines.push('| niveau | matière | codeMatière | semestre | composantes | nbFichiers |');
lines.push('|---|---|---|---|---|---|');
for (const row of report.principal) {
  const matiere = String(row.matiere || '').replace(/\|/g, '/');
  const composantes = (row.composantes || []).join(' ; ').replace(/\|/g, '/');
  lines.push(`| ${row.niveau || ''} | ${matiere} | ${row.codeMatiere || ''} | ${row.semestre || ''} | ${composantes} | ${row.nbFichiers || 0} |`);
}

lines.push('');
lines.push('## Anomalies');
lines.push('');
lines.push(`- Fichiers illisibles: ${report.anomalies.unreadableFiles.length}`);
for (const item of report.anomalies.unreadableFiles) {
  lines.push(`  - ${item.file}: ${item.error}`);
}
lines.push(`- Matière introuvable: ${report.anomalies.matiereIntrouvable.length}`);
for (const item of report.anomalies.matiereIntrouvable) {
  lines.push(`  - ${item}`);
}
lines.push(`- Composantes non détectées: ${report.anomalies.composantesNonDetectees.length}`);
for (const item of report.anomalies.composantesNonDetectees) {
  lines.push(`  - ${item}`);
}
lines.push(`- Structures différentes (même niveau+matière+semestre): ${report.anomalies.structureDifferente.length}`);
for (const item of report.anomalies.structureDifferente) {
  lines.push(`  - ${item.niveau} | ${item.matiere} | ${item.codeMatiere || ''} | ${item.semestre}`);
  for (const variant of item.variants || []) {
    lines.push(`    - (${variant.nbFichiers} fichiers) ${(variant.composantes || []).join(' ; ')}`);
  }
}

lines.push('');
lines.push('## templatesProposes (JSON)');
lines.push('');
lines.push('```json');
lines.push(JSON.stringify(report.templatesProposes, null, 2));
lines.push('```');

lines.push('');
lines.push('## Recommandation finale');
lines.push('');
lines.push(`- Structures stables (prêtes à industrialiser): ${report.recommandations.structuresStables.length}`);
for (const item of report.recommandations.structuresStables) {
  lines.push(`  - ${item.niveau} | ${item.matiere} | ${item.codeMatiere || ''} | ${item.semestre}`);
}
lines.push(`- Structures à normaliser manuellement: ${report.recommandations.normalisationManuelle.length}`);
for (const item of report.recommandations.normalisationManuelle) {
  lines.push(`  - ${item.niveau} | ${item.matiere} | ${item.codeMatiere || ''} | ${item.semestre}`);
}

fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
console.log('WROTE', outputPath);

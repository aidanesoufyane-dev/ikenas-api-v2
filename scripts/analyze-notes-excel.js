const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '../../notes-excel');
const exts = new Set(['.xlsx', '.xls', '.csv']);

const normalize = (s) => String(s || '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const normKey = (s) => normalize(s).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const containsAny = (s, arr) => {
  const t = normKey(s);
  return arr.some((k) => t.includes(normKey(k)));
};

const identityKeywords = [
  'id', 'nom', 'prenom', 'élève', 'eleve', 'التلميذ', 'رقم', 'matricule', 'date',
  'naissance', 'classe', 'section', 'code', 'numéro', 'numero', 'اسم'
];
const noteKeywords = ['النقطة', 'note', 'point', 'score'];
const absenceKeywords = ['التغيب', 'غياب', 'absence', 'abs'];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (exts.has(path.extname(entry.name).toLowerCase())) out.push(p);
  }
  return out;
}

function inferFromPath(filePath) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  const parts = rel.split('/');
  const filename = parts[parts.length - 1];
  const whole = `${rel} ${filename}`;

  const nivMatch = whole.match(/\b([1-9]\s*APG)\b/i);
  const niveau = nivMatch ? nivMatch[1].replace(/\s+/g, '').toUpperCase() : null;

  const classMatch = whole.match(/\b([1-9]APG-\d)\b/i);
  const codeClasse = classMatch ? classMatch[1].toUpperCase() : null;

  const codeSubjMatch = filename.match(/_(\d{3,4})(?:\D|$)/);
  const codeMatiere = codeSubjMatch ? codeSubjMatch[1] : null;

  return { rel, filename, niveau, codeClasse, codeMatiere };
}

function detectSemester(rows) {
  const text = rows.slice(0, 14).flat().map(normalize).join(' | ');
  const t = normKey(text);
  if (
    t.includes('s2') ||
    t.includes('semestre 2') ||
    t.includes('الدورة الثانية') ||
    t.includes('deuxieme') ||
    t.includes('deuxième')
  ) return 'S2';

  if (
    t.includes('s1') ||
    t.includes('semestre 1') ||
    t.includes('الدورة الأولى') ||
    t.includes('premiere') ||
    t.includes('première')
  ) return 'S1';

  return null;
}

function findSubjectName(rows) {
  const maxRows = Math.min(rows.length, 15);
  for (let r = 0; r < maxRows; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = normalize(row[c]);
      if (!cell) continue;

      if (containsAny(cell, ['المادة', 'matiere', 'matière', 'subject'])) {
        for (let k = c + 1; k < Math.min(row.length, c + 10); k++) {
          const cand = normalize(row[k]);
          if (cand && !cand.includes('#')) return cand;
        }
      }
    }
  }
  return null;
}

function detectHeaderRow(rows) {
  let best = { idx: -1, score: -1 };
  const lim = Math.min(22, rows.length);

  for (let i = 0; i < lim; i++) {
    const row = (rows[i] || []).map(normalize);
    const nonEmpty = row.filter(Boolean);
    if (nonEmpty.length < 4) continue;

    let score = nonEmpty.length;
    const hasIdentity = nonEmpty.some((v) => containsAny(v, identityKeywords));
    if (hasIdentity) score += 20;

    const likelyComponents = nonEmpty.filter((v) =>
      containsAny(v, ['devoir', 'oral', 'examen', 'activité', 'activite', 'lecture', 'grammaire', 'projet', 'dictée', 'ecriture', 'lexique', 'conjugaison', 'الإملاء', 'القراءة', 'التعبير'])
    ).length;
    score += likelyComponents * 2;

    if (score > best.score) best = { idx: i, score };
  }

  return best.idx;
}

function extractComponents(rows, headerIdx) {
  if (headerIdx < 0) return [];

  const h1 = (rows[headerIdx] || []).map(normalize);
  const h2 = (rows[headerIdx + 1] || []).map(normalize);
  const dataStart = headerIdx + 2;

  const components = [];

  for (let c = 0; c < h1.length; c++) {
    const main = h1[c];
    const sub = h2[c] || '';
    if (!main && !sub) continue;

    if (containsAny(main, identityKeywords)) continue;
    if (containsAny(sub, absenceKeywords)) continue;

    const isNoteCol = containsAny(sub, noteKeywords) || (!sub && !containsAny(main, identityKeywords));
    if (!isNoteCol) continue;

    const label = normalize(main);
    if (!label) continue;

    if (!components.includes(label)) components.push(label);
  }

  if (components.length > 0) return components;

  for (let c = 0; c < h1.length; c++) {
    const label = normalize(h1[c]);
    if (!label || containsAny(label, identityKeywords)) continue;

    let total = 0;
    let nums = 0;

    for (let r = dataStart; r < Math.min(rows.length, dataStart + 30); r++) {
      const value = rows[r]?.[c];
      if (value === '' || value === null || value === undefined) continue;
      total += 1;

      const n = Number(String(value).replace(',', '.'));
      if (!Number.isNaN(n)) nums += 1;
    }

    if (total > 0 && nums / total >= 0.4) components.push(label);
  }

  return [...new Set(components.map(normalize).filter(Boolean))];
}

function proposedRule(components) {
  if (!components || components.length === 0) {
    return {
      type: 'note_directe',
      formula: 'noteFinale = scoreDirect',
    };
  }

  if (components.length === 1) {
    return {
      type: 'mono_composante',
      formula: `noteFinale = ${components[0]}`,
    };
  }

  return {
    type: 'moyenne_ponderee',
    formula: 'noteFinale = somme(note_i * poids_i) / somme(poids_i)',
    defaultWeights: components.map((component) => ({ component, weight: 1 })),
  };
}

function main() {
  const files = walk(root);
  const anomalies = {
    unreadableFiles: [],
    matiereIntrouvable: [],
    composantesNonDetectees: [],
    structureDifferente: [],
  };

  const records = [];

  for (const file of files) {
    const infer = inferFromPath(file);

    try {
      const workbook = XLSX.readFile(file, { cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        blankrows: false,
      });

      const subjectName = findSubjectName(rows);
      const semester = detectSemester(rows);
      const headerIdx = detectHeaderRow(rows);
      const components = extractComponents(rows, headerIdx);

      if (!subjectName) anomalies.matiereIntrouvable.push(infer.rel);
      if (!components.length) anomalies.composantesNonDetectees.push(infer.rel);

      records.push({
        file: infer.rel,
        niveau: infer.niveau,
        codeClasse: infer.codeClasse,
        codeMatiere: infer.codeMatiere,
        matiere: subjectName || null,
        semestre: semester,
        composantes: components,
      });
    } catch (error) {
      anomalies.unreadableFiles.push({ file: infer.rel, error: error.message });
    }
  }

  const byTemplate = new Map();
  const baseGroup = new Map();

  for (const record of records) {
    const matiereLabel = record.matiere || (record.codeMatiere ? `Code ${record.codeMatiere}` : 'Matière inconnue');
    const baseKey = [record.niveau || 'N/A', matiereLabel, record.codeMatiere || 'N/A', record.semestre || 'ND'].join('|');
    const compKey = record.composantes.map(normKey).join('||') || '__none__';
    const templateKey = `${baseKey}|${compKey}`;

    if (!byTemplate.has(templateKey)) {
      byTemplate.set(templateKey, {
        niveau: record.niveau || 'N/A',
        matiere: matiereLabel,
        codeMatiere: record.codeMatiere || null,
        semestre: record.semestre || 'ND',
        composantes: record.composantes,
        nbFichiers: 0,
      });
    }

    byTemplate.get(templateKey).nbFichiers += 1;

    if (!baseGroup.has(baseKey)) baseGroup.set(baseKey, new Set());
    baseGroup.get(baseKey).add(compKey);
  }

  for (const [baseKey, variants] of baseGroup.entries()) {
    if (variants.size > 1) {
      const [niveau, matiere, codeMatiere, semestre] = baseKey.split('|');
      const variantRows = [...byTemplate.values()]
        .filter((t) => t.niveau === niveau && t.matiere === matiere && (t.codeMatiere || 'N/A') === codeMatiere && t.semestre === semestre)
        .map((t) => ({ composantes: t.composantes, nbFichiers: t.nbFichiers }));

      anomalies.structureDifferente.push({
        niveau,
        matiere,
        codeMatiere: codeMatiere === 'N/A' ? null : codeMatiere,
        semestre,
        variants: variantRows,
      });
    }
  }

  const principal = [...byTemplate.values()]
    .sort((a, b) => (a.niveau + a.matiere + a.semestre).localeCompare(b.niveau + b.matiere + b.semestre, 'fr'))
    .map((template) => ({
      niveau: template.niveau,
      matiere: template.matiere,
      codeMatiere: template.codeMatiere,
      semestre: template.semestre,
      composantes: template.composantes,
      nbFichiers: template.nbFichiers,
    }));

  const templatesProposes = principal.map((row) => ({
    niveau: row.niveau,
    matiere: row.matiere,
    codeMatiere: row.codeMatiere,
    semestre: row.semestre,
    composantes: row.composantes,
    regleCalculProposee: proposedRule(row.composantes),
  }));

  const stableKeys = new Set(
    [...baseGroup.entries()].filter(([, v]) => v.size === 1).map(([k]) => k)
  );

  const structuresStables = [];
  const normalisationManuelle = [];

  for (const [baseKey] of baseGroup.entries()) {
    const [niveau, matiere, codeMatiere, semestre] = baseKey.split('|');
    const entry = {
      niveau,
      matiere,
      codeMatiere: codeMatiere === 'N/A' ? null : codeMatiere,
      semestre,
    };

    if (stableKeys.has(baseKey)) structuresStables.push(entry);
    else normalisationManuelle.push(entry);
  }

  const report = {
    scannedAt: new Date().toISOString(),
    root: path.relative(path.resolve(__dirname, '..', '..'), root).replace(/\\/g, '/'),
    totalFiles: files.length,
    successfullyParsed: records.length,
    principal,
    anomalies,
    templatesProposes,
    recommandations: {
      structuresStables,
      normalisationManuelle,
    },
  };

  const outputPath = path.resolve(__dirname, '../notes-excel-analysis-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('REPORT_PATH', outputPath);
  console.log('TOTAL_FILES', report.totalFiles);
  console.log('PARSED_FILES', report.successfullyParsed);
  console.log('PRINCIPAL_ROWS', report.principal.length);
  console.log('ANOMALIES', JSON.stringify({
    unreadableFiles: report.anomalies.unreadableFiles.length,
    matiereIntrouvable: report.anomalies.matiereIntrouvable.length,
    composantesNonDetectees: report.anomalies.composantesNonDetectees.length,
    structureDifferente: report.anomalies.structureDifferente.length,
  }));
}

main();

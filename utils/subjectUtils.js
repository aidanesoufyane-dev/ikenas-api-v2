const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const isPhysicalEducationSubject = (subject) => {
  const name = String(subject?.name || '').toLowerCase();
  const text = normalizeText([subject?.name, subject?.code].filter(Boolean).join(' '));
  return text.includes('education physique')
    || text.includes('physical education')
    || text.includes('eps')
    || name.includes('التربية البدنية')
    || name.includes('التربية الرياضية');
};

module.exports = {
  normalizeText,
  isPhysicalEducationSubject,
};

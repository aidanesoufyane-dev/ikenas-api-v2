const DEFAULT_COMPONENT_MAX_SCORE = 10;

const toNumber = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundScore = (value) => {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
};

const normalizeComponents = (components = [], fallbackMaxScore = DEFAULT_COMPONENT_MAX_SCORE) => {
  if (!Array.isArray(components)) {
    return [];
  }

  return components
    .map((component, index) => {
      const name = String(component?.name || component?.label || '').trim();
      const maxScore = toNumber(component?.maxScore) || fallbackMaxScore;
      const weight = toNumber(component?.weight);
      const score = toNumber(component?.score);

      return {
        key: String(component?.key || name || `component-${index + 1}`).trim(),
        name: name || `Composante ${index + 1}`,
        maxScore: maxScore > 0 ? maxScore : fallbackMaxScore,
        weight: weight !== null && weight > 0 ? weight : null,
        score,
      };
    })
    .filter((component) => component.name);
};

const computeScoreFromComponents = ({ components = [], finalMaxScore }) => {
  // Barème toujours fixé à 10
  const normalizedComponents = normalizeComponents(components, 10);

  if (normalizedComponents.length === 0) {
    return {
      components: [],
      hasComponents: false,
      isComplete: false,
      score: null,
      completionRate: 0,
    };
  }

  const completedComponents = normalizedComponents.filter((component) => component.score !== null);
  const isComplete = completedComponents.length === normalizedComponents.length;
  const completionRate = normalizedComponents.length > 0
    ? roundScore((completedComponents.length / normalizedComponents.length) * 100)
    : 0;

  if (!isComplete) {
    return {
      components: normalizedComponents,
      hasComponents: true,
      isComplete: false,
      score: null,
      completionRate,
    };
  }

  const normalizedValue = normalizedComponents.reduce((sum, component) => {
    const ratio = component.maxScore > 0 ? component.score / component.maxScore : 0;
    return sum + ratio;
  }, 0);

  const score = normalizedComponents.length > 0
    ? roundScore((normalizedValue / normalizedComponents.length) * 10)
    : null;

  return {
    components: normalizedComponents,
    hasComponents: true,
    isComplete: true,
    score,
    completionRate,
  };
};

const buildResultPayload = ({ score, maxScore, components = [] }) => {
  const directScore = toNumber(score);
  // Barème toujours fixé à 10
  const normalizedMaxScore = 10;
  const computed = computeScoreFromComponents({ components, finalMaxScore: 10 });

  if (computed.hasComponents) {
    return {
      score: computed.score,
      maxScore: normalizedMaxScore,
      components: computed.components,
      hasComponents: true,
      isComplete: computed.isComplete,
      completionRate: computed.completionRate,
    };
  }

  return {
    score: directScore,
    maxScore: normalizedMaxScore,
    components: [],
    hasComponents: false,
    isComplete: directScore !== null,
    completionRate: directScore !== null ? 100 : 0,
  };
};

const computeResultStats = (results = [], passThreshold) => {
  const scores = results
    .map((result) => toNumber(result?.score))
    .filter((score) => score !== null);

  if (scores.length === 0) {
    return {
      count: 0,
      average: null,
      max: null,
      min: null,
      passed: 0,
      incomplete: results.filter((result) => result?.isComplete === false).length,
    };
  }

  const threshold = Number.isFinite(passThreshold) ? passThreshold : null;

  return {
    count: scores.length,
    average: roundScore(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    max: Math.max(...scores),
    min: Math.min(...scores),
    passed: threshold === null ? 0 : scores.filter((score) => score >= threshold).length,
    incomplete: results.filter((result) => result?.isComplete === false).length,
  };
};

module.exports = {
  toNumber,
  roundScore,
  normalizeComponents,
  computeScoreFromComponents,
  buildResultPayload,
  computeResultStats,
};
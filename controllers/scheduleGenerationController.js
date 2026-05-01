const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Teacher = require('../models/Teacher');
const Schedule = require('../models/Schedule');
const ScheduleSettings = require('../models/ScheduleSettings');
const ScheduleGenerationConfig = require('../models/ScheduleGenerationConfig');
const { asyncHandler } = require('../utils/helpers');

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const DEFAULT_CONSTRAINTS = {
  teacherAvailability: true,
  roomAvailability: true,
  subjectHours: true,
  avoidGaps: true,
};

const DEFAULT_ADVANCED_CONSTRAINTS = {
  maxSessionsPerDay: 6,
  maxConsecutiveSessions: 4,
  maxSessionsPerSubjectPerDay: 2,
  subjectDailyCaps: [],
  minimizeRoomChangesForClass: true,
  subjectBlockouts: [],
};

const DEFAULT_MODE = 'equilibre';
const TWO_SESSION_MODES = ['split', 'fused'];

const DEFAULT_SCHEDULE_CONFIG = {
  timetableStartDate: null,
  timetableEndDate: null,
  morningStart: '08:00',
  morningEnd: '12:00',
  afternoonStart: '14:00',
  afternoonEnd: '18:00',
  sessionDuration: 60,
  smallBreakCount: 1,
  smallBreakDuration: 10,
  breaks: [],
};

const MODE_STRATEGY = {
  rapide: { maxAttempts: 7000, topCandidates: 2 },
  equilibre: { maxAttempts: 25000, topCandidates: 4 },
  avance: { maxAttempts: 70000, topCandidates: 8 },
};

const timeToMin = (value) => {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return (hours * 60) + minutes;
};

const minToTime = (value) => {
  const safeValue = Math.max(0, Math.round(Number(value) || 0));
  const hours = String(Math.floor(safeValue / 60)).padStart(2, '0');
  const minutes = String(safeValue % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const normalizeDateToStart = (dateValue) => {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  return date;
};

const normalizeDateToEnd = (dateValue) => {
  const date = new Date(dateValue);
  date.setHours(23, 59, 59, 999);
  return date;
};

const applySessionCap = (config = {}) => {
  const merged = {
    ...DEFAULT_SCHEDULE_CONFIG,
    ...config,
    breaks: Array.isArray(config.breaks) ? config.breaks : [],
  };

  return {
    ...merged,
    sessionDuration: Number(merged.sessionDuration) || 60,
    smallBreakCount: Math.max(0, Math.min(1, Number(merged.smallBreakCount) || 0)),
    smallBreakDuration: Math.max(0, Number(merged.smallBreakDuration) || 0),
  };
};

const buildHalfDayTemplate = ({ startMin, endMin, smallBreakDuration, withSmallBreak, period }) => {
  const span = Math.max(0, endMin - startMin);
  const pauseDuration = withSmallBreak ? smallBreakDuration : 0;
  const available = Math.max(0, span - pauseDuration);

  const base = Math.floor(available / 4);
  let remainder = available % 4;
  const durations = Array.from({ length: 4 }, () => {
    const bonus = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return base + bonus;
  });

  const sessions = [];
  let cursor = startMin;

  durations.forEach((duration, index) => {
    const start = cursor;
    const end = start + duration;
    sessions.push({
      period,
      index: index + 1,
      start,
      end,
      startTime: minToTime(start),
      endTime: minToTime(end),
    });
    cursor = end;

    if (withSmallBreak && index === 1) {
      cursor += smallBreakDuration;
    }
  });

  return sessions;
};

const buildDailyTemplate = (config = {}) => {
  const normalized = applySessionCap(config);
  const morningStartMin = timeToMin(normalized.morningStart);
  const morningEndMin = timeToMin(normalized.morningEnd);
  const afternoonStartMin = timeToMin(normalized.afternoonStart);
  const afternoonEndMin = timeToMin(normalized.afternoonEnd);

  const morning = buildHalfDayTemplate({
    startMin: morningStartMin,
    endMin: morningEndMin,
    smallBreakDuration: normalized.smallBreakDuration,
    withSmallBreak: normalized.smallBreakCount >= 1,
    period: 'morning',
  });

  const afternoon = buildHalfDayTemplate({
    startMin: afternoonStartMin,
    endMin: afternoonEndMin,
    smallBreakDuration: normalized.smallBreakDuration,
    withSmallBreak: normalized.smallBreakCount >= 1,
    period: 'afternoon',
  });

  return [...morning, ...afternoon];
};

const resolveEffectiveConfig = (settingsDoc, referenceDate = new Date()) => {
  const baseConfig = applySessionCap(settingsDoc?.defaultConfig || DEFAULT_SCHEDULE_CONFIG);
  const exceptions = settingsDoc?.exceptions || [];

  const activeException = exceptions.find((exception) => {
    if (!exception.isActive) return false;
    const from = normalizeDateToStart(exception.startDate);
    const to = normalizeDateToEnd(exception.endDate);
    return referenceDate >= from && referenceDate <= to;
  });

  if (!activeException) {
    return baseConfig;
  }

  return applySessionCap({
    timetableStartDate: baseConfig.timetableStartDate,
    timetableEndDate: baseConfig.timetableEndDate,
    morningStart: activeException.morningStart,
    morningEnd: activeException.morningEnd,
    afternoonStart: activeException.afternoonStart,
    afternoonEnd: activeException.afternoonEnd,
    sessionDuration: activeException.sessionDuration,
    smallBreakCount: baseConfig.smallBreakCount,
    smallBreakDuration: baseConfig.smallBreakDuration,
    breaks: activeException.breaks || [],
  });
};

const getTeacherLabel = (teacher) => {
  const first = teacher?.user?.firstName || '';
  const last = teacher?.user?.lastName || '';
  return `${first} ${last}`.trim() || teacher?.employeeId || 'Professeur';
};

const ensureTenantScope = (req, res) => {
  if (req.user?.role === 'super_admin' && !req.effectiveSchoolId) {
    res.status(400).json({
      success: false,
      message: 'Sélectionnez une école avant de générer un emploi du temps.',
    });
    return false;
  }

  return true;
};

const getOrCreateGenerationConfig = async () => {
  let doc = await ScheduleGenerationConfig.findOne({});
  if (!doc) {
    doc = await ScheduleGenerationConfig.create({
      selectedClassIds: [],
      mode: DEFAULT_MODE,
      daysCount: 6,
      sessionsPerDay: 8,
      constraints: DEFAULT_CONSTRAINTS,
      advancedConstraints: DEFAULT_ADVANCED_CONSTRAINTS,
      rooms: [],
      subjectPlans: [],
      teacherAvailabilities: [],
      fixedAssignments: [],
    });
  }
  return doc;
};

const buildSlotKey = (day, startTime, endTime) => `${day}|${startTime}|${endTime}`;

const getPlanningScope = ({ settings, daysCount, sessionsPerDay }) => {
  const rawSlots = buildDailyTemplate(settings);
  const safeSessionsPerDay = Math.max(1, Math.min(rawSlots.length || 1, Number(sessionsPerDay) || rawSlots.length || 1));
  const safeDaysCount = Math.max(1, Math.min(DAYS.length, Number(daysCount) || DAYS.length));

  const slots = rawSlots.slice(0, safeSessionsPerDay).map((slot, index) => ({
    ...slot,
    sessionNumber: index + 1,
  }));

  const days = DAYS.slice(0, safeDaysCount);

  return {
    slots,
    days,
    maxAvailableSessionsPerDay: rawSlots.length,
  };
};

const getMaxConsecutive = (slotIndexes = new Set()) => {
  const sorted = Array.from(slotIndexes).sort((left, right) => left - right);
  if (!sorted.length) return 0;

  let best = 1;
  let current = 1;

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 1;
    }
  }

  return best;
};

const roomMatchesLink = (room, unit) => {
  const linkType = room.linkType || 'none';
  const linkId = String(room.linkId || '');

  if (linkType === 'none' || !linkId) {
    return true;
  }

  if (linkType === 'class') return linkId === unit.classId;
  if (linkType === 'subject') return linkId === unit.subjectId;
  if (linkType === 'teacher') return linkId === unit.teacherId;
  return true;
};

const buildTeacherAvailabilityMap = (teacherAvailabilities = []) => {
  const byTeacher = new Map();

  (teacherAvailabilities || []).forEach((entry) => {
    const teacherId = String(entry.teacherId || '');
    if (!teacherId) return;

    const slotMap = new Map();
    (entry.slots || []).forEach((slot) => {
      slotMap.set(buildSlotKey(slot.day, slot.startTime, slot.endTime), slot.available !== false);
    });

    byTeacher.set(teacherId, slotMap);
  });

  return byTeacher;
};

const sanitizeRooms = (rooms = []) => {
  return (rooms || [])
    .map((room) => ({
      name: String(room.name || '').trim(),
      capacity: Number(room.capacity) || 0,
      isActive: room.isActive !== false,
      linkType: ['none', 'class', 'subject', 'teacher'].includes(room.linkType) ? room.linkType : 'none',
      linkId: room.linkId || null,
      linkStrict: room.linkStrict === true,
    }))
    .filter((room) => room.name && room.capacity > 0 && room.isActive);
};

const pickRoomForCandidate = ({ rooms, roomOccupiedSet, slotKey, classCapacity = 0, enforceRoom, unit }) => {
  if (!enforceRoom) {
    const fallback = rooms[0]?.name || 'Salle virtuelle';
    return fallback;
  }

  const scored = [];

  rooms.forEach((room) => {
    if (room.capacity < classCapacity) return;
    if (roomOccupiedSet.has(`${slotKey}|${room.name}`)) return;

    const match = roomMatchesLink(room, unit);
    if (!match && room.linkStrict) return;

    let score = Math.max(0, room.capacity - classCapacity);
    if ((room.linkType || 'none') !== 'none' && match) score -= 5;
    if ((room.linkType || 'none') !== 'none' && !match) score += 3;

    scored.push({ room, score });
  });

  if (!scored.length) return null;
  scored.sort((left, right) => left.score - right.score);
  return scored[0].room.name;
};

const normalizeGenerationPayload = (payload = {}) => {
  const selectedClassIds = [...new Set((payload.selectedClassIds || []).map((id) => String(id)).filter(Boolean))];

  return {
    selectedClassIds,
    mode: ['rapide', 'equilibre', 'avance'].includes(payload.mode) ? payload.mode : DEFAULT_MODE,
    daysCount: Math.max(1, Math.min(6, Number(payload.daysCount) || 6)),
    sessionsPerDay: Math.max(1, Math.min(12, Number(payload.sessionsPerDay) || 8)),
    constraints: {
      ...DEFAULT_CONSTRAINTS,
      ...(payload.constraints || {}),
    },
    advancedConstraints: {
      ...DEFAULT_ADVANCED_CONSTRAINTS,
      ...(payload.advancedConstraints || {}),
      maxSessionsPerDay: Math.max(1, Math.min(12, Number(payload.advancedConstraints?.maxSessionsPerDay) || DEFAULT_ADVANCED_CONSTRAINTS.maxSessionsPerDay)),
      maxConsecutiveSessions: Math.max(1, Math.min(12, Number(payload.advancedConstraints?.maxConsecutiveSessions) || DEFAULT_ADVANCED_CONSTRAINTS.maxConsecutiveSessions)),
      maxSessionsPerSubjectPerDay: Math.max(
        1,
        Math.min(12, Number(payload.advancedConstraints?.maxSessionsPerSubjectPerDay) || DEFAULT_ADVANCED_CONSTRAINTS.maxSessionsPerSubjectPerDay)
      ),
      subjectDailyCaps: (payload.advancedConstraints?.subjectDailyCaps || [])
        .map((item) => ({
          subjectId: String(item.subjectId || ''),
          maxPerDay: Math.max(1, Math.min(12, Number(item.maxPerDay) || DEFAULT_ADVANCED_CONSTRAINTS.maxSessionsPerSubjectPerDay)),
        }))
        .filter((item) => item.subjectId),
      minimizeRoomChangesForClass: payload.advancedConstraints?.minimizeRoomChangesForClass !== false,
      subjectBlockouts: (payload.advancedConstraints?.subjectBlockouts || [])
        .map((item) => ({
          classId: item.classId ? String(item.classId) : null,
          subjectId: String(item.subjectId || ''),
          day: DAYS.includes(item.day) ? item.day : null,
          sessionNumber: item.sessionNumber ? Number(item.sessionNumber) : null,
        }))
        .filter((item) => item.subjectId && (item.day || item.sessionNumber)),
    },
    rooms: sanitizeRooms(payload.rooms || []),
    subjectPlans: (payload.subjectPlans || [])
      .map((plan) => ({
        classId: String(plan.classId || ''),
        subjectId: String(plan.subjectId || ''),
        teacherId: String(plan.teacherId || ''),
        hoursPerWeek: Number(plan.hoursPerWeek) || 0,
        twoSessionsMode: TWO_SESSION_MODES.includes(plan.twoSessionsMode) ? plan.twoSessionsMode : 'split',
      }))
      .filter((plan) => plan.classId && plan.subjectId && plan.teacherId && plan.hoursPerWeek > 0),
    teacherAvailabilities: (payload.teacherAvailabilities || [])
      .map((entry) => ({
        teacherId: String(entry.teacherId || ''),
        slots: (entry.slots || []).map((slot) => ({
          day: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          available: slot.available !== false,
        })),
      }))
      .filter((entry) => entry.teacherId),
    fixedAssignments: (payload.fixedAssignments || [])
      .map((item) => ({
        classId: String(item.classId || ''),
        subjectId: String(item.subjectId || ''),
        teacherId: item.teacherId ? String(item.teacherId) : '',
        day: DAYS.includes(item.day) ? item.day : null,
        sessionNumber: item.sessionNumber ? Number(item.sessionNumber) : null,
      }))
      .filter((item) => item.classId && item.subjectId),
  };
};

const buildDefaultPlans = ({ classes, subjects, teachers }) => {
  const plans = [];

  classes.forEach((classe) => {
    const classId = String(classe._id);
    const linkedSubjects = subjects.filter((subject) =>
      (subject.classes || []).some((entry) => String(entry._id || entry) === classId)
    );

    linkedSubjects.forEach((subject) => {
      const subjectId = String(subject._id);
      const assignedTeacher = teachers.find((teacher) => {
        const teachesClass = (teacher.classes || []).some((entry) => String(entry._id || entry) === classId);
        const teachesSubject = (teacher.subjects || []).some((entry) => String(entry._id || entry) === subjectId);
        return teachesClass && teachesSubject;
      });

      if (!assignedTeacher) return;

      plans.push({
        classId,
        subjectId,
        teacherId: String(assignedTeacher._id),
        hoursPerWeek: 2,
        twoSessionsMode: 'split',
      });
    });
  });

  return plans;
};

const buildDefaultTeacherAvailabilities = ({ teachers, slots }) => {
  return teachers.map((teacher) => ({
    teacherId: String(teacher._id),
    slots: slots.map((slot) => ({
      day: slot.day,
      startTime: slot.startTime,
      endTime: slot.endTime,
      available: true,
    })),
  }));
};

const validateGenerationData = ({
  payload,
  classesMap,
  subjectsMap,
  teachersMap,
  slots,
  days,
  settingsConfig,
  maxAvailableSessionsPerDay,
}) => {
  const errors = [];
  const warnings = [];

  if (payload.daysCount < 1 || payload.daysCount > 6) {
    errors.push('Le nombre de jours doit être compris entre 1 et 6.');
  }

  if (payload.sessionsPerDay < 1) {
    errors.push('Le nombre de séances par jour doit être supérieur à 0.');
  }

  if (maxAvailableSessionsPerDay && payload.sessionsPerDay > maxAvailableSessionsPerDay) {
    warnings.push(`Le paramètre "séances/jour" dépasse la capacité actuelle (${maxAvailableSessionsPerDay}). Limitation appliquée.`);
  }

  if (!payload.selectedClassIds.length) {
    errors.push('Veuillez sélectionner au moins une classe.');
  }

  if (payload.constraints.roomAvailability && payload.rooms.length === 0) {
    errors.push('Veuillez ajouter au moins une salle.');
  }

  if (payload.constraints.subjectHours && payload.subjectPlans.length === 0) {
    errors.push('Veuillez définir au moins une matière avec volume horaire.');
  }

  if (payload.advancedConstraints?.maxSessionsPerSubjectPerDay < 1) {
    errors.push('Le maximum de séances par jour et par matière doit être supérieur à 0.');
  }

  (payload.advancedConstraints?.subjectDailyCaps || []).forEach((item) => {
    if (!subjectsMap.has(item.subjectId)) {
      errors.push('Un plafond par matière référence une matière introuvable.');
    }

    if (item.maxPerDay < 1 || item.maxPerDay > 12) {
      errors.push('Un plafond par matière doit être compris entre 1 et 12.');
    }
  });

  payload.selectedClassIds.forEach((classId) => {
    if (!classesMap.has(classId)) {
      errors.push('Une classe sélectionnée est introuvable pour cette école.');
    }
  });

  payload.subjectPlans.forEach((plan) => {
    if (!classesMap.has(plan.classId)) {
      errors.push('Une matière cible une classe introuvable.');
    }

    if (!subjectsMap.has(plan.subjectId)) {
      errors.push('Une matière est introuvable pour cette école.');
    }

    if (!teachersMap.has(plan.teacherId)) {
      errors.push('Une matière n\'a pas d\'enseignant assigné valide.');
    }

    const subject = subjectsMap.get(plan.subjectId);
    const teacher = teachersMap.get(plan.teacherId);

    if (subject) {
      const linked = (subject.classes || []).some((entry) => String(entry._id || entry) === plan.classId);
      if (!linked) {
        errors.push(`La matière "${subject.name}" n'est pas liée à la classe sélectionnée.`);
      }
    }

    if (teacher) {
      const teachesClass = (teacher.classes || []).some((entry) => String(entry._id || entry) === plan.classId);
      const teachesSubject = (teacher.subjects || []).some((entry) => String(entry._id || entry) === plan.subjectId);
      if (!teachesClass || !teachesSubject) {
        warnings.push(`Ajustez l'assignation: ${getTeacherLabel(teacher)} n'est pas lié à la classe/matière choisie.`);
      }
    }

    if (!TWO_SESSION_MODES.includes(plan.twoSessionsMode || 'split')) {
      errors.push('Le mode de répartition pour 2 séances doit être "split" ou "fused".');
    }
  });

  if (!slots.length) {
    errors.push('Aucun créneau horaire disponible dans les paramètres d\'emploi du temps.');
  }

  if (!days.length) {
    errors.push('Aucun jour actif défini pour la génération.');
  }

  payload.fixedAssignments.forEach((item) => {
    if (!classesMap.has(item.classId)) {
      errors.push('Une contrainte de matière forcée référence une classe introuvable.');
    }

    if (!subjectsMap.has(item.subjectId)) {
      errors.push('Une contrainte de matière forcée référence une matière introuvable.');
    }

    if (item.teacherId && !teachersMap.has(item.teacherId)) {
      errors.push('Une contrainte de matière forcée référence un professeur introuvable.');
    }

    if (item.day && !days.includes(item.day)) {
      errors.push('Une contrainte de matière forcée utilise un jour non actif.');
    }

    if (item.sessionNumber && (item.sessionNumber < 1 || item.sessionNumber > slots.length)) {
      errors.push('Une contrainte de matière forcée utilise un numéro de séance invalide.');
    }
  });

  (payload.advancedConstraints?.subjectBlockouts || []).forEach((item) => {
    if (item.classId && !classesMap.has(item.classId)) {
      errors.push('Une interdiction de matière référence une classe introuvable.');
    }

    if (!subjectsMap.has(item.subjectId)) {
      errors.push('Une interdiction de matière référence une matière introuvable.');
    }

    if (item.day && !days.includes(item.day)) {
      errors.push('Une interdiction de matière utilise un jour non actif.');
    }

    if (item.sessionNumber && (item.sessionNumber < 1 || item.sessionNumber > slots.length)) {
      errors.push('Une interdiction de matière utilise un numéro de séance invalide.');
    }

    if (!item.day && !item.sessionNumber) {
      errors.push('Une interdiction de matière doit cibler un jour, une séance, ou les deux.');
    }
  });

  const weeklyMinutes = slots.reduce((sum, slot) => sum + (timeToMin(slot.endTime) - timeToMin(slot.startTime)), 0);
  const totalRequestedMinutes = payload.subjectPlans.reduce((sum, plan) => sum + (plan.hoursPerWeek * 60), 0);

  if (totalRequestedMinutes > (weeklyMinutes * days.length * payload.selectedClassIds.length)) {
    warnings.push('Le volume horaire demandé semble supérieur à la capacité hebdomadaire disponible.');
  }

  if (settingsConfig.sessionDuration < 30) {
    warnings.push('Durée de séance très courte: vérifiez la lisibilité de l\'emploi du temps généré.');
  }

  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
};

const computeHolesPenalty = (slotIndex, existingIndexes = new Set()) => {
  const next = new Set(existingIndexes);
  next.add(slotIndex);
  const sorted = Array.from(next).sort((left, right) => left - right);
  if (!sorted.length) return 0;

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const holes = (max - min + 1) - sorted.length;
  return holes;
};

const buildGroupedResult = (placements) => {
  const byClass = new Map();
  const byTeacher = new Map();

  placements.forEach((item) => {
    const classKey = item.classId;
    const teacherKey = item.teacherId;

    if (!byClass.has(classKey)) {
      byClass.set(classKey, {
        classId: item.classId,
        className: item.className,
        entries: [],
      });
    }

    if (!byTeacher.has(teacherKey)) {
      byTeacher.set(teacherKey, {
        teacherId: item.teacherId,
        teacherName: item.teacherName,
        entries: [],
      });
    }

    byClass.get(classKey).entries.push(item);
    byTeacher.get(teacherKey).entries.push(item);
  });

  const sorter = (left, right) => {
    const dayDiff = DAYS.indexOf(left.day) - DAYS.indexOf(right.day);
    if (dayDiff !== 0) return dayDiff;
    return left.startTime.localeCompare(right.startTime);
  };

  const normalizeGroup = (group) => ({
    ...group,
    entries: group.entries.sort(sorter),
  });

  return {
    byClass: Array.from(byClass.values()).map(normalizeGroup),
    byTeacher: Array.from(byTeacher.values()).map(normalizeGroup),
  };
};

const runGenerationAlgorithm = ({ payload, classesMap, subjectsMap, teachersMap, slots }) => {
  const strategy = MODE_STRATEGY[payload.mode] || MODE_STRATEGY.equilibre;
  const roomEnabled = payload.constraints.roomAvailability;
  const availabilityEnabled = payload.constraints.teacherAvailability;
  const avoidGapsEnabled = payload.constraints.avoidGaps;
  const defaultMaxSessionsPerSubjectPerDay = Math.max(1, Number(payload.advancedConstraints?.maxSessionsPerSubjectPerDay) || 2);
  const minimizeRoomChangesForClass = payload.advancedConstraints?.minimizeRoomChangesForClass !== false;
  const activeDays = Array.isArray(payload.activeDays) && payload.activeDays.length > 0
    ? payload.activeDays
    : DAYS;
  const subjectBlockouts = Array.isArray(payload.advancedConstraints?.subjectBlockouts)
    ? payload.advancedConstraints.subjectBlockouts
    : [];
  const subjectDailyCaps = Array.isArray(payload.advancedConstraints?.subjectDailyCaps)
    ? payload.advancedConstraints.subjectDailyCaps
    : [];

  const rooms = payload.rooms;
  const teacherAvailability = buildTeacherAvailabilityMap(payload.teacherAvailabilities);

  const slotCatalog = [];
  activeDays.forEach((day) => {
    slots.forEach((slot, slotIndex) => {
      slotCatalog.push({
        day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotIndex,
        sessionNumber: slotIndex + 1,
        slotKey: buildSlotKey(day, slot.startTime, slot.endTime),
      });
    });
  });

  const sessionDurationMinutes = Math.max(1, Number(payload.sessionDurationMinutes || 60));

  const fixedByPlan = new Map();
  (payload.fixedAssignments || []).forEach((item) => {
    const key = `${item.classId}|${item.subjectId}`;
    if (!fixedByPlan.has(key)) {
      fixedByPlan.set(key, []);
    }
    fixedByPlan.get(key).push(item);
  });

  const lessonUnits = [];
  payload.subjectPlans.forEach((plan) => {
    const sessions = Math.max(1, Math.round((plan.hoursPerWeek * 60) / sessionDurationMinutes));
    const classInfo = classesMap.get(plan.classId);
    const subjectInfo = subjectsMap.get(plan.subjectId);
    const teacherInfo = teachersMap.get(plan.teacherId);
    const planFixed = fixedByPlan.get(`${plan.classId}|${plan.subjectId}`) || [];
    const forcedCount = Math.min(planFixed.length, sessions);

    for (let i = 0; i < forcedCount; i += 1) {
      const forced = planFixed[i];
      lessonUnits.push({
        classId: plan.classId,
        subjectId: plan.subjectId,
        teacherId: forced.teacherId || plan.teacherId,
        className: classInfo?.name || 'Classe',
        classCapacity: Number(classInfo?.capacity) || 0,
        subjectName: subjectInfo?.name || 'Matière',
        teacherName: getTeacherLabel(teachersMap.get(forced.teacherId || plan.teacherId)),
        planKey: `${plan.classId}|${plan.subjectId}|${forced.teacherId || plan.teacherId}`,
        planConstraintKey: `${plan.classId}|${plan.subjectId}`,
        planTotalSessions: sessions,
        twoSessionsMode: sessions === 2 ? (plan.twoSessionsMode || 'split') : null,
        forcedDay: forced.day || null,
        forcedSessionNumber: forced.sessionNumber || null,
      });
    }

    for (let i = forcedCount; i < sessions; i += 1) {
      lessonUnits.push({
        classId: plan.classId,
        subjectId: plan.subjectId,
        teacherId: plan.teacherId,
        className: classInfo?.name || 'Classe',
        classCapacity: Number(classInfo?.capacity) || 0,
        subjectName: subjectInfo?.name || 'Matière',
        teacherName: getTeacherLabel(teacherInfo),
        planKey: `${plan.classId}|${plan.subjectId}|${plan.teacherId}`,
        planConstraintKey: `${plan.classId}|${plan.subjectId}`,
        planTotalSessions: sessions,
        twoSessionsMode: sessions === 2 ? (plan.twoSessionsMode || 'split') : null,
        forcedDay: null,
        forcedSessionNumber: null,
      });
    }
  });

  const feasibleCount = (unit) => {
    const availableSet = teacherAvailability.get(unit.teacherId);
    return slotCatalog.filter((slot) => {
      if (!availabilityEnabled) return true;
      if (!availableSet || availableSet.size === 0) return true;
      return availableSet.get(slot.slotKey) !== false;
    }).length;
  };

  lessonUnits.sort((left, right) => {
    const leftCount = feasibleCount(left);
    const rightCount = feasibleCount(right);
    if (leftCount !== rightCount) return leftCount - rightCount;
    return left.className.localeCompare(right.className);
  });

  const classBusy = new Set();
  const teacherBusy = new Set();
  const roomBusy = new Set();
  const classDaySlots = new Map();
  const classDayLoads = new Map();
  const teacherDayLoads = new Map();
  const classSubjectDayLoads = new Map();
  const teacherDaySlots = new Map();
  const classRoomUsage = new Map();
  const classDayRoomBySlot = new Map();
  const planPlacedSlots = new Map();
  const placements = [];
  const blockers = [];

  let attempts = 0;

  const getClassDaySet = (classId, day) => {
    const key = `${classId}|${day}`;
    if (!classDaySlots.has(key)) {
      classDaySlots.set(key, new Set());
    }
    return classDaySlots.get(key);
  };

  const getTeacherDaySet = (teacherId, day) => {
    const key = `${teacherId}|${day}`;
    if (!teacherDaySlots.has(key)) {
      teacherDaySlots.set(key, new Set());
    }
    return teacherDaySlots.get(key);
  };

  const countMapIncrement = (map, key, delta) => {
    const current = map.get(key) || 0;
    const next = current + delta;
    if (next <= 0) {
      map.delete(key);
      return;
    }
    map.set(key, next);
  };

  const getClassRoomUsageMap = (classId) => {
    const key = String(classId);
    if (!classRoomUsage.has(key)) {
      classRoomUsage.set(key, new Map());
    }
    return classRoomUsage.get(key);
  };

  const getClassDayRoomMap = (classId, day) => {
    const key = `${classId}|${day}`;
    if (!classDayRoomBySlot.has(key)) {
      classDayRoomBySlot.set(key, new Map());
    }
    return classDayRoomBySlot.get(key);
  };

  const isSubjectBlockedOnSlot = (unit, slot) => {
    return subjectBlockouts.some((rule) => {
      if (String(rule.subjectId) !== String(unit.subjectId)) return false;
      if (rule.classId && String(rule.classId) !== String(unit.classId)) return false;
      if (rule.day && rule.day !== slot.day) return false;
      if (rule.sessionNumber && Number(rule.sessionNumber) !== Number(slot.sessionNumber)) return false;
      return true;
    });
  };

  const getSubjectDailyCap = (unit) => {
    const found = subjectDailyCaps.find((item) =>
      String(item.subjectId) === String(unit.subjectId)
    );

    return Math.max(1, Number(found?.maxPerDay) || defaultMaxSessionsPerSubjectPerDay);
  };

  const getPlanSlots = (planConstraintKey) => {
    if (!planPlacedSlots.has(planConstraintKey)) {
      planPlacedSlots.set(planConstraintKey, []);
    }

    return planPlacedSlots.get(planConstraintKey);
  };

  const buildCandidates = (unit) => {
    const teacherAvailabilitySet = teacherAvailability.get(unit.teacherId);

    const candidates = [];

    slotCatalog.forEach((slot) => {
      if (unit.forcedDay && slot.day !== unit.forcedDay) return;
      if (unit.forcedSessionNumber && slot.sessionNumber !== unit.forcedSessionNumber) return;

      const classOccupancyKey = `${unit.classId}|${slot.slotKey}`;
      const teacherOccupancyKey = `${unit.teacherId}|${slot.slotKey}`;

      if (classBusy.has(classOccupancyKey)) return;
      if (teacherBusy.has(teacherOccupancyKey)) return;

      if (isSubjectBlockedOnSlot(unit, slot)) return;

      if (availabilityEnabled && teacherAvailabilitySet && teacherAvailabilitySet.size > 0) {
        if (teacherAvailabilitySet.get(slot.slotKey) === false) return;
      }

      const roomName = pickRoomForCandidate({
        rooms,
        roomOccupiedSet: roomBusy,
        slotKey: slot.slotKey,
        classCapacity: unit.classCapacity,
        enforceRoom: roomEnabled,
        unit,
      });

      if (!roomName) return;

      const classDayKey = `${unit.classId}|${slot.day}`;
      const teacherDayKey = `${unit.teacherId}|${slot.day}`;
      const classSubjectDayKey = `${unit.classId}|${unit.subjectId}|${slot.day}`;
      const classDaySet = getClassDaySet(unit.classId, slot.day);
      const teacherDaySet = getTeacherDaySet(unit.teacherId, slot.day);

      let penalty = 0;

      const classLoad = classDayLoads.get(classDayKey) || 0;
      const teacherLoad = teacherDayLoads.get(teacherDayKey) || 0;
      const subjectDayLoad = classSubjectDayLoads.get(classSubjectDayKey) || 0;
      const subjectDailyCap = getSubjectDailyCap(unit);

      if (subjectDayLoad >= subjectDailyCap) return;

      if (unit.planTotalSessions === 2 && unit.twoSessionsMode) {
        const planSlots = getPlanSlots(unit.planConstraintKey);

        if (unit.twoSessionsMode === 'split') {
          if (planSlots.length === 1 && planSlots[0].day === slot.day) return;
        }

        if (unit.twoSessionsMode === 'fused') {
          if (planSlots.length === 0) {
            // Only allow the first fused slot on odd session numbers to force strict pairs: 1-2, 3-4, 5-6, 7-8.
            const isOddSession = (Number(slot.sessionNumber) % 2) === 1;
            if (!isOddSession) return;

            const pairSecondSession = Number(slot.sessionNumber) + 1;
            if (pairSecondSession > slots.length) return;
          }

          if (planSlots.length === 1) {
            const firstSlot = planSlots[0];
            const sameDay = firstSlot.day === slot.day;
            const expectedSecondSession = Number(firstSlot.slotIndex) + 2;
            const isExactPair = Number(slot.sessionNumber) === expectedSecondSession;
            if (!sameDay || !isExactPair) return;
          }
        }
      }

      if (avoidGapsEnabled) {
        penalty += computeHolesPenalty(slot.slotIndex, classDaySet) * 4;
      }

      penalty += classLoad * classLoad;
      penalty += teacherLoad * teacherLoad;

      if (classLoad >= 5) penalty += 8;
      if (teacherLoad >= 5) penalty += 8;

      if (minimizeRoomChangesForClass) {
        const usageMap = getClassRoomUsageMap(unit.classId);
        let dominantRoom = null;
        let dominantCount = 0;

        usageMap.forEach((count, room) => {
          if (count > dominantCount) {
            dominantCount = count;
            dominantRoom = room;
          }
        });

        if (dominantRoom && dominantRoom !== roomName) {
          penalty += 5 + dominantCount;
        }

        const sameDayRooms = getClassDayRoomMap(unit.classId, slot.day);
        const previousRoom = sameDayRooms.get(slot.slotIndex - 1);
        const nextRoom = sameDayRooms.get(slot.slotIndex + 1);
        if (previousRoom && previousRoom !== roomName) penalty += 10;
        if (nextRoom && nextRoom !== roomName) penalty += 10;
      }

      candidates.push({
        slot,
        roomName,
        penalty,
      });
    });

    candidates.sort((left, right) => left.penalty - right.penalty);
    return candidates.slice(0, strategy.topCandidates);
  };

  const explainNoCandidate = (unit) => {
    const teacherAvailabilitySet = teacherAvailability.get(unit.teacherId);

    let checked = 0;
    let blockedByClassConflict = 0;
    let blockedByTeacherConflict = 0;
    let blockedByAvailability = 0;
    let blockedByRoom = 0;
    let blockedByDailyLimit = 0;
    let blockedBySubjectDailyLimit = 0;
    let blockedBySubjectBlockout = 0;
    let blockedByForcedSlot = 0;

    slotCatalog.forEach((slot) => {
      if (unit.forcedDay && slot.day !== unit.forcedDay) {
        blockedByForcedSlot += 1;
        return;
      }
      if (unit.forcedSessionNumber && slot.sessionNumber !== unit.forcedSessionNumber) {
        blockedByForcedSlot += 1;
        return;
      }

      checked += 1;

      const classOccupancyKey = `${unit.classId}|${slot.slotKey}`;
      if (classBusy.has(classOccupancyKey)) {
        blockedByClassConflict += 1;
        return;
      }

      const teacherOccupancyKey = `${unit.teacherId}|${slot.slotKey}`;
      if (teacherBusy.has(teacherOccupancyKey)) {
        blockedByTeacherConflict += 1;
        return;
      }

      if (isSubjectBlockedOnSlot(unit, slot)) {
        blockedBySubjectBlockout += 1;
        return;
      }

      if (availabilityEnabled && teacherAvailabilitySet && teacherAvailabilitySet.size > 0) {
        if (teacherAvailabilitySet.get(slot.slotKey) === false) {
          blockedByAvailability += 1;
          return;
        }
      }

      const classDayKey = `${unit.classId}|${slot.day}`;
      const teacherDayKey = `${unit.teacherId}|${slot.day}`;
      const classSubjectDayKey = `${unit.classId}|${unit.subjectId}|${slot.day}`;
      const classDaySet = getClassDaySet(unit.classId, slot.day);
      const teacherDaySet = getTeacherDaySet(unit.teacherId, slot.day);
      const classLoad = classDayLoads.get(classDayKey) || 0;
      const teacherLoad = teacherDayLoads.get(teacherDayKey) || 0;

      if (classLoad >= 12 || teacherLoad >= 12) {
        blockedByDailyLimit += 1;
        return;
      }

      const subjectDayLoad = classSubjectDayLoads.get(classSubjectDayKey) || 0;
      const subjectDailyCap = getSubjectDailyCap(unit);
      if (subjectDayLoad >= subjectDailyCap) {
        blockedBySubjectDailyLimit += 1;
        return;
      }

      const roomName = pickRoomForCandidate({
        rooms,
        roomOccupiedSet: roomBusy,
        slotKey: slot.slotKey,
        classCapacity: unit.classCapacity,
        enforceRoom: roomEnabled,
        unit,
      });

      if (!roomName) {
        blockedByRoom += 1;
      }
    });

    if (!roomEnabled && checked > 0) {
      return 'conflit interne sur les disponibilites classe/professeur';
    }

    const maxRoomCapacity = rooms.length > 0
      ? Math.max(...rooms.map((room) => Number(room.capacity) || 0))
      : 0;
    const classCapacity = Number(unit.classCapacity) || 0;

    const ranked = [
      {
        key: 'forced',
        count: blockedByForcedSlot,
        message: 'la matiere est forcee sur un jour/seance qui n\'est pas compatible',
      },
      {
        key: 'class',
        count: blockedByClassConflict,
        message: 'la classe a deja des cours sur tous les creneaux compatibles',
      },
      {
        key: 'teacher',
        count: blockedByTeacherConflict,
        message: 'le professeur est deja occupe sur tous les creneaux compatibles',
      },
      {
        key: 'availability',
        count: blockedByAvailability,
        message: 'le professeur est marque indisponible sur les creneaux compatibles',
      },
      {
        key: 'daily',
        count: blockedByDailyLimit,
        message: 'la capacite journaliere des creneaux est atteinte',
      },
      {
        key: 'subjectDaily',
        count: blockedBySubjectDailyLimit,
        message: 'la limite max de seances par jour pour cette matiere est atteinte',
      },
      {
        key: 'blockout',
        count: blockedBySubjectBlockout,
        message: 'la matiere est interdite sur les creneaux compatibles (jour/seance)',
      },
      {
        key: 'room',
        count: blockedByRoom,
        message: `aucune salle libre/capacite suffisante sur les creneaux compatibles (classe: ${classCapacity}, meilleure salle: ${maxRoomCapacity})`,
      },
    ].sort((left, right) => right.count - left.count);

    const top = ranked[0];
    if (!top || top.count <= 0) {
      return 'contraintes trop fortes avec la configuration actuelle';
    }

    return top.message;
  };

  const placeUnit = (unit, candidate) => {
    const classOccupancyKey = `${unit.classId}|${candidate.slot.slotKey}`;
    const teacherOccupancyKey = `${unit.teacherId}|${candidate.slot.slotKey}`;
    const roomOccupancyKey = `${candidate.slot.slotKey}|${candidate.roomName}`;

    classBusy.add(classOccupancyKey);
    teacherBusy.add(teacherOccupancyKey);
    roomBusy.add(roomOccupancyKey);

    const classDayKey = `${unit.classId}|${candidate.slot.day}`;
    const teacherDayKey = `${unit.teacherId}|${candidate.slot.day}`;
    const classSubjectDayKey = `${unit.classId}|${unit.subjectId}|${candidate.slot.day}`;
    const classDaySet = getClassDaySet(unit.classId, candidate.slot.day);
    const teacherDaySet = getTeacherDaySet(unit.teacherId, candidate.slot.day);
    const classDayRoomMap = getClassDayRoomMap(unit.classId, candidate.slot.day);
    const usageMap = getClassRoomUsageMap(unit.classId);
    const planSlots = getPlanSlots(unit.planConstraintKey);

    classDaySet.add(candidate.slot.slotIndex);
    teacherDaySet.add(candidate.slot.slotIndex);
    planSlots.push({ day: candidate.slot.day, slotIndex: candidate.slot.slotIndex });
    classDayRoomMap.set(candidate.slot.slotIndex, candidate.roomName);
    countMapIncrement(usageMap, candidate.roomName, 1);
    countMapIncrement(classDayLoads, classDayKey, 1);
    countMapIncrement(teacherDayLoads, teacherDayKey, 1);
    countMapIncrement(classSubjectDayLoads, classSubjectDayKey, 1);

    placements.push({
      ...unit,
      day: candidate.slot.day,
      startTime: candidate.slot.startTime,
      endTime: candidate.slot.endTime,
      room: candidate.roomName,
    });
  };

  const removeUnit = (unit, candidate) => {
    const classOccupancyKey = `${unit.classId}|${candidate.slot.slotKey}`;
    const teacherOccupancyKey = `${unit.teacherId}|${candidate.slot.slotKey}`;
    const roomOccupancyKey = `${candidate.slot.slotKey}|${candidate.roomName}`;

    classBusy.delete(classOccupancyKey);
    teacherBusy.delete(teacherOccupancyKey);
    roomBusy.delete(roomOccupancyKey);

    const classDayKey = `${unit.classId}|${candidate.slot.day}`;
    const teacherDayKey = `${unit.teacherId}|${candidate.slot.day}`;
    const classSubjectDayKey = `${unit.classId}|${unit.subjectId}|${candidate.slot.day}`;
    const classDaySet = getClassDaySet(unit.classId, candidate.slot.day);
    const teacherDaySet = getTeacherDaySet(unit.teacherId, candidate.slot.day);
    const classDayRoomMap = getClassDayRoomMap(unit.classId, candidate.slot.day);
    const usageMap = getClassRoomUsageMap(unit.classId);
    const planSlots = getPlanSlots(unit.planConstraintKey);

    classDaySet.delete(candidate.slot.slotIndex);
    teacherDaySet.delete(candidate.slot.slotIndex);
    const planIndex = planSlots.findIndex((entry) => entry.day === candidate.slot.day && entry.slotIndex === candidate.slot.slotIndex);
    if (planIndex >= 0) {
      planSlots.splice(planIndex, 1);
    }
    classDayRoomMap.delete(candidate.slot.slotIndex);
    countMapIncrement(usageMap, candidate.roomName, -1);
    countMapIncrement(classDayLoads, classDayKey, -1);
    countMapIncrement(teacherDayLoads, teacherDayKey, -1);
    countMapIncrement(classSubjectDayLoads, classSubjectDayKey, -1);

    placements.pop();
  };

  const backtrack = (index) => {
    if (index >= lessonUnits.length) return true;
    attempts += 1;
    if (attempts > strategy.maxAttempts) {
      blockers.push('Le moteur a atteint sa limite de recherche. Essayez le mode Avancé.');
      return false;
    }

    const unit = lessonUnits[index];
    const candidates = buildCandidates(unit);

    if (!candidates.length) {
      const reason = explainNoCandidate(unit);
      blockers.push(
        `Impossible de placer ${unit.subjectName} pour ${unit.className} (${unit.teacherName}) : ${reason}.`
      );
      return false;
    }

    for (const candidate of candidates) {
      placeUnit(unit, candidate);
      if (backtrack(index + 1)) return true;
      removeUnit(unit, candidate);
    }

    return false;
  };

  const success = backtrack(0);
  return {
    success,
    placements,
    blockers: [...new Set(blockers)],
  };
};

const serializeConfigForResponse = (configDoc) => ({
  selectedClassIds: (configDoc.selectedClassIds || []).map((id) => String(id)),
  mode: configDoc.mode || DEFAULT_MODE,
  daysCount: Math.max(1, Math.min(6, Number(configDoc.daysCount) || 6)),
  sessionsPerDay: Math.max(1, Math.min(12, Number(configDoc.sessionsPerDay) || 8)),
  constraints: {
    ...DEFAULT_CONSTRAINTS,
    ...(configDoc.constraints || {}),
  },
  advancedConstraints: {
    ...DEFAULT_ADVANCED_CONSTRAINTS,
    ...(configDoc.advancedConstraints || {}),
    maxSessionsPerSubjectPerDay: Math.max(
      1,
      Math.min(12, Number(configDoc.advancedConstraints?.maxSessionsPerSubjectPerDay) || DEFAULT_ADVANCED_CONSTRAINTS.maxSessionsPerSubjectPerDay)
    ),
    subjectDailyCaps: (configDoc.advancedConstraints?.subjectDailyCaps || []).map((item) => ({
      subjectId: String(item.subjectId),
      maxPerDay: Math.max(1, Math.min(12, Number(item.maxPerDay) || DEFAULT_ADVANCED_CONSTRAINTS.maxSessionsPerSubjectPerDay)),
    })),
    minimizeRoomChangesForClass: configDoc.advancedConstraints?.minimizeRoomChangesForClass !== false,
    subjectBlockouts: (configDoc.advancedConstraints?.subjectBlockouts || []).map((item) => ({
      classId: item.classId ? String(item.classId) : '',
      subjectId: String(item.subjectId),
      day: item.day || null,
      sessionNumber: Number(item.sessionNumber) || null,
    })),
  },
  rooms: (configDoc.rooms || []).map((room) => ({
    name: room.name,
    capacity: room.capacity,
    isActive: room.isActive !== false,
    linkType: room.linkType || 'none',
    linkId: room.linkId ? String(room.linkId) : null,
    linkStrict: room.linkStrict === true,
  })),
  subjectPlans: (configDoc.subjectPlans || []).map((plan) => ({
    classId: String(plan.classId),
    subjectId: String(plan.subjectId),
    teacherId: String(plan.teacherId),
    hoursPerWeek: Number(plan.hoursPerWeek) || 0,
    twoSessionsMode: TWO_SESSION_MODES.includes(plan.twoSessionsMode) ? plan.twoSessionsMode : 'split',
  })),
  teacherAvailabilities: (configDoc.teacherAvailabilities || []).map((entry) => ({
    teacherId: String(entry.teacherId),
    slots: (entry.slots || []).map((slot) => ({
      day: slot.day,
      startTime: slot.startTime,
      endTime: slot.endTime,
      available: slot.available !== false,
    })),
  })),
  fixedAssignments: (configDoc.fixedAssignments || []).map((item) => ({
    classId: String(item.classId),
    subjectId: String(item.subjectId),
    teacherId: item.teacherId ? String(item.teacherId) : '',
    day: item.day || null,
    sessionNumber: Number(item.sessionNumber) || null,
  })),
  lastGenerationVersion: Number(configDoc.lastGenerationVersion) || 0,
  lastGeneratedAt: configDoc.lastGeneratedAt || null,
});

const getGenerationBootstrap = asyncHandler(async (req, res) => {
  if (!ensureTenantScope(req, res)) return;

  const [classes, subjects, teachers, settingsDoc, generationConfig] = await Promise.all([
    Class.find({ isActive: true }).sort('name'),
    Subject.find({ isActive: true }).populate('classes', 'name'),
    Teacher.find()
      .populate('user', 'firstName lastName')
      .populate('classes', 'name')
      .populate('subjects', 'name code'),
    ScheduleSettings.findOne({}),
    getOrCreateGenerationConfig(),
  ]);

  const effectiveSettings = resolveEffectiveConfig(settingsDoc);
  const planningScope = getPlanningScope({
    settings: effectiveSettings,
    daysCount: generationConfig.daysCount || 6,
    sessionsPerDay: generationConfig.sessionsPerDay || 8,
  });

  const templateSlots = planningScope.slots.map((slot) => ({
    startTime: slot.startTime,
    endTime: slot.endTime,
    sessionNumber: slot.sessionNumber,
  }));

  if (!generationConfig.selectedClassIds.length) {
    generationConfig.selectedClassIds = classes.map((item) => item._id);
  }

  if (!generationConfig.subjectPlans.length) {
    generationConfig.subjectPlans = buildDefaultPlans({ classes, subjects, teachers });
  }

  if (!generationConfig.rooms.length) {
    generationConfig.rooms = [
      { name: 'Salle A', capacity: 30, isActive: true },
      { name: 'Salle B', capacity: 35, isActive: true },
    ];
  }

  if (!generationConfig.teacherAvailabilities.length) {
    generationConfig.teacherAvailabilities = buildDefaultTeacherAvailabilities({
      teachers,
      slots: planningScope.days.flatMap((day) => templateSlots.map((slot) => ({ ...slot, day }))),
    });
  }

  await generationConfig.save();

  return res.status(200).json({
    success: true,
    data: {
      classes,
      subjects,
      teachers,
      scheduleTemplate: {
        config: effectiveSettings,
        slots: templateSlots,
        days: planningScope.days,
        maxAvailableSessionsPerDay: planningScope.maxAvailableSessionsPerDay,
      },
      config: serializeConfigForResponse(generationConfig),
    },
  });
});

const saveGenerationConfig = asyncHandler(async (req, res) => {
  if (!ensureTenantScope(req, res)) return;

  const payload = normalizeGenerationPayload(req.body || {});
  const configDoc = await getOrCreateGenerationConfig();

  configDoc.selectedClassIds = payload.selectedClassIds;
  configDoc.mode = payload.mode;
  configDoc.daysCount = payload.daysCount;
  configDoc.sessionsPerDay = payload.sessionsPerDay;
  configDoc.constraints = payload.constraints;
  configDoc.advancedConstraints = payload.advancedConstraints;
  configDoc.rooms = payload.rooms;
  configDoc.subjectPlans = payload.subjectPlans;
  configDoc.teacherAvailabilities = payload.teacherAvailabilities;
  configDoc.fixedAssignments = payload.fixedAssignments;

  await configDoc.save();

  return res.status(200).json({
    success: true,
    data: serializeConfigForResponse(configDoc),
  });
});

const validateGenerationConfig = asyncHandler(async (req, res) => {
  if (!ensureTenantScope(req, res)) return;

  const [classes, subjects, teachers, settingsDoc, configDoc] = await Promise.all([
    Class.find({ isActive: true }),
    Subject.find({ isActive: true }).populate('classes', '_id name'),
    Teacher.find().populate('classes', '_id').populate('subjects', '_id').populate('user', 'firstName lastName'),
    ScheduleSettings.findOne({}),
    getOrCreateGenerationConfig(),
  ]);

  const payload = normalizeGenerationPayload(
    Object.keys(req.body || {}).length > 0
      ? req.body
      : serializeConfigForResponse(configDoc)
  );

  const settings = resolveEffectiveConfig(settingsDoc);
  const planningScope = getPlanningScope({
    settings,
    daysCount: payload.daysCount,
    sessionsPerDay: payload.sessionsPerDay,
  });
  const slots = planningScope.slots;
  const days = planningScope.days;

  const classesMap = new Map(classes.map((item) => [String(item._id), item]));
  const subjectsMap = new Map(subjects.map((item) => [String(item._id), item]));
  const teachersMap = new Map(teachers.map((item) => [String(item._id), item]));

  const result = validateGenerationData({
    payload,
    classesMap,
    subjectsMap,
    teachersMap,
    slots,
    days,
    settingsConfig: settings,
    maxAvailableSessionsPerDay: planningScope.maxAvailableSessionsPerDay,
  });

  return res.status(200).json({
    success: true,
    data: {
      valid: result.errors.length === 0,
      errors: result.errors,
      warnings: result.warnings,
    },
  });
});

const runGeneration = asyncHandler(async (req, res) => {
  if (!ensureTenantScope(req, res)) return;

  const saveMode = req.body?.saveMode === 'overwrite' ? 'overwrite' : 'version';

  const [classes, subjects, teachers, settingsDoc, configDoc] = await Promise.all([
    Class.find({ isActive: true }),
    Subject.find({ isActive: true }).populate('classes', '_id name'),
    Teacher.find().populate('classes', '_id').populate('subjects', '_id').populate('user', 'firstName lastName'),
    ScheduleSettings.findOne({}),
    getOrCreateGenerationConfig(),
  ]);

  const sourcePayload = Object.keys(req.body?.config || {}).length > 0
    ? req.body.config
    : serializeConfigForResponse(configDoc);

  const payload = normalizeGenerationPayload(sourcePayload);
  configDoc.selectedClassIds = payload.selectedClassIds;
  configDoc.mode = payload.mode;
  configDoc.daysCount = payload.daysCount;
  configDoc.sessionsPerDay = payload.sessionsPerDay;
  configDoc.constraints = payload.constraints;
  configDoc.advancedConstraints = payload.advancedConstraints;
  configDoc.rooms = payload.rooms;
  configDoc.subjectPlans = payload.subjectPlans;
  configDoc.teacherAvailabilities = payload.teacherAvailabilities;
  configDoc.fixedAssignments = payload.fixedAssignments;

  const settings = resolveEffectiveConfig(settingsDoc);
  const planningScope = getPlanningScope({
    settings,
    daysCount: payload.daysCount,
    sessionsPerDay: payload.sessionsPerDay,
  });
  const slots = planningScope.slots;
  const days = planningScope.days;

  const classesMap = new Map(classes.map((item) => [String(item._id), item]));
  const subjectsMap = new Map(subjects.map((item) => [String(item._id), item]));
  const teachersMap = new Map(teachers.map((item) => [String(item._id), item]));

  const validation = validateGenerationData({
    payload,
    classesMap,
    subjectsMap,
    teachersMap,
    slots,
    days,
    settingsConfig: settings,
    maxAvailableSessionsPerDay: planningScope.maxAvailableSessionsPerDay,
  });

  if (validation.errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'La configuration est invalide.',
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  const generationResult = runGenerationAlgorithm({
    payload: {
      ...payload,
      sessionDurationMinutes: settings.sessionDuration,
      activeDays: days,
    },
    classesMap,
    subjectsMap,
    teachersMap,
    slots,
  });

  if (!generationResult.success) {
    return res.status(422).json({
      success: false,
      message: 'Génération impossible avec les contraintes actuelles.',
      conflicts: generationResult.blockers,
      warnings: validation.warnings,
    });
  }

  const nextVersion = (Number(configDoc.lastGenerationVersion) || 0) + 1;
  const generationBatchId = `GEN-${Date.now()}`;

  const scheduleDocs = generationResult.placements.map((item) => ({
    day: item.day,
    startTime: item.startTime,
    endTime: item.endTime,
    classe: item.classId,
    teacher: item.teacherId,
    subject: item.subjectId,
    room: item.room,
    source: 'generated',
    generationVersion: nextVersion,
    generationBatchId,
    isActive: saveMode === 'overwrite',
  }));

  if (saveMode === 'overwrite' && payload.selectedClassIds.length > 0) {
    await Schedule.updateMany(
      { classe: { $in: payload.selectedClassIds }, isActive: true },
      { isActive: false }
    );
  }

  await Schedule.insertMany(scheduleDocs);

  configDoc.lastGenerationVersion = nextVersion;
  configDoc.lastGeneratedAt = new Date();
  await configDoc.save();

  const grouped = buildGroupedResult(generationResult.placements);

  return res.status(200).json({
    success: true,
    message: saveMode === 'overwrite'
      ? 'Emploi du temps généré et appliqué à votre école.'
      : 'Version générée et sauvegardée (brouillon non actif).',
    data: {
      generationVersion: nextVersion,
      generationBatchId,
      saveMode,
      entriesCount: generationResult.placements.length,
      warnings: validation.warnings,
      ...grouped,
    },
  });
});

module.exports = {
  getGenerationBootstrap,
  saveGenerationConfig,
  validateGenerationConfig,
  runGeneration,
};

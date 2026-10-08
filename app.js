'use strict';

// ───────────────────────── Datum & Formate ─────────────────────────

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const mondayOf = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a, b) => isoDate(a) === isoDate(b);

/** 14.09.26 */
const fmtShort = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
/** 14.09. */
const fmtDayMonth = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
/** Minuten als Dezimalstunden: 90 → 1,50 */
const fmtDec = (minutes) => (minutes / 60).toFixed(2).replace('.', ',');
/** Stunden im PDF: dezimal, ohne Einheit („8,50“) */
const fmtHours = fmtDec;
/** Stunden in der App: dezimal mit Einheit („8,50 h“) */
const fmtH = (minutes) => `${fmtDec(minutes)} h`;
/** Minuten seit Mitternacht: 480 → 08:00 */
const fmtTime = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

function isoWeek(date) {
  const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

const uid = () =>
  globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

/** Vergleich: Groß-/Kleinschreibung und Art des Apostrophs egal („Bäcker's Eck“ = „Bäcker’s eck“) */
const sameKey = (s) => String(s ?? '').trim().toLowerCase().replace(/[’‘`´ʼ′]/g, "'");
/** Suche: zusätzlich ohne Apostrophe, Leerzeichen, Kommas, Bindestriche und Punkte („Bäckerseck“ findet „Bäcker's Eck“) */
const searchKey = (s) => sameKey(s).replace(/['\s,.\-–]/g, '');
/** Höchstlängen, damit der Text im PDF in drei Zeilen der kleineren Schriftstufe passt (ohne Zähler) */
const MAX_LEN = { site: 60, work: 100 };
/** Reisekosten: Reiseorte bzw. Tätigkeiten je Kasten höchstens zwei Zeilen im PDF */
const TRIP_MAX_LEN = 100;
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ───────────────────────── Datenmodell ─────────────────────────
// Zettel: { id, weekStart: 'YYYY-MM-DD' (Montag), year, month, name, days[7], sentAt, createdAt, updatedAt }
// Tag:    { pause: Minuten (null = noch nicht eingetragen), status?: 'krank'|'urlaub'|'feiertag'|'frei', rows: [{ id, start, end, site, work }] }
//         (start/end: Minuten seit 00:00; bei gesetztem status werden die Zeilen ignoriert, bleiben aber erhalten)

const DAY_STATUS = {
  krank: 'Krankheitstag',
  urlaub: 'Urlaubstag',
  feiertag: 'Gesetzlicher Feiertag',
  frei: 'Frei',
};
const DAY_STATUS_SHORT = { krank: 'Krank', urlaub: 'Urlaub', feiertag: 'Feiertag', frei: 'Frei' };

const emptyRow = () => ({ id: uid(), start: null, end: null, site: '', work: '' });
const rowIsEmpty = (r) => r.start == null && r.end == null && !r.site && !r.work;
const rowMinutes = (r) => (r.start == null || r.end == null ? null : r.end >= r.start ? r.end - r.start : r.end + 1440 - r.start);
const dayWorked = (d) => d.rows.reduce((s, r) => s + (rowMinutes(r) || 0), 0);
/** Krank, Urlaub und Feiertag zählen 8 Stunden, Frei zählt 0 */
const statusCredit = (status) => (status === 'frei' ? 0 : Math.round(settings.hoursPerDay * 60));
/** An einem Feiertag kann trotzdem gearbeitet werden (z. B. Notdienst): die Stunden kommen zu den 8 gutgeschriebenen dazu */
const canWork = (d) => !d.status || d.status === 'feiertag';
const workedNet = (d) => Math.max(0, dayWorked(d) - (d.pause || 0));
const dayTotal = (d) => (d.status ? statusCredit(d.status) + (canWork(d) ? workedNet(d) : 0) : workedNet(d));
const dayHasTimes = (d) => d.rows.some((r) => r.start != null || r.end != null);
/** Am Tag wurde schon etwas eingetragen, aber noch keine Pause (nur neue Zettel haben pause: null) */
const pauseMissing = (d) => !d.status && d.pause == null && d.rows.some((r) => !rowIsEmpty(r));
/** Am Tag wurde schon etwas eingetragen (Zeit, Baustelle, Art der Arbeit oder eine Pause) */
const dayStarted = (d) => canWork(d) && (d.pause > 0 || d.rows.some((r) => !rowIsEmpty(r)));
/** Feiertag, an dem zusätzlich gearbeitet wurde */
const holidayWork = (d) => d.status === 'feiertag' && dayStarted(d);
/** Zeilen, die zeitlich nicht zueinander passen: Beginn vor dem Beginn einer Zeile darüber – beide werden markiert */
function rowsOutOfOrder(d) {
  const bad = new Set();
  const timed = d.rows.filter((r) => r.start != null);
  for (let a = 0; a < timed.length; a++)
    for (let b = a + 1; b < timed.length; b++)
      if (timed[b].start < timed[a].start) bad.add(timed[a].id).add(timed[b].id);
  return bad;
}
/** Zeilen mit Lücke oder Überschneidung zur zeitlich nächsten Zeile – beide werden markiert */
function rowsGapOrOverlap(d) {
  const bad = new Set();
  const timed = d.rows.filter((r) => r.start != null && r.end != null && r.end > r.start).sort((a, b) => a.start - b.start);
  for (let k = 1; k < timed.length; k++) {
    if (timed[k].start !== timed[k - 1].end) bad.add(timed[k - 1].id).add(timed[k].id);
  }
  return bad;
}
/** Ende liegt vor dem Beginn */
const endBeforeStart = (r) => r.start != null && r.end != null && r.end < r.start;
/** Beginn und Ende sind gleich (0 Stunden) */
const sameStartEnd = (r) => r.start != null && r.start === r.end;
/** Feld der Zeile fehlt, sobald am Tag etwas eingetragen ist */
const fieldMissing = (d, r, field) =>
  dayStarted(d) && (field === 'start' || field === 'end' ? r[field] == null : !String(r[field] || '').trim());
/** Tag hat irgendwo ein Warnzeichen (fehlende Angabe, Pause, Reihenfolge, Ende vor Beginn) */
const dayHasWarning = (d) =>
  canWork(d) &&
  (pauseMissing(d) || d.rows.some((r) => timeWarning(d, r) || fieldMissing(d, r, 'site') || fieldMissing(d, r, 'work')));
const sheetHasWarning = (s) => sheetActiveDays(s).some((i) => dayHasWarning(s.days[i]));
const timeWarning = (d, r) =>
  fieldMissing(d, r, 'start') || fieldMissing(d, r, 'end') || endBeforeStart(r) || sameStartEnd(r) || rowsOutOfOrder(d).has(r.id) || rowsGapOrOverlap(d).has(r.id);
/** Mindestanzahl Zeilen im PDF: Mo–Fr 5, Sa/So 1 */
const pdfMinRows = (i) => (i < 5 ? 5 : 1);

/** Neuer Zettel für die Woche des angetippten Tages; dessen Monat bestimmt den Zettel. */
function newSheet(anchor, name) {
  const a = startOfDay(anchor);
  return {
    id: uid(),
    weekStart: isoDate(mondayOf(a)),
    year: a.getFullYear(),
    month: a.getMonth() + 1,
    name,
    days: WEEKDAYS.map(() => ({ pause: null, rows: [emptyRow()] })),
    sentAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const sheetDate = (s, i) => addDays(parseDate(s.weekStart), i);
const sheetIsActive = (s, i) => {
  const d = sheetDate(s, i);
  return d.getFullYear() === s.year && d.getMonth() + 1 === s.month;
};
const sheetActiveDays = (s) => [0, 1, 2, 3, 4, 5, 6].filter((i) => sheetIsActive(s, i));
const sheetFirstDate = (s) => sheetDate(s, sheetActiveDays(s)[0] ?? 0);
const sheetLastDate = (s) => sheetDate(s, sheetActiveDays(s).at(-1) ?? 6);
const sheetTitle = (s) => `Stundenzettel ${fmtShort(sheetFirstDate(s))} - ${fmtShort(sheetLastDate(s))}`;
const sheetTotal = (s) => sheetActiveDays(s).reduce((t, i) => t + dayTotal(s.days[i]), 0);
const sheetOvertime = (s, targetHours) => Math.max(0, sheetTotal(s) - Math.round(targetHours * 60));
/** Soll des Zettels in Stunden: anteilig je Werktag Mo–Fr des Monats oder das volle Wochen-Soll */
const sheetTarget = (s) => (settings.target / 5) * sheetActiveDays(s).filter((i) => i < 5).length;
const sheetMatches = (s, anchor) => {
  const n = newSheet(anchor, '');
  return n.weekStart === s.weekStart && n.year === s.year && n.month === s.month;
};

// ───────────────────────── Speicher ─────────────────────────

const STORE_KEY = 'yetizettel.sheets.v1';
const SETTINGS_KEY = 'yetizettel.settings.v1';
const DEFAULT_SETTINGS = {
  name: '',
  target: 40,
  hoursPerDay: 8,
  minuteStep: 30,
  state: 'NI',
  place: '',
  signature: null,
  hiddenSuggestions: { site: [], work: [] },
  // Lohn (nur auf diesem iPhone): Stundenlohn, feste Zulage, Steuerklasse, Kirchensteuer, Kinder,
  // Zusatzbeitrag der Krankenkasse, Eigenbeitrag Betriebsrente (Entgeltumwandlung)
  wage: '',
  bonus: '',
  taxClass: '1',
  church: false,
  children: '0',
  kvExtra: '',
  bav: '',
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

let sheets = readJson(STORE_KEY, []);
let settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_KEY, {}) };
settings.hiddenSuggestions = { site: [], work: [], ...settings.hiddenSuggestions };
delete settings.recipient; // frühere Einstellungen, werden nicht mehr verwendet
delete settings.pdfFrame;
delete settings.accountStart;
delete settings.dayBar;
// Fest vorgegeben (keine Einstellung mehr): 40 Stunden pro Woche, 8 Stunden pro Tag, Niedersachsen
settings.target = 40;
settings.hoursPerDay = 8;
settings.state = 'NI';
delete settings.vacationDays;
// Ebenfalls fest: Stunden in App und PDF dezimal; Überstunden immer, bei Teilwochen anteilig;
// Krank/Urlaub/Feiertag zählen 8 Stunden, Frei 0
delete settings.hourFormat;
delete settings.prorateTarget;
delete settings.credit;
delete settings.overtime;
settings.minuteStep = 30; // Zeitauswahl immer in 30-Minuten-Schritten

/** Urlaubs- und Krankheitstage je Jahr (nach Datum des Tages) */
function absenceStats() {
  const years = new Map();
  for (const s of sheets) {
    s.days.forEach((d, i) => {
      if ((d.status !== 'urlaub' && d.status !== 'krank') || !sheetIsActive(s, i)) return;
      const y = sheetDate(s, i).getFullYear();
      if (!years.has(y)) years.set(y, { urlaub: 0, krank: 0 });
      years.get(y)[d.status]++;
    });
  }
  return years;
}

/**
 * Überstunden-Konto je Monat: Ist − Soll, Tag für Tag – nur Tage, für die es einen Stundenzettel gibt.
 * Wochen ohne Zettel kommen in der Rechnung nicht vor.
 * Soll: jeder Werktag Mo–Fr mit Wochen-Soll ÷ 5; Tage nach heute zählen noch nicht.
 * Ist: „Stunden Gesamt“ des Tages (inkl. gutgeschriebener Stunden für Urlaub, Krankheit, Feiertag).
 * Ergebnis: Map Jahr → Map Monat (1–12) → Saldo in Minuten; mit `worked` stattdessen das Ist (Stunden Gesamt)
 */
function overtimeAccount(worked = false) {
  const result = new Map();
  const dailySoll = Math.round((settings.target * 60) / 5);
  const today = startOfDay(new Date());
  for (const s of sheets) {
    s.days.forEach((d, i) => {
      const date = sheetDate(s, i);
      if (!sheetIsActive(s, i) || date > today) return;
      const soll = i < 5 ? dailySoll : 0;
      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      if (!result.has(y)) result.set(y, new Map());
      const months = result.get(y);
      months.set(m, (months.get(m) || 0) + dayTotal(d) - (worked ? 0 : soll));
    });
  }
  return result;
}

const yearBalance = (months) => [...months.values()].reduce((a, b) => a + b, 0);

// ───────────────────────── Lohn ─────────────────────────

/** Zahl aus einem Eingabefeld („12,50“), leer = 0 */
const parseNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const hasWage = () => parseNum(settings.wage) > 0;
/** Überstunden werden mit 25 % Zuschlag bezahlt */
const OT_FACTOR = 1.25;
/** Bezahlte Soll-Stunden eines Monats (Minuten): jeder Werktag Mo–Fr mit 8 Stunden, Feiertage eingeschlossen */
function monthSollMinutes(year, month) {
  let days = 0;
  for (const d = new Date(year, month - 1, 1); d.getMonth() === month - 1; d.setDate(d.getDate() + 1)) {
    if (d.getDay() >= 1 && d.getDay() <= 5) days++;
  }
  return days * Math.round(settings.hoursPerDay * 60);
}
/**
 * Lohn eines Monats: Soll-Stunden × Stundenlohn, Überstunden mit Zuschlag, feste Zulage; Minusstunden mindern
 * den Grundlohn. Für den laufenden Monat ist das die Prognose (restliche Tage wie Soll). null ohne Stundenlohn.
 */
function monthPay(year, month, otMin) {
  if (!hasWage()) return null;
  const wage = parseNum(settings.wage);
  // Jede Lohnart wie auf der Abrechnung einzeln auf Cent runden (kaufmännisch, ohne Gleitkomma-Fehler)
  const cents = (v) => Math.round(v * 100 + 1e-6) / 100;
  const base = cents(((monthSollMinutes(year, month) + Math.min(0, otMin)) / 60) * wage);
  const ot = cents((Math.max(0, otMin) / 60) * wage * OT_FACTOR);
  return nettoMonat(base + ot + parseNum(settings.bonus), {
    klasse: parseNum(settings.taxClass) || 1,
    kirche: !!settings.church,
    kinder: parseNum(settings.children),
    zusatz: parseNum(settings.kvExtra),
    bav: parseNum(settings.bav),
  });
}
/** „1.234 €“ bzw. mit Cent „1.234,56 €“ */
const fmtMoney = (v, cents = false) =>
  `${v.toLocaleString('de-DE', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })} €`;

// ───────────────────────── Lohnabrechnungen ─────────────────────────
// Eingelesene Abrechnungen je Monat („2026-08“ → Werte aus parsePayslipText). Nur Zahlen, kein Foto, keine Namen.

const PAYSLIP_KEY = 'yetizettel.payslips.v1';
let payslips = readJson(PAYSLIP_KEY, {});
function savePayslips() {
  try {
    localStorage.setItem(PAYSLIP_KEY, JSON.stringify(payslips));
  } catch {
    toast('Speichern fehlgeschlagen!');
  }
}
const payKey = (year, month) => `${year}-${pad(month)}`;
const HOUR_KINDS = [
  ['arbeit', 'Arbeitsstunden'],
  ['ueber', 'Überstunden'],
  ['urlaub', 'Urlaub'],
  ['krank', 'Krankheit'],
  ['feiertag', 'Feiertage'],
];
const cents = (v) => Math.round(v * 100 + 1e-6) / 100;
const lohnOpts = (bav) => ({
  klasse: parseNum(settings.taxClass) || 1,
  kirche: !!settings.church,
  kinder: parseNum(settings.children),
  zusatz: parseNum(settings.kvExtra),
  bav,
});

/**
 * Stunden eines Monats aus den Zetteln, aufgeteilt wie auf der Lohnabrechnung (in Stunden):
 * Feiertage nach Kalender (Mo–Fr), Urlaub und Krankheit aus den Zetteln, Überstunden wie in der Übersicht,
 * Arbeitsstunden = Soll − Feiertage − Urlaub − Krankheit (Minusstunden ziehen ab). missing: Werktage ohne Zettel.
 */
function monthHoursSplit(year, month) {
  const byDate = new Map();
  for (const s of sheets) for (const i of sheetActiveDays(s)) byDate.set(isoDate(sheetDate(s, i)), s.days[i]);
  const h = { arbeit: 0, ueber: 0, urlaub: 0, krank: 0, feiertag: 0 };
  const missing = [];
  const day = settings.hoursPerDay;
  for (const d = new Date(year, month - 1, 1); d.getMonth() === month - 1; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const entry = byDate.get(isoDate(d));
    if (holidayName(d)) h.feiertag += day;
    else if (!entry) missing.push(new Date(d));
    else if (entry.status === 'urlaub') h.urlaub += day;
    else if (entry.status === 'krank') h.krank += day;
  }
  const ot = ((overtimeAccount().get(year) || new Map()).get(month) || 0) / 60;
  h.ueber = Math.max(0, ot);
  h.arbeit = monthSollMinutes(year, month) / 60 - h.feiertag - h.urlaub - h.krank + Math.min(0, ot);
  return { hours: h, missing };
}

/** Lohn mit den Stunden der Abrechnung, nach der Rechnung der App (jede Lohnart auf Cent gerundet) */
function payWithSlipHours(p) {
  const rate = p.rate || parseNum(settings.wage);
  const h = p.hours;
  const brutto =
    cents(h.arbeit * rate) + cents(h.urlaub * rate) + cents(h.feiertag * rate) + cents(h.krank * rate) +
    cents((h.sonst || 0) * rate) + cents(h.ueber * rate * OT_FACTOR) + (p.zulage || 0);
  return nettoMonat(cents(brutto), lohnOpts(p.bav || 0));
}

/** Vergleich einer Abrechnung mit den Zetteln und der Lohnrechnung der App */
function payslipCompare(p) {
  const { hours, missing } = monthHoursSplit(p.year, p.month);
  const hourDiff = Object.fromEntries(HOUR_KINDS.map(([k]) => [k, Math.round((hours[k] - (p.hours[k] || 0)) * 100) / 100]));
  const otMin = (overtimeAccount().get(p.year) || new Map()).get(p.month) || 0;
  const app = monthPay(p.year, p.month, otMin);
  const slipNet = cents((p.netto || 0) - (p.bav || 0)); // Netto inkl. Abschlag, ohne Betriebsrente
  const withSlip = payWithSlipHours(p);
  // Bezahlte Grundstunden (ohne Überstunden) gleich, nur anders verbucht – z. B. Urlaub als Stundenlohn abgerechnet
  const baseDiff = Math.round(['arbeit', 'urlaub', 'krank', 'feiertag'].reduce((a, k) => a + hourDiff[k], 0) * 100) / 100;
  const shifted = Math.abs(baseDiff) < 0.01 && ['arbeit', 'urlaub', 'krank', 'feiertag'].some((k) => Math.abs(hourDiff[k]) >= 0.01);
  return {
    hours,
    missing,
    hourDiff,
    shifted,
    hoursOk: Math.abs(baseDiff) < 0.01 && Math.abs(hourDiff.ueber) < 0.01,
    app,
    slipNet,
    withSlip,
    netDiff: app ? cents(app.netto - slipNet) : null,
    calcDiff: cents(withSlip.netto - slipNet),
  };
}

/** „+3,00 h“, „−8,00 h“, „0,00 h“ */
const fmtHDiff = (h) => (Math.abs(h) < 0.005 ? '0,00 h' : `${h > 0 ? '+' : '−'}${fmtDec(Math.abs(h) * 60)} h`);
const fmtEuroDiff = (v) => (Math.abs(v) < 0.005 ? '0,00 €' : `${v > 0 ? '+' : '−'}${fmtMoney(Math.abs(v), true)}`);

/** Kurzfassung für die Liste in der Übersicht */
function payslipSummary(c) {
  if (c.hoursOk && c.netDiff != null && Math.abs(c.netDiff) < 0.05)
    return { ok: true, text: c.shifted ? 'Stimmt – Stunden teils anders verbucht' : 'Stunden und Netto stimmen' };
  const parts = HOUR_KINDS.filter(([k]) => (k === 'ueber' || !c.shifted) && Math.abs(c.hourDiff[k]) >= 0.01).map(([k, label]) => `${label} ${fmtHDiff(c.hourDiff[k])}`);
  if (c.netDiff != null && Math.abs(c.netDiff) >= 0.05) parts.push(`Netto ${fmtEuroDiff(c.netDiff)}`);
  return { ok: false, text: parts.join(' · ') };
}

/** Liste der Abrechnungen eines Jahres für die Übersicht */
function payslipListHTML(year) {
  const keys = Object.keys(payslips)
    .filter((k) => payslips[k].year === year)
    .sort()
    .reverse();
  if (!keys.length) return '';
  return `<div class="card list ps-list">
    <div class="ps-head">Lohnabrechnungen</div>
    ${keys
      .map((k) => {
        const p = payslips[k];
        const s = payslipSummary(payslipCompare(p));
        return `<a draggable="false" class="list-row ps-item" href="#/lohn/${k}">
          <span class="ps-dot ${s.ok ? 'ok' : 'diff'}">${s.ok ? ICON.check : '≠'}</span>
          <span class="list-main"><span class="list-title">${MONTHS[p.month - 1]}</span><span class="list-sub">${escapeHtml(s.text)}</span></span>
          <span class="list-chevron">${ICON.chevronRight}</span>
        </a>`;
      })
      .join('')}
  </div>`;
}

/** Zeile einer Vergleichstabelle: Bezeichnung | Zettel/App | Abrechnung | Unterschied */
function psRow(label, a, b, diff, bad, cls = '') {
  return `<div class="ps-row ${cls}"><span>${label}</span><span class="ov-n">${a}</span><span class="ov-n">${b}</span><b class="ov-n ${bad ? 'minus' : diff === '' ? '' : 'ok'}">${diff}</b></div>`;
}

function payslipCompareHTML(p) {
  const c = payslipCompare(p);
  const hRows = HOUR_KINDS.map(([k, label]) => {
    const d = c.hourDiff[k];
    const off = Math.abs(d) >= 0.01;
    // Nur anders verbucht (Summe gleich): orange statt rot
    return psRow(label, fmtH(c.hours[k] * 60), fmtH((p.hours[k] || 0) * 60), fmtHDiff(d), off && !(c.shifted && k !== 'ueber'), off && c.shifted && k !== 'ueber' ? 'shift' : '');
  }).join('');
  const sum = (o) => HOUR_KINDS.reduce((a, [k]) => a + (o[k] || 0), 0);
  const sumDiff = Math.round((sum(c.hours) - sum(p.hours)) * 100) / 100;
  const money = (label, appV, slipV) =>
    appV == null || slipV == null
      ? psRow(label, appV == null ? '–' : fmtMoney(appV, true), slipV == null ? '–' : fmtMoney(slipV, true), '', false)
      : psRow(label, fmtMoney(appV, true), fmtMoney(slipV, true), fmtEuroDiff(cents(appV - slipV)), Math.abs(appV - slipV) >= 0.05);
  const w = c.withSlip;
  const verdict =
    Math.abs(c.calcDiff) < 0.05
      ? `<p class="ps-verdict ok">${ICON.check} Mit den Stunden der Abrechnung kommt die App auf dasselbe Netto${Math.abs(c.calcDiff) >= 0.005 ? ` (${fmtEuroDiff(c.calcDiff)} Rundung)` : ''}.</p>`
      : `<p class="ps-verdict diff">Auch mit den Stunden der Abrechnung rechnet die App ${fmtEuroDiff(c.calcDiff)} Netto anders – prüfe Stundenlohn, Zulage und die Lohn-Einstellungen.</p>`;
  const shiftNote = c.shifted
    ? `<p class="ps-verdict shift">Bezahlt sind gleich viele Stunden, sie sind nur anders verbucht (${HOUR_KINDS.filter(([k]) => k !== 'ueber' && Math.abs(c.hourDiff[k]) >= 0.01)
        .map(([, label]) => label)
        .join(' / ')}).</p>`
    : '';
  const headline = c.hoursOk
    ? `<p class="ps-verdict ok">${ICON.check} Die bezahlten Stunden stimmen mit deinen Zetteln überein.</p>${shiftNote}`
    : `<p class="ps-verdict diff">Die Stunden weichen ab: ${HOUR_KINDS.filter(([k]) => (k === 'ueber' || !c.shifted) && Math.abs(c.hourDiff[k]) >= 0.01)
        .map(([k, label]) => `${label} ${fmtHDiff(c.hourDiff[k])}`)
        .join(', ')} laut deinen Zetteln.</p>${shiftNote}`;
  return `
    ${headline}
    <div class="card ps-table">
      <div class="ps-row ov-head"><span>Stunden</span><span class="ov-n">Zettel</span><span class="ov-n">Abrechnung</span><span class="ov-n">Unterschied</span></div>
      ${hRows}
      ${psRow('Gesamt', fmtH(sum(c.hours) * 60), fmtH(sum(p.hours) * 60), fmtHDiff(sumDiff), Math.abs(sumDiff) >= 0.01, 'ov-sum')}
    </div>
    ${c.missing.length ? `<p class="footnote">Werktage ohne Stundenzettel: ${c.missing.map((d) => fmtShort(d).slice(0, 6)).join(', ')}</p>` : ''}
    <h2 class="section-title">Lohn</h2>
    <div class="card ps-table">
      <div class="ps-row ov-head"><span>Nach deinen Zetteln</span><span class="ov-n">App</span><span class="ov-n">Abrechnung</span><span class="ov-n">Unterschied</span></div>
      ${c.app ? money('Brutto', c.app.brutto, p.brutto) + money('Steuern', c.app.lohnsteuer + c.app.soli + c.app.kirchensteuer, p.steuer) + money('Sozialabgaben', c.app.kv + c.app.rv + c.app.av + c.app.pv, p.sv) + money('Netto', c.app.netto, c.slipNet) : '<div class="ps-row"><span class="muted">Stundenlohn in den Einstellungen eintragen</span></div>'}
    </div>
    <div class="card ps-table">
      <div class="ps-row ov-head"><span>Mit den Stunden der Abrechnung</span><span class="ov-n">App</span><span class="ov-n">Abrechnung</span><span class="ov-n">Unterschied</span></div>
      ${money('Brutto', w.brutto, p.brutto)}
      ${money('Steuern', w.lohnsteuer + w.soli + w.kirchensteuer, p.steuer)}
      ${money('Sozialabgaben', w.kv + w.rv + w.av + w.pv, p.sv)}
      ${money('Netto', w.netto, c.slipNet)}
    </div>
    ${verdict}
    <p class="footnote">Netto heißt hier: alles, was im Monat bei dir ankommt (Abschlag und Auszahlung), ohne den Beitrag zur Betriebsrente.</p>`;
}

/** Eingabefeld für einen Wert der Abrechnung (Zahl mit Komma) */
function psField(label, path, value, unit) {
  const v = value == null ? '' : String(Math.round(value * 100) / 100).replace('.', ',');
  return `<label class="field"><span>${label}</span><input data-ps="${path}" inputmode="decimal" value="${v}" placeholder="–" enterkeyhint="done"><span class="unit">${unit}</span></label>`;
}

function renderPayslip(key) {
  const p = payslips[key];
  if (!p) {
    location.replace('#/uebersicht');
    return;
  }
  const chk = payslipChecks(p);
  const mark = (ok, text) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✕'} ${text}</li>`;
  app.innerHTML = `
    <header class="nav">
      <button class="nav-btn back" data-act="back" aria-label="Zurück">${ICON.back}</button>
      <span class="nav-title"></span>
      <span class="nav-btn"></span>
    </header>
    <h1 class="large-title">${MONTHS[p.month - 1]} ${p.year}</h1>
    <p class="ps-sub">Lohnabrechnung im Vergleich</p>
    <div id="ps-compare">${payslipCompareHTML(p)}</div>

    <h2 class="section-title">Werte der Abrechnung</h2>
    <div class="card form">
      <label class="field"><span>Monat</span><select data-ps="month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${p.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      ${psField('Jahr', 'year', p.year, '')}
      ${psField('Stundenlohn', 'rate', p.rate, '€')}
      ${HOUR_KINDS.map(([k, label]) => psField(label, `hours.${k}`, p.hours[k], 'h')).join('')}
      ${psField('Zulagen', 'zulage', p.zulage, '€')}
      ${psField('Gesamt-Brutto', 'brutto', p.brutto, '€')}
      ${psField('Steuern', 'steuer', p.steuer, '€')}
      ${psField('Sozialabgaben', 'sv', p.sv, '€')}
      ${psField('Netto-Verdienst', 'netto', p.netto, '€')}
      ${psField('Abschlag (bereits erhalten)', 'abschlag', p.abschlag, '€')}
      ${psField('Betriebsrente', 'bav', p.bav, '€')}
      ${psField('Auszahlung', 'auszahlung', p.auszahlung, '€')}
    </div>
    <ul class="ps-checks" id="ps-checks">${mark(chk.brutto, 'Lohnarten ergeben das Gesamt-Brutto')}${mark(chk.netto, 'Brutto − Steuern − Sozialabgaben = Netto-Verdienst')}${mark(chk.auszahlung, 'Netto − Abschlag − Betriebsrente = Auszahlung')}</ul>
    <p class="footnote">Die Werte stammen aus der Texterkennung. Vergleiche sie mit deiner Abrechnung und korrigiere sie bei Bedarf – die Prüfungen oben zeigen, ob alles zusammenpasst.</p>
    <button class="list-btn destructive card ps-delete" data-act="payslip-delete" data-key="${key}">Lohnabrechnung löschen</button>`;
}

/** Wert aus dem Eingabefeld übernehmen und den Vergleich neu zeigen (die Felder selbst bleiben stehen) */
function updatePayslipField(input) {
  const key = location.hash.replace('#/lohn/', '');
  const p = payslips[key];
  if (!p) return;
  const path = input.dataset.ps;
  const v = path === 'month' ? Number(input.value) : input.value.trim() === '' ? null : parseNum(input.value);
  if (path.startsWith('hours.')) p.hours[path.slice(6)] = v || 0;
  else p[path] = v;
  if (path === 'month' || path === 'year') {
    // Anderer Monat: unter dem neuen Schlüssel speichern
    const nk = payKey(p.year, p.month);
    if (nk !== key && p.year > 2000) {
      delete payslips[key];
      payslips[nk] = p;
      savePayslips();
      location.replace(`#/lohn/${nk}`);
      return;
    }
  }
  savePayslips();
  document.getElementById('ps-compare').innerHTML = payslipCompareHTML(p);
  const chk = payslipChecks(p);
  const mark = (ok, text) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✕'} ${text}</li>`;
  document.getElementById('ps-checks').innerHTML = `${mark(chk.brutto, 'Lohnarten ergeben das Gesamt-Brutto')}${mark(chk.netto, 'Brutto − Steuern − Sozialabgaben = Netto-Verdienst')}${mark(chk.auszahlung, 'Netto − Abschlag − Betriebsrente = Auszahlung')}`;
}

/** Foto einer Lohnabrechnung einlesen (Kamera oder Mediathek) */
async function importPayslip(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const modal = openModal(
    `<div class="ps-progress"><b>Lohnabrechnung wird gelesen …</b><div class="ps-bar"><i style="width:3%"></i></div><p class="muted" id="ps-step">Texterkennung wird geladen</p></div>`,
    'alert ps-modal'
  );
  const bar = modal.querySelector('.ps-bar i');
  const step = modal.querySelector('#ps-step');
  try {
    const text = await recognizePayslip(file, (v) => {
      bar.style.width = `${Math.round(5 + v * 95)}%`;
      step.textContent = `Text wird erkannt: ${Math.round(v * 100)} %`;
    });
    const p = parsePayslipText(text);
    if (!p.month) {
      // Monat nicht erkannt: Vormonat annehmen (Abrechnungen kommen Anfang des Folgemonats)
      const d = new Date();
      d.setDate(0);
      p.month = d.getMonth() + 1;
      p.year = d.getFullYear();
    }
    if (!p.rate && !p.brutto && !p.netto) throw new Error('Auf dem Foto wurde keine Lohnabrechnung erkannt.');
    p.importedAt = Date.now();
    const key = payKey(p.year, p.month);
    const store = () => {
      payslips[key] = p;
      savePayslips();
      closeModal(true);
      location.hash = `#/lohn/${key}`;
      const chk = payslipChecks(p);
      toast(chk.brutto && chk.netto && chk.auszahlung ? 'Eingelesen – alle Prüfungen stimmen' : 'Eingelesen – bitte Werte prüfen', 3000);
    };
    if (payslips[key]) {
      closeModal(true);
      confirmDialog(`${MONTHS[p.month - 1]} ${p.year} ersetzen?`, 'Für diesen Monat gibt es schon eine Lohnabrechnung.', 'Ersetzen', store);
    } else store();
  } catch (err) {
    closeModal(true);
    confirmDialog('Einlesen nicht möglich', escapeHtml(err.message || String(err)), 'OK', () => {});
  }
}
/** „+3,50 h“ / „−2,00 h“ */
const fmtSigned = (min) => (min > 0 ? '+' : min < 0 ? '−' : '') + fmtH(Math.abs(min));

/** Feiertage (Mo–Fr) eines Zettels als „Feiertag“ markieren, nur an Tagen ohne Einträge */
function markHolidays(s) {
  s.days.forEach((d, i) => {
    if (i > 4 || !sheetIsActive(s, i) || d.status || dayHasTimes(d) || d.rows.some((r) => r.site || r.work)) return;
    if (holidayName(sheetDate(s, i))) d.status = 'feiertag';
  });
}

/** Hinweise vor dem Senden: unvollständige Zeilen, Überschneidungen, fehlende Angaben, leere Werktage */
function sheetProblems(s) {
  const problems = [];
  s.days.forEach((d, i) => {
    if (!sheetIsActive(s, i) || !canWork(d)) return;
    const day = WEEKDAYS[i];
    const timed = [];
    d.rows.forEach((r, k) => {
      const where = d.rows.length > 1 ? `${day}, Zeile ${k + 1}` : day;
      const missing = [
        ['start', 'Beginn'],
        ['end', 'Ende'],
        ['site', 'Baustelle'],
        ['work', 'Art der Arbeit'],
      ]
        .filter(([f]) => fieldMissing(d, r, f))
        .map(([, label]) => label);
      if (endBeforeStart(r)) problems.push(`${where}: Ende ${fmtTime(r.end)} liegt vor Beginn ${fmtTime(r.start)}`);
      if (sameStartEnd(r)) problems.push(`${where}: Beginn und Ende sind gleich (${fmtTime(r.start)})`);
      if (missing.length) problems.push(`${where}: ${missing.join(', ')} ${missing.length > 1 ? 'fehlen' : 'fehlt'}`);
      if (r.start != null && r.end != null && r.end > r.start) timed.push(r);
    });
    if (rowsOutOfOrder(d).size) problems.push(`${day}: Zeilen nicht in zeitlicher Reihenfolge`);
    timed.sort((a, b) => a.start - b.start);
    for (let k = 1; k < timed.length; k++) {
      const a = timed[k - 1];
      const b = timed[k];
      if (b.start < a.end) {
        problems.push(`${day}: ${fmtTime(a.start)}–${fmtTime(a.end)} und ${fmtTime(b.start)}–${fmtTime(b.end)} überschneiden sich`);
      } else if (b.start > a.end) {
        problems.push(`${day}: Lücke von ${fmtTime(a.end)} bis ${fmtTime(b.start)}`);
      }
    }
    if (pauseMissing(d)) problems.push(`${day}: Pause fehlt`);
    if (i < 5 && !d.status && !dayStarted(d)) problems.push(`${day}: kein Eintrag`);
  });
  return problems;
}

/** Speichert alle Zettel; ein geänderter Zettel bekommt den Zeitstempel „zuletzt geändert“. */
function saveSheets(changed) {
  if (changed) changed.updatedAt = Date.now();
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(sheets));
  } catch {
    toast('Speichern fehlgeschlagen!');
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    toast('Speichern fehlgeschlagen!');
  }
}

// Speicher als dauerhaft markieren, damit iOS ihn nicht aufräumt
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const findSheet = (id) => sheets.find((s) => s.id === id);
const existingSheet = (anchor, excludeId) => sheets.find((s) => s.id !== excludeId && sheetMatches(s, anchor));

function openOrCreate(anchor) {
  const found = existingSheet(anchor);
  if (found) return found.id;
  const s = newSheet(anchor, settings.name);
  markHolidays(s);
  sheets.push(s);
  saveSheets();
  return s.id;
}

/** Bisher verwendete Einträge, die häufigsten zuerst. */
function collectSuggestions(field) {
  const counts = new Map();
  for (const s of sheets)
    for (const d of s.days)
      for (const r of d.rows) {
        // Art der Arbeit: „Spachteln, Schleifen“ ergibt zwei Vorschläge
        const parts = field === 'work' ? (r[field] || '').split(',') : [r[field] || ''];
        for (const part of parts) {
          const v = part.trim();
          if (!v) continue;
          // Verschiedene Apostrophe / Groß- und Kleinschreibung ergeben einen Vorschlag
          const key = sameKey(v);
          if (!counts.has(key)) counts.set(key, { total: 0, spellings: new Map() });
          const c = counts.get(key);
          c.total++;
          c.spellings.set(v, (c.spellings.get(v) || 0) + 1);
        }
      }
  // Ausgeblendete Vorschläge (langes Drücken in der Leiste) bleiben weg, bis sie wiederhergestellt werden
  const hidden = new Set(settings.hiddenSuggestions[field].map(sameKey));
  return [...counts]
    .filter(([key]) => !hidden.has(key))
    // angezeigt wird die häufigste Schreibweise
    .map(([, c]) => [[...c.spellings].sort((a, b) => b[1] - a[1])[0][0], c.total])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))
    .map(([v]) => v);
}

/** Wie oft welche Art der Arbeit an welcher Baustelle eingetragen wurde: Baustelle → (Tätigkeit → Anzahl), klein geschrieben */
function collectWorkBySite() {
  const map = new Map();
  for (const s of sheets)
    for (const d of s.days)
      for (const r of d.rows) {
        const site = sameKey(r.site);
        if (!site) continue;
        if (!map.has(site)) map.set(site, new Map());
        const works = map.get(site);
        for (const part of (r.work || '').split(',')) {
          const w = sameKey(part);
          if (w) works.set(w, (works.get(w) || 0) + 1);
        }
      }
  return map;
}

// ───────────────────────── Icons ─────────────────────────

const svg = (path, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
/** Warndreieck in Rot (Emoji ⚠️ ist immer gelb) */
const WARN =
  '<svg class="warn-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.27 3.5a2 2 0 0 1 3.46 0l8.47 14.67A2 2 0 0 1 20.47 21H3.53a2 2 0 0 1-1.73-2.83z" fill="var(--danger)"/><rect x="11" y="8" width="2" height="7.2" rx="1" fill="#fff"/><circle cx="12" cy="17.6" r="1.25" fill="#fff"/></svg>';

const ICON = {
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 20),
  back: svg('<path d="M15 18l-6-6 6-6"/>', 24),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 18),
  send: svg('<path d="M4 4h16v16H4z" stroke="none"/><path d="M22 6l-10 7L2 6"/><rect x="2" y="4" width="20" height="16" rx="2"/>', 20),
  check: svg('<path d="M20 6L9 17l-5-5"/>', 14),
  close: svg('<path d="M18 6L6 18M6 6l12 12"/>', 16),
  chevronLeft: svg('<path d="M15 18l-6-6 6-6"/>', 20),
  chevronRight: svg('<path d="M9 18l6-6-6-6"/>', 20),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 22),
  pin: svg('<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>', 15),
  suitcaseSmall: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>', 16),
  suitcase: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>', 22),
  urlaub: svg('<path d="M12 4a8 8 0 0 1 8 8H4a8 8 0 0 1 8-8z"/><path d="M12 12v7a2 2 0 0 0 4 0"/>', 14),
  krank: svg('<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>', 14),
  feiertag: svg('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>', 14),
  frei: svg('<path d="M4 9h12v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2 2 0 0 1 0 4H16M8 4v2M12 4v2"/>', 14),
  tool: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.6 17.4a1.4 1.4 0 0 0 2 2l5.7-5.7a4 4 0 0 0 5.4-5.4l-2.4 2.4-2-2z"/>', 15),
};

// ───────────────────────── Routing ─────────────────────────

const app = document.getElementById('app');
let listScroll = 0;
let currentView = '';
/** Suchbegriff in der Liste; null = Suche geschlossen */
let searchQuery = null;

function route() {
  const hash = location.hash;
  const m = hash.match(/^#\/zettel\/(.+)$/);
  const tm = hash.match(/^#\/reise\/(.+)$/);
  const lm = hash.match(/^#\/lohn\/(\d{4}-\d{2})$/);
  if (currentView === 'list') listScroll = window.scrollY;
  if (currentView === 'trip') dropEmptyTrip();
  closeModal(true);
  trimWorkInput(suggestInput);
  hideChips();
  if (tm) {
    currentView = 'trip';
    renderTrip(decodeURIComponent(tm[1]));
    syncNav();
    window.scrollTo(0, 0);
  } else if (m) {
    currentView = 'editor';
    renderEditor(decodeURIComponent(m[1]));
    syncNav();
    window.scrollTo(0, 0);
  } else if (hash === '#/einstellungen') {
    currentView = 'settings';
    renderSettings();
    syncNav();
    window.scrollTo(0, 0);
  } else if (hash === '#/reisekosten') {
    currentView = 'trips';
    renderTripList();
    syncNav();
    window.scrollTo(0, 0);
  } else if (lm) {
    currentView = 'payslip';
    renderPayslip(lm[1]);
    syncNav();
    window.scrollTo(0, 0);
  } else if (hash === '#/uebersicht') {
    currentView = 'stats';
    renderStats();
    syncNav();
    window.scrollTo(0, 0);
  } else {
    currentView = 'list';
    renderList();
    syncNav();
    window.scrollTo(0, listScroll);
  }
  updateTopButton();
}
window.addEventListener('hashchange', route);

function goBack() {
  if (history.length > 1 && history.state !== 'root') history.back();
  else location.hash = '#/';
}

// ───────────────────────── Liste ─────────────────────────

function renderList() {
  const searching = searchQuery != null;
  app.innerHTML = `
    <header class="nav">
      ${
        searching
          ? `<div class="search-bar">
              <span class="search-field">${ICON.search}<input type="search" data-search placeholder="Baustelle, Urlaub oder Datum" value="${escapeHtml(searchQuery)}" autocomplete="off" enterkeyhint="search"></span>
              <button class="nav-btn" data-act="search-close">Abbrechen</button>
            </div>`
          : `<button class="nav-btn" data-act="settings" aria-label="Einstellungen">${ICON.gear}</button>
            <span class="nav-title"></span>
            ${sheets.length ? `<button class="nav-btn" data-act="search" aria-label="Suchen">${ICON.search}</button>` : '<span class="nav-btn"></span>'}`
      }
    </header>
    ${!searching && sheets.length ? statsCardHTML() + tripsCardHTML() : ''}
    ${searching ? '' : '<h1 class="large-title">Stundenzettel</h1>'}
    <div id="list-body">${listBodyHTML()}</div>
    ${
      searching
        ? `<button class="to-top floating" data-act="to-top" aria-label="Nach oben">${ICON.up}</button>`
        : `<div class="bottom-bar">
            <button class="to-top" data-act="to-top" aria-label="Nach oben">${ICON.up}</button>
            <button class="primary" data-act="new">${ICON.plus} Neuer Stundenzettel</button>
          </div>`
    }`;
}

/**
 * Fehlende Zettel: Wochen bzw. Teilwochen (am Monatswechsel) mit Werktagen, für die es keinen Zettel gibt –
 * vom ersten Zettel bis zum letzten Zettel bzw. bis zur aktuellen Woche (die zählt noch nicht).
 * Teilwochen, deren Werktage alle Feiertage sind, fehlen nicht. Ergebnis: Zettel-Vorlagen (nicht gespeichert).
 */
function missingSheets() {
  if (!sheets.length) return [];
  const have = new Set(sheets.map((s) => `${s.weekStart}|${s.year}|${s.month}`));
  let first = sheetFirstDate(sheets[0]);
  let last = sheetLastDate(sheets[0]);
  for (const s of sheets) {
    if (sheetFirstDate(s) < first) first = sheetFirstDate(s);
    if (sheetLastDate(s) > last) last = sheetLastDate(s);
  }
  const thisWeek = mondayOf(new Date());
  const end = last > thisWeek ? last : thisWeek;
  const seen = new Set();
  const out = [];
  for (let d = startOfDay(first); d < end; d = addDays(d, 1)) {
    if ((d.getDay() + 6) % 7 > 4) continue;
    const n = newSheet(d, '');
    const key = `${n.weekStart}|${n.year}|${n.month}`;
    if (have.has(key) || seen.has(key)) continue;
    seen.add(key);
    const workdays = sheetActiveDays(n).filter((i) => i < 5 && sheetDate(n, i) < end);
    if (workdays.length && workdays.every((i) => holidayName(sheetDate(n, i)))) continue;
    out.push(n);
  }
  return out;
}

/** Zeile für eine Lücke (eine oder mehrere fehlende Wochen hintereinander, neueste zuerst) */
function gapRowHTML(gap) {
  const newest = gap[0];
  const oldest = gap.at(-1);
  const partial = (n) => sheetActiveDays(n).length < 7;
  const kw = (n) => isoWeek(parseDate(n.weekStart));
  const title =
    gap.length === 1
      ? `KW ${kw(newest)} fehlt${partial(newest) ? ' (Teilwoche)' : ''}`
      : `KW ${kw(oldest)}–${kw(newest)} fehlen`;
  return `<button class="list-gap" data-act="gap" data-date="${isoDate(sheetFirstDate(oldest))}" data-count="${gap.length}">
    <span class="gap-icon">${ICON.plus}</span>
    <span class="list-main">
      <span class="list-title">${title}</span>
      <span class="list-sub">${fmtShort(sheetFirstDate(oldest))} – ${fmtShort(sheetLastDate(newest))}</span>
    </span>
  </button>`;
}

function listBodyHTML() {
  const searching = searchQuery != null;
  const query = searching ? parseQuery(searchQuery) : null;
  const groups = new Map();
  const hits = new Map();
  const group = (key) => {
    if (!groups.has(key)) groups.set(key, []);
    return groups.get(key);
  };
  for (const s of sheets) {
    if (query) {
      const hit = searchSheet(s, query);
      if (!hit) continue;
      hits.set(s.id, hit);
    }
    group(s.year * 100 + s.month).push(s);
  }
  // Lücken nur in der normalen Liste, nicht in der Suche
  if (!searching) for (const n of missingSheets()) group(n.year * 100 + n.month).push({ ...n, missing: true });
  const keys = [...groups.keys()].sort((a, b) => b - a);

  if (keys.length) {
    return keys
      .map((k) => {
        const list = groups.get(k).sort((a, b) => sheetFirstDate(b) - sheetFirstDate(a));
        const monthTotal = list.filter((sh) => !sh.missing).reduce((t, sh) => t + sheetTotal(sh), 0);
        // aufeinanderfolgende fehlende Wochen zu einer Zeile zusammenfassen
        const rows = [];
        for (const sh of list) {
          if (sh.missing && Array.isArray(rows.at(-1))) rows.at(-1).push(sh);
          else rows.push(sh.missing ? [sh] : sh);
        }
        return `<h2 class="section-title month-head"><span>${MONTHS[(k % 100) - 1]} ${Math.floor(k / 100)}</span>${searching ? '' : `<span class="month-total">Gesamt ${fmtH(monthTotal)}</span>`}</h2>
        <div class="card list">${rows.map((r) => (Array.isArray(r) ? gapRowHTML(r) : listRowHTML(r, hits.get(r.id)))).join('')}</div>`;
      })
      .join('');
  }
  if (searching) {
    return query
      ? `<p class="search-empty muted">Keine Stundenzettel gefunden</p>`
      : `<p class="search-empty muted">Suche nach einer Baustelle (z. B. „Lindenstraße“), nach „Urlaub“ oder „Krank“ oder nach einem Datum (z. B. „15.09.“).</p>`;
  }
  return `<div class="empty">
      <div class="empty-icon">${svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>', 44)}</div>
      <p><b>Noch keine Stundenzettel</b></p>
      <p class="muted">${settings.name.trim() ? 'Tippe unten auf „Neuer Stundenzettel“ und wähle eine Woche.' : 'Trage zuerst oben links unter Einstellungen deinen Namen ein. Danach tippst du unten auf „Neuer Stundenzettel“.'}</p>
    </div>`;
}

/** Suchbegriff deuten: Datum „15.09.“ / „15.9.26“ / „15.09.2026“ oder Text */
function parseQuery(raw) {
  const q = raw.trim();
  if (!q) return null;
  const m = q.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    return { day: Number(m[1]), month: Number(m[2]), year };
  }
  return { text: searchKey(q) };
}

/** Treffer in einem Zettel: { label } für die Zeile in der Liste, sonst null */
function searchSheet(s, query) {
  const days = sheetActiveDays(s);
  if (query.text) {
    const found = new Set();
    const dayNames = [];
    for (const i of days) {
      let dayHit = false;
      // Tagesart (Urlaub, Krank, …) zählt als Treffer, die Zeilen des Tages dann nicht
      const status = s.days[i].status;
      if (status) {
        if ([DAY_STATUS_SHORT[status], DAY_STATUS[status]].some((v) => searchKey(v).includes(query.text))) {
          found.add(DAY_STATUS_SHORT[status]);
          dayHit = true;
        }
        // Am Feiertag zählen zusätzlich die Zeilen (Notdienst)
        if (!canWork(s.days[i])) {
          if (dayHit) dayNames.push(WEEKDAYS_SHORT[i]);
          continue;
        }
      }
      for (const r of s.days[i].rows) {
        for (const v of [r.site, r.work]) {
          if (v && searchKey(v).includes(query.text)) {
            found.add(v.trim());
            dayHit = true;
          }
        }
      }
      if (dayHit) dayNames.push(WEEKDAYS_SHORT[i]);
    }
    return found.size ? { label: `${dayNames.join(', ')} · ${[...found].join(', ')}` } : null;
  }
  for (const i of days) {
    const d = sheetDate(s, i);
    if (d.getDate() === query.day && d.getMonth() + 1 === query.month && (query.year == null || d.getFullYear() === query.year)) {
      return { label: `${WEEKDAYS[i]}, ${fmtShort(d)}` };
    }
  }
  return null;
}

function refreshListBody() {
  const body = document.getElementById('list-body');
  if (body) body.innerHTML = listBodyHTML();
}

/** Höhe der festen Kopfzeile, damit Sprungziele nicht darunter verschwinden */
const navHeight = () => document.querySelector('.nav')?.offsetHeight || 0;

/** Die Kopfzeile ist fest (position: fixed), weil iOS eine haftende Kopfzeile beim Nachfedern am Seitenende
 *  mit wegschiebt. Der Inhalt bekommt oben Platz in ihrer Höhe (--nav-h), auch wenn sie ihre Höhe ändert. */
const navResize = new ResizeObserver(() => document.documentElement.style.setProperty('--nav-h', `${navHeight()}px`));
function syncNav() {
  const nav = document.querySelector('.nav');
  document.documentElement.style.setProperty('--nav-h', `${navHeight()}px`);
  navResize.disconnect();
  // Rahmengröße beobachten: Der obere Rand (Uhrzeit, Dynamic Island) steckt im Innenabstand und kommt
  // beim Start teils erst nachträglich dazu – die reine Inhaltshöhe ändert sich dabei nicht
  if (nav) navResize.observe(nav, { box: 'border-box' });
}
new MutationObserver(syncNav).observe(app, { childList: true });

/** Knopf „nach oben“ erst zeigen, wenn weit genug gescrollt wurde */
function updateTopButton() {
  const btn = document.querySelector('.to-top');
  if (btn) btn.classList.toggle('show', window.scrollY > 300);
}
window.addEventListener('scroll', () => requestAnimationFrame(updateTopButton), { passive: true });

const fmtNum = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const fmtDays = (n) => `${fmtNum(n)} ${n === 1 ? 'Tag' : 'Tage'}`;

function statsCardHTML() {
  const year = new Date().getFullYear();
  const st = absenceStats().get(year) || { urlaub: 0, krank: 0 };
  const month = new Date().getMonth() + 1;
  const pay = monthPay(year, month, (overtimeAccount().get(year) || new Map()).get(month) || 0);
  return `<a draggable="false" class="card stats-card" href="#/uebersicht">
    <span class="stats-year">${year}</span>
    <span class="stats-item"><span class="stats-num">${st.urlaub}</span><span class="stats-label">${st.urlaub === 1 ? 'Urlaubstag' : 'Urlaubstage'}</span></span>
    <span class="stats-item">${
      pay
        ? `<span class="stats-num">${fmtMoney(pay.netto)}</span><span class="stats-label">Netto ${MONTHS[month - 1]} (Prognose)</span>`
        : `<span class="stats-num muted">– €</span><span class="stats-label">Netto: Lohn eintragen</span>`
    }</span>
    <span class="list-chevron">${ICON.chevronRight}</span>
  </a>`;
}

const balanceClass = (min) => (min > 0 ? 'plus' : min < 0 ? 'minus' : '');
/** „+12,50“ mit kleinem „h“ dahinter (große Zahlen auf Karten) */
const hoursHTML = (min) => `${fmtSigned(min).replace(/ h$/, '')}<small> h</small>`;
const OV_ICON = {
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 18),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 18),
  cross: svg('<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>', 18),
};

function renderStats() {
  const stats = absenceStats();
  const account = overtimeAccount();
  const current = new Date().getFullYear();
  if (!stats.has(current)) stats.set(current, { urlaub: 0, krank: 0 });
  account.forEach((_, y) => { if (!stats.has(y)) stats.set(y, { urlaub: 0, krank: 0 }); });
  const years = [...stats.keys()].sort((a, b) => b - a);
  app.innerHTML = `
    <header class="nav">
      <button class="nav-btn back" data-act="back" aria-label="Zurück">${ICON.back}</button>
      <span class="nav-title"></span>
      <span class="nav-btn"></span>
    </header>
    <h1 class="large-title">Übersicht</h1>
    ${years
      .map((y) => {
        const st = stats.get(y);
        const ot = yearBalance(account.get(y) || new Map());
        return `<h2 class="section-title ov-year">${y}${y === current ? '<span class="ov-badge">laufendes Jahr</span>' : ''}</h2>
        <div class="ov-tiles">
          <div class="ov-tile ov-hero">
            <span class="ov-icon ot">${OV_ICON.clock}</span>
            <span class="ov-label">Überstunden</span>
            <span class="ov-num ${balanceClass(ot)}">${hoursHTML(ot)}</span>
          </div>
          <div class="ov-tile">
            <span class="ov-icon vac">${OV_ICON.sun}</span>
            <span class="ov-num">${fmtNum(st.urlaub)}</span>
            <span class="ov-label">${st.urlaub === 1 ? 'Urlaubstag' : 'Urlaubstage'}</span>
          </div>
          <div class="ov-tile">
            <span class="ov-icon sick">${OV_ICON.cross}</span>
            <span class="ov-num">${fmtNum(st.krank)}</span>
            <span class="ov-label">${st.krank === 1 ? 'Krankheitstag' : 'Krankheitstage'}</span>
          </div>
        </div>
        ${account.has(y) ? overtimeYearHTML(y, account.get(y)) : ''}
        ${payslipListHTML(y)}`;
      })
      .join('')}
    <div class="card list ps-import">
      <label class="list-btn">Lohnabrechnung einlesen …<input type="file" accept="image/*" data-act-change="payslip-import" hidden></label>
    </div>
    <p class="footnote">Foto aufnehmen oder aus der Mediathek wählen. Die App liest die Abrechnung und vergleicht sie mit deinen Zetteln. Das Foto bleibt auf dem iPhone und wird nicht gespeichert.</p>
    <p class="footnote">Gezählt werden alle Tage, die du als Urlaub oder Krankheit markiert hast.</p>
    ${sheets.length ? `<p class="footnote">Überstunden: Pro Werktag zählt alles über ${fmtH(Math.round((settings.target * 60) / 5))}. Nur Tage mit Stundenzettel zählen. Plus und Minus werden verrechnet. Stunden: wie „Stunden Gesamt“ im Stundenzettel, Urlaub, Krankheit und Feiertage mit je ${fmtH(statusCredit('urlaub'))}.</p>` : ''}`;
}

/**
 * Je Monat die gearbeiteten Stunden (Stunden Gesamt), die Überstunden und – mit Stundenlohn in den Einstellungen –
 * das geschätzte Netto als Tabelle, neuester Monat oben, darunter die Summe. Laufender Monat: Prognose („≈“).
 */
function overtimeYearHTML(year, months) {
  const worked = overtimeAccount(true).get(year) || new Map();
  const total = yearBalance(worked);
  const ot = yearBalance(months);
  const keys = [...months.keys()].sort((a, b) => b - a);
  const withPay = hasWage();
  const pay = new Map(keys.map((m) => [m, withPay ? monthPay(year, m, months.get(m)) : null]));
  const now = new Date();
  const net = (m) => `${year === now.getFullYear() && m === now.getMonth() + 1 ? '≈ ' : ''}${fmtMoney(pay.get(m).netto)}`;
  const cls = withPay ? 'ov-row c4' : 'ov-row';
  const rows = keys
    .map((m) => {
      const v = months.get(m);
      return `<div class="${cls}">
        <span>${MONTHS[m - 1]}</span>
        <span class="ov-n">${fmtH(worked.get(m) || 0)}</span>
        <b class="ov-n ${balanceClass(v)}">${fmtSigned(v)}</b>
        ${withPay ? `<b class="ov-n">${net(m)}</b>` : ''}
      </div>`;
    })
    .join('');
  const netSum = keys.reduce((a, m) => a + (pay.get(m) ? pay.get(m).netto : 0), 0);
  return `<div class="card ov-months">
    <div class="${cls} ov-head"><span>Monat</span><span class="ov-n">Stunden</span><span class="ov-n">${withPay ? 'Überstd.' : 'Überstunden'}</span>${withPay ? '<span class="ov-n">Netto</span>' : ''}</div>
    ${rows}
    <div class="${cls} ov-sum"><span>Gesamt</span><span class="ov-n">${fmtH(total)}</span><b class="ov-n ${balanceClass(ot)}">${fmtSigned(ot)}</b>${withPay ? `<b class="ov-n">${fmtMoney(netSum)}</b>` : ''}</div>
  </div>`;
}

function listRowHTML(s, hit) {
  const sent = !!s.sentAt;
  return `<div class="swipe">
    <div class="swipe-track">
      <a draggable="false" class="list-row" href="#/zettel/${encodeURIComponent(s.id)}">
        <span class="status ${sent ? 'sent' : 'open'}">${sent ? ICON.check : ''}</span>
        <span class="list-main">
          <span class="list-title">${fmtShort(sheetFirstDate(s))} – ${fmtShort(sheetLastDate(s))}${sheetHasWarning(s) ? ` <span class="list-warn">${WARN}</span>` : ''}${
            tripsForSheet(s).some((t) => t.dates.length) ? `<button class="list-trip" data-act="open-trip" data-id="${s.id}" aria-label="Reisekostenabrechnung öffnen">${ICON.suitcaseSmall}</button>` : ''
          }</span>
          <span class="list-sub">KW ${isoWeek(parseDate(s.weekStart))} · ${sent ? 'gesendet' : 'offen'}</span>
          ${hit ? `<span class="list-hit">${escapeHtml(hit.label)}</span>` : ''}
        </span>
        <span class="list-hours">${fmtH(sheetTotal(s))}</span>
        <span class="list-chevron">${ICON.chevronRight}</span>
      </a>
      <button class="swipe-del" data-act="delete" data-id="${s.id}">Löschen</button>
    </div>
  </div>`;
}

// ───────────────────────── Editor ─────────────────────────

let editorId = null;
let suggestions = { site: [], work: [] };
let workBySite = new Map();
/** Aufgeklappte leere Wochenendtage („Zettel-ID:Tag“), nur solange die App offen ist */
const expandedDays = new Set();

function renderEditor(id) {
  const s = findSheet(id);
  if (!s) {
    location.replace('#/');
    return;
  }
  editorId = id;
  suggestions = { site: collectSuggestions('site'), work: collectSuggestions('work') };
  workBySite = collectWorkBySite();

  app.innerHTML = `
    <header class="nav">
      <button class="nav-btn back" data-act="back" aria-label="Zurück">${ICON.back}</button>
      <button class="nav-title" data-act="week" id="nav-title">${fmtShort(sheetFirstDate(s))} – ${fmtShort(sheetLastDate(s))}</button>
      <span class="nav-actions">
        <button class="nav-btn" data-act="share" aria-label="Als PDF senden">${ICON.share}</button>
        <button class="nav-btn" data-act="more" aria-label="Weitere Aktionen">${ICON.more}</button>
      </span>
      <div class="daybar" id="daybar">${dayBarHTML(s)}</div>
    </header>
    <div id="days">${daysHTML(s)}</div>
    <div class="sum-bar" id="summary">${summaryHTML(s)}</div>
    ${pdfThumbHTML('Zettel')}`;
  fitRowTexts();
  requestAnimationFrame(fitRowTexts);
  updatePdfThumb(true);
}

/** Kurze Stundenangabe für die Tagesleiste: „9,5“ */
const fmtTiny = (min) => String(Math.round((min / 60) * 100) / 100).replace('.', ',');

/** Tagesleiste: Mo–So mit Stunden, heute markiert */
function dayBarHTML(s) {
  const today = new Date();
  return `${s.days
    .map((d, i) => {
      if (!sheetIsActive(s, i)) return `<span class="db-day off"><span class="db-name">${WEEKDAYS_SHORT[i]}</span><span class="db-h"></span></span>`;
      const total = dayTotal(d);
      const cls = ['db-day', sameDay(sheetDate(s, i), today) ? 'today' : '', d.status ? `status-${d.status} has-status` : ''].join(' ');
      return `<button class="${cls}" data-act="jump" data-day="${i}">
        <span class="db-name">${WEEKDAYS_SHORT[i]}${dayHasWarning(d) ? `<span class="db-warn">${WARN}</span>` : ''}</span>
        <span class="db-h">${d.status && !holidayWork(d) ? DAY_STATUS_SHORT[d.status].slice(0, 2) + '.' : total ? fmtTiny(total) : '–'}</span>
      </button>`;
    })
    .join('')}`;
}

/** Alle Tage; zusammenhängende Tage des anderen Monats werden zu einer schmalen Zeile */
function daysHTML(s) {
  let html = '';
  for (let i = 0; i < 7; ) {
    if (sheetIsActive(s, i)) {
      html += dayHTML(s, i);
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && !sheetIsActive(s, j + 1)) j++;
    const range = i === j ? WEEKDAYS_SHORT[i] : `${WEEKDAYS_SHORT[i]} – ${WEEKDAYS_SHORT[j]}`;
    html += `<div class="other-month">${range} ${i === 0 ? 'vorheriger' : 'nächster'} Monat</div>`;
    i = j + 1;
  }
  return html;
}

/** Leerer Sa/So ohne Tagesart wird eingeklappt angezeigt */
const dayCollapsed = (s, i) => {
  const d = s.days[i];
  return i >= 5 && !d.status && !d.pause && d.rows.every(rowIsEmpty) && !expandedDays.has(`${s.id}:${i}`);
};

function dayHTML(s, i) {
  const day = s.days[i];
  const date = sheetDate(s, i);
  const head = `<div class="day-head">
      <div><b>${WEEKDAYS[i]}</b> <span class="muted">${fmtDayMonth(date)}</span></div>
      <div class="day-actions">
        <button class="chip-btn status-btn ${day.status ? 'set status-' + day.status : ''}" data-act="status">${day.status ? DAY_STATUS_SHORT[day.status] : 'Arbeit'} ▾</button>
      </div>
    </div>`;
  if (dayCollapsed(s, i)) {
    return `<section class="day collapsed wd-${i}" data-day="${i}">
      ${head}
      <button class="link-btn expand-btn" data-act="expand">${ICON.plus} Arbeit eintragen</button>
    </section>`;
  }
  const rowsAndFoot = () => `${day.rows.map((r) => rowHTML(day, r)).join('')}
    <div class="day-foot">
      <button class="link-btn" data-act="addrow">${ICON.plus} Zeile</button>
      <button class="pill ${day.pause == null ? 'empty' : ''}" data-act="pause">Pause${day.pause == null ? '' : ` ${fmtH(day.pause)}`}${pauseMissing(day) ? ` ${WARN}` : ''}</button>
      <span class="day-total">Gesamt <b>${fmtH(dayTotal(day))}</b></span>
    </div>`;
  if (day.status) {
    // Kompakte Zeile: Wochentag links, rechts farbiges Etikett (zugleich Auswahl der Tagesart)
    const holiday = day.status === 'feiertag' ? holidayName(date) : '';
    // Feiertag: darunter Arbeit eintragen (z. B. Notdienst), zählt zusätzlich zu den 8 Stunden
    const working = day.status === 'feiertag' && (holidayWork(day) || expandedDays.has(`${s.id}:${i}`));
    const extra =
      day.status !== 'feiertag'
        ? ''
        : working
          ? rowsAndFoot()
          : `<button class="link-btn expand-btn" data-act="expand">${ICON.plus} Arbeit eintragen (z. B. Notdienst)</button>`;
    return `<section class="day status-day status-${day.status} wd-${i}${working ? ' has-work' : ''}" data-day="${i}">
      <div class="day-head status-head">
        <div class="status-when"><div class="status-day-line"><b>${WEEKDAYS[i]}</b> <span class="muted">${fmtDayMonth(date)}</span></div>${holiday ? `<div class="status-sub">${escapeHtml(holiday)}</div>` : ''}</div>
        <button class="chip-btn status-btn set status-tag" data-act="status">${ICON[day.status]} ${DAY_STATUS_SHORT[day.status]} · ${fmtH(statusCredit(day.status))} ▾</button>
      </div>
      ${extra}
    </section>`;
  }
  return `<section class="day wd-${i}" data-day="${i}">
    ${head}
    ${rowsAndFoot()}
  </section>`;
}

function chooseStatus(btn) {
  const { s, dayIndex, day } = rowContext(btn);
  const set = (status) => {
    if (status) day.status = status;
    else delete day.status;
    saveSheets(s);
    refreshDay(dayIndex);
  };
  actionSheet([
    { label: `${day.status ? '' : '✓ '}Arbeitstag`, run: () => set(null) },
    ...Object.entries(DAY_STATUS).map(([key, label]) => ({
      label: `${day.status === key ? '✓ ' : ''}${label}`,
      run: () => set(key),
    })),
  ]);
}

function rowHTML(day, r) {
  const rowCount = day.rows.length;
  const m = rowMinutes(r);
  const timeBtn = (which, label) => {
    const v = r[which];
    return `<button class="time ${v == null ? 'empty' : ''}" data-act="time" data-which="${which}">${v == null ? label : fmtTime(v)}</button>`;
  };
  return `<div class="row" data-row="${r.id}">
    <div class="row-times">
      ${timeBtn('start', 'Beginn')}
      <span class="arrow">–</span>
      ${timeBtn('end', 'Ende')}
      <span class="time-warn ${timeWarning(day, r) ? 'show' : ''}" aria-label="Zeit prüfen">${WARN}</span>
      <span class="row-hours">${m == null ? '' : fmtH(m)}</span>
      ${rowCount > 1 ? `<button class="row-del" data-act="delrow" aria-label="Zeile löschen">${ICON.close}</button>` : '<span class="row-del-space"></span>'}
    </div>
    <div class="suggest-wrap ${fieldMissing(day, r, 'site') ? 'missing' : ''}"><span class="field-icon">${ICON.pin}</span><span class="warn" aria-label="fehlt">${WARN}</span><textarea class="txt" data-f="site" rows="1" placeholder="Ort" maxlength="${MAX_LEN.site}" autocomplete="off" autocapitalize="sentences" enterkeyhint="next">${escapeHtml(r.site)}</textarea></div>
    ${typoHintHTML('site', r)}
    <div class="suggest-wrap ${fieldMissing(day, r, 'work') ? 'missing' : ''}"><span class="field-icon">${ICON.tool}</span><span class="warn" aria-label="fehlt">${WARN}</span><textarea class="txt" data-f="work" rows="1" placeholder="Arbeit" maxlength="${MAX_LEN.work}" autocomplete="off" autocapitalize="sentences" enterkeyhint="done">${escapeHtml(r.work)}</textarea></div>
    ${typoHintHTML('work', r)}
  </div>`;
}

function summaryHTML(s) {
  const target = sheetTarget(s);
  return `<div class="sum-pill"><span class="sum-label">Stunden Gesamt</span><b>${fmtH(sheetTotal(s))}</b></div>
    <div class="sum-pill"><span class="sum-label">davon Überstunden</span><span class="sum-value"><b>${fmtH(sheetOvertime(s, target))}</b><span class="sum-sub">ab ${fmtH(Math.round(target * 60))}</span></span></div>`;
}

const currentSheet = () => findSheet(editorId);

function refreshDay(i) {
  const s = currentSheet();
  const el = document.querySelector(`.day[data-day="${i}"]`);
  if (el) el.outerHTML = dayHTML(s, i);
  fitRowTexts();
  refreshSummary();
}
function refreshSummary() {
  updatePdfThumb();
  const s = currentSheet();
  const el = document.getElementById('summary');
  if (el) el.innerHTML = summaryHTML(s);
  const bar = document.getElementById('daybar');
  if (bar) bar.innerHTML = dayBarHTML(s);
}

/** Warnzeichen eines Tages neu setzen, ohne die Eingabefelder neu zu zeichnen (Fokus bleibt) */
function updateDayWarnings(dayEl, day) {
  if (!dayEl) return;
  for (const rowEl of dayEl.querySelectorAll('.row')) {
    const r = day.rows.find((x) => x.id === rowEl.dataset.row);
    if (!r) continue;
    rowEl.querySelector('.time-warn').classList.toggle('show', timeWarning(day, r));
    for (const f of ['site', 'work']) {
      rowEl.querySelector(`[data-f="${f}"]`).closest('.suggest-wrap').classList.toggle('missing', fieldMissing(day, r, f));
    }
  }
  const pill = dayEl.querySelector('[data-act="pause"]');
  if (pill && day.pause == null) pill.innerHTML = `Pause${pauseMissing(day) ? ` ${WARN}` : ''}`;
  const bar = document.getElementById('daybar');
  if (bar) bar.innerHTML = dayBarHTML(currentSheet());
}

/** Zum Tag scrollen, ohne dass er unter der festen Kopfzeile verschwindet */
function jumpToDay(i) {
  const el = document.querySelector(`.day[data-day="${i}"]`);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navHeight() - 8, behavior: 'smooth' });
}
function refreshAll() {
  const y = window.scrollY;
  renderEditor(editorId);
  window.scrollTo(0, y);
}

function rowContext(el) {
  const s = currentSheet();
  const dayEl = el.closest('.day');
  const rowEl = el.closest('.row');
  const dayIndex = dayEl ? Number(dayEl.dataset.day) : null;
  const day = dayIndex != null ? s.days[dayIndex] : null;
  const rowIndex = rowEl && day ? day.rows.findIndex((r) => r.id === rowEl.dataset.row) : -1;
  return { s, dayIndex, day, rowIndex, row: rowIndex >= 0 ? day.rows[rowIndex] : null };
}

function editTime(btn) {
  const { s, dayIndex, day, rowIndex, row } = rowContext(btn);
  const which = btn.dataset.which;
  let initial = row[which];
  if (initial == null) {
    if (which === 'start') {
      const prev = day.rows.slice(0, rowIndex).reverse().find((r) => r.end != null);
      initial = prev ? prev.end : 8 * 60;
    } else {
      initial = row.start != null ? Math.min(row.start + 60, 23 * 60 + 45) : 17 * 60;
    }
  }
  timePicker(which === 'start' ? 'Arbeitsbeginn' : 'Arbeitsende', initial, row[which] != null, (value) => {
    row[which] = value;
    // Ende übernimmt die nächste Zeile automatisch als Beginn
    if (which === 'end' && value != null) {
      const next = day.rows[rowIndex + 1];
      if (next && next.start == null) next.start = value;
    }
    saveSheets(s);
    refreshDay(dayIndex);
  });
  return s;
}

function editPause(btn) {
  const { s, dayIndex, day } = rowContext(btn);
  const step = settings.minuteStep;
  const values = Array.from({ length: 240 / step + 1 }, (_, i) => i * step);
  wheelPicker('Pause', [{ values, label: (v) => `${fmtH(v)}` }], [day.pause], ([v]) => {
    day.pause = v;
    saveSheets(s);
    refreshDay(dayIndex);
  });
}

function changeWeek() {
  const s = currentSheet();
  weekPicker(sheetFirstDate(s), s.id, (anchor) => {
    if (existingSheet(anchor, s.id)) {
      toast('Für diese Woche gibt es schon einen Stundenzettel');
      return;
    }
    const n = newSheet(anchor, '');
    s.weekStart = n.weekStart;
    s.year = n.year;
    s.month = n.month;
    markHolidays(s);
    saveSheets(s);
    refreshAll();
  });
}

function moreMenu() {
  const s = currentSheet();
  actionSheet([
    { label: 'Als PDF senden', run: () => sendWithCheck(s) },
    { label: 'Reisekostenabrechnung', run: () => openTripMenu(s) },
    s.sentAt
      ? { label: 'Als offen markieren', run: () => { s.sentAt = null; saveSheets(s); toast('Als offen markiert'); } }
      : { label: 'Als gesendet markieren', run: () => { s.sentAt = Date.now(); saveSheets(s); toast('Als gesendet markiert'); } },
    { label: 'Stundenzettel löschen', destructive: true, run: () => askDelete(s.id, true) },
  ]);
}

function sendWithCheck(s) {
  const problems = sheetProblems(s);
  if (!problems.length) return sharePdf(s, true);
  // „Trotzdem senden“ ist ein eigenes Antippen – nötig für Zwischenablage und Teilen-Menü
  confirmDialog(
    'Bitte prüfen',
    `<ul class="problem-list">${problems.slice(0, 12).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}${problems.length > 12 ? `<li>… und ${problems.length - 12} weitere</li>` : ''}</ul>`,
    'Trotzdem senden',
    () => sharePdf(s, true),
    false,
    'Zurück'
  );
}

function askDelete(id, leave, onCancel = null) {
  const s = findSheet(id);
  if (!s) return;
  confirmDialog('Stundenzettel löschen?', `${sheetTitle(s)} wird endgültig gelöscht.`, 'Löschen', () => {
    sheets = sheets.filter((x) => x.id !== id);
    saveSheets();
    if (leave) goBack();
    else renderList();
  }, true, 'Abbrechen', onCancel);
}

// ───────────────────────── PDF & Senden ─────────────────────────

function pdfFileFor(s) {
  const blob = buildTimesheetPdf(s, sheetTarget(s));
  return new File([blob], `${sheetTitle(s)}.pdf`, { type: 'application/pdf' });
}

// ───────────────────────── Kein Zoomen ─────────────────────────
// iOS ignoriert „user-scalable=no“ teilweise: Zwei-Finger-Zoom der Seite überall abfangen. Die PDF-Vorschau zoomt
// über eigene Touch-Steuerung und ist davon nicht betroffen.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

// ───────────────────────── PDF-Vorschau ─────────────────────────
// Am Ende des Zettels bzw. der Reisekostenabrechnung eine kleine Vorschau des PDFs (iOS zeigt PDFs direkt als Bild an);
// Antippen öffnet sie groß. Senden geht bewusst nicht aus der Vorschau heraus.

let pdfUrl = null;
let pdfThumbTimer = 0;
/** Vorschau neu erzeugen – nach Änderungen kurz gewartet, damit nicht bei jedem Tastendruck ein PDF entsteht */
function updatePdfThumb(now = false) {
  clearTimeout(pdfThumbTimer);
  const run = () => {
    const img = document.getElementById('pdf-thumb');
    if (!img) return;
    let file = null;
    if (currentView === 'trip') {
      const t = currentTrip();
      if (t && t.dates.length) file = tripPdfFile(t);
    } else if (currentSheet()) file = pdfFileFor(currentSheet());
    // Abrechnung ohne Reisetage: noch keine Vorschau
    img.closest('.pv-thumb').hidden = !file;
    if (!file) return;
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(file);
    img.src = pdfUrl;
  };
  if (now) run();
  else pdfThumbTimer = setTimeout(run, 400);
}

const pdfThumbHTML = (what, wide = false) => `<button class="pv-thumb ${wide ? 'wide' : ''}" data-act="pdf-preview" aria-label="PDF-Vorschau vergrößern">
      <img id="pdf-thumb" alt="">
      <span><b>PDF-Vorschau</b><span class="muted">So sieht ${what === 'Zettel' ? 'der Zettel' : 'die Abrechnung'} als PDF aus. Antippen zum Vergrößern.</span></span>
    </button>`;

/**
 * Große Vorschau: Seite auf Breite. Zoomen (zwei Finger, Doppeltipp) und Ziehen (ein Finger, mit Schwung) laufen
 * komplett über eigene Touch-Steuerung per transform – kein Scrollen des Browsers dazwischen, daher kein Zittern.
 */
function openPdfPreview() {
  updatePdfThumb(true);
  const wide = currentView === 'trip'; // Reisekosten: A4 quer
  const modal = openModal(
    `<div class="pv-head"><span></span><b>Vorschau</b><button class="modal-btn strong" data-m="ok">Fertig</button></div>
    <div class="pv-scroll"><img class="pv-page" src="${pdfUrl}" alt="PDF-Vorschau" draggable="false"></div>`,
    'pv-modal'
  );
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-m="ok"]')) closeModal();
  });
  const box = modal.querySelector('.pv-scroll');
  const page = modal.querySelector('.pv-page');
  const PAD = 12;
  const MAX = 4;
  let vw = 0;
  let vh = 0;
  let w0 = 0; // Seitenbreite bei Zoom 1
  let h0 = 0;
  let s = 1;
  let tx = PAD;
  let ty = PAD;
  // Gezeichnete Größe: Während der Geste wird nur per transform skaliert (flüssig, aber unscharf);
  // danach zeichnet iOS die Seite in der neuen Größe neu (scharf), siehe sharpen()
  let drawn = 1;

  // Grenzen: kleiner als der Ausschnitt → waagerecht mittig, oben bündig; größer → kein Rand ins Leere ziehen
  const bounds = (scale) => {
    const w = w0 * scale;
    const h = h0 * scale;
    const x = w + 2 * PAD <= vw ? [(vw - w) / 2, (vw - w) / 2] : [vw - w - PAD, PAD];
    const y = h + 2 * PAD <= vh ? [PAD, PAD] : [vh - h - PAD, PAD];
    return { x, y };
  };
  const clampTo = (v, [a, b]) => Math.min(b, Math.max(a, v));
  const apply = () => (page.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s / drawn})`);
  let sharpTimer = 0;
  const sharpen = () => {
    clearTimeout(sharpTimer);
    sharpTimer = setTimeout(() => {
      if (g || Math.abs(drawn - s) < 0.01) return;
      drawn = s;
      page.style.width = `${w0 * s}px`;
      apply();
    }, 120);
  };
  const layout = () => {
    vw = box.clientWidth;
    vh = box.clientHeight;
    w0 = vw - 2 * PAD;
    const ratio = page.naturalWidth ? page.naturalHeight / page.naturalWidth : wide ? 595 / 842 : 842 / 595;
    h0 = w0 * ratio;
    page.style.width = `${w0 * drawn}px`;
    const b = bounds(s);
    tx = clampTo(tx, b.x);
    ty = clampTo(ty, b.y);
    apply();
  };
  page.addEventListener('load', layout);
  requestAnimationFrame(layout);
  const onResize = () => (box.isConnected ? layout() : window.removeEventListener('resize', onResize));
  window.addEventListener('resize', onResize);

  /** Weich zu einem Zustand gleiten (nach dem Loslassen, Doppeltipp) */
  let anim = 0;
  const animateTo = (ns, nx, ny) => {
    cancelAnimationFrame(anim);
    const [s1, x1, y1] = [s, tx, ty];
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 220);
      const e = 1 - (1 - k) ** 3;
      s = s1 + (ns - s1) * e;
      tx = x1 + (nx - x1) * e;
      ty = y1 + (ny - y1) * e;
      apply();
      if (k < 1) anim = requestAnimationFrame(step);
      else sharpen();
    };
    anim = requestAnimationFrame(step);
  };
  const settle = () => {
    const ns = Math.min(MAX, Math.max(1, s));
    // Beim Zurückfedern des Zooms bleibt die Mitte des Ausschnitts an ihrer Stelle
    const cx = vw / 2;
    const cy = vh / 2;
    let nx = cx - ((cx - tx) / s) * ns;
    let ny = cy - ((cy - ty) / s) * ns;
    const b = bounds(ns);
    nx = clampTo(nx, b.x);
    ny = clampTo(ny, b.y);
    if (ns !== s || nx !== tx || ny !== ty) animateTo(ns, nx, ny);
    else sharpen();
  };

  // Touch: ein Finger zieht, zwei Finger zoomen (Punkt zwischen den Fingern bleibt unter den Fingern)
  let g = null;
  let vel = { x: 0, y: 0, t: 0 };
  let lastTap = { t: 0, x: 0, y: 0 };
  const pt = (e, i) => {
    const r = box.getBoundingClientRect();
    return { x: e.touches[i].clientX - r.left, y: e.touches[i].clientY - r.top };
  };
  const start = (e) => {
    cancelAnimationFrame(anim);
    if (e.touches.length >= 2) {
      const a = pt(e, 0);
      const b = pt(e, 1);
      g = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s, tx, ty, moved: true };
    } else {
      const a = pt(e, 0);
      g = { pinch: false, x: a.x, y: a.y, tx, ty, sx: a.x, sy: a.y, moved: false };
      vel = { x: 0, y: 0, t: performance.now() };
    }
  };
  box.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      start(e);
    },
    { passive: false }
  );
  box.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      if (!g) return;
      if (g.pinch && e.touches.length >= 2) {
        const a = pt(e, 0);
        const b = pt(e, 1);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // Über die Grenzen hinaus nur gedämpft
        let ns = (g.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.d;
        if (ns > MAX) ns = MAX + (ns - MAX) * 0.3;
        if (ns < 1) ns = 1 - (1 - ns) * 0.3;
        tx = m.x - ((g.m.x - g.tx) / g.s) * ns;
        ty = m.y - ((g.m.y - g.ty) / g.s) * ns;
        s = ns;
        apply();
      } else if (!g.pinch) {
        const a = pt(e, 0);
        if (Math.hypot(a.x - g.sx, a.y - g.sy) > 6) g.moved = true;
        const now = performance.now();
        const dt = Math.max(1, now - vel.t);
        vel = { x: (a.x - g.x) / dt, y: (a.y - g.y) / dt, t: now };
        const b = bounds(s);
        // Am Rand gedämpft weiterziehen
        const soft = (v, [lo, hi]) => (v < lo ? lo - (lo - v) * 0.35 : v > hi ? hi + (v - hi) * 0.35 : v);
        tx = soft(tx + a.x - g.x, b.x);
        ty = soft(ty + a.y - g.y, b.y);
        g.x = a.x;
        g.y = a.y;
        apply();
      }
    },
    { passive: false }
  );
  const end = (e) => {
    e.preventDefault();
    if (!g) return;
    // Von zwei auf einen Finger: nahtlos mit Ziehen weitermachen
    if (e.touches.length === 1) {
      const wasPinch = g.pinch;
      start(e);
      g.moved = wasPinch || g.moved;
      return;
    }
    if (e.touches.length) return;
    const tap = !g.pinch && !g.moved;
    const wasPan = !g.pinch && g.moved;
    g = null;
    if (tap) {
      const now = performance.now();
      const p = { x: e.changedTouches[0].clientX - box.getBoundingClientRect().left, y: e.changedTouches[0].clientY - box.getBoundingClientRect().top };
      if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        // Doppeltipp: an der Stelle auf 2,5-fach, bzw. zurück auf ganze Seite
        lastTap.t = 0;
        const ns = s > 1.05 ? 1 : 2.5;
        const b = bounds(ns);
        animateTo(ns, clampTo(p.x - ((p.x - tx) / s) * ns, b.x), clampTo(p.y - ((p.y - ty) / s) * ns, b.y));
        return;
      }
      lastTap = { t: now, ...p };
      return;
    }
    // Schwung nach dem Ziehen
    if (wasPan && performance.now() - vel.t < 80 && Math.hypot(vel.x, vel.y) > 0.2) {
      let vx = vel.x * 16;
      let vy = vel.y * 16;
      const glide = () => {
        const b = bounds(s);
        tx += vx;
        ty += vy;
        vx *= 0.94;
        vy *= 0.94;
        const out = tx < b.x[0] || tx > b.x[1] || ty < b.y[0] || ty > b.y[1];
        apply();
        if (!out && Math.hypot(vx, vy) > 0.3) anim = requestAnimationFrame(glide);
        else settle();
      };
      anim = requestAnimationFrame(glide);
      return;
    }
    settle();
  };
  box.addEventListener('touchend', end, { passive: false });
  box.addEventListener('touchcancel', end, { passive: false });
  // Gesten des Browsers (Seitenzoom) innerhalb der Vorschau abfangen
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) box.addEventListener(type, (e) => e.preventDefault());
  // Ohne Touch (Mac): Doppelklick zoomt
  box.addEventListener('dblclick', (e) => {
    const r = box.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const ns = s > 1.05 ? 1 : 2.5;
    const b = bounds(ns);
    animateTo(ns, clampTo(p.x - ((p.x - tx) / s) * ns, b.x), clampTo(p.y - ((p.y - ty) / s) * ns, b.y));
  });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function sharePdf(s, isSend) {
  let file;
  try {
    file = pdfFileFor(s);
  } catch (e) {
    toast('PDF konnte nicht erstellt werden');
    return;
  }
  // Eine Web-App kann den Mail-Betreff nicht direkt setzen; der Titel kommt in die Zwischenablage.
  if (isSend && navigator.clipboard) {
    navigator.clipboard.writeText(sheetTitle(s)).then(
      () => toast('Betreff kopiert – in Mail bei „Betreff“ einsetzen', 4000),
      () => {}
    );
  }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      // Ohne title/text, damit in der Mail nur der Anhang steht
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      downloadFile(file);
    }
  } else {
    downloadFile(file);
  }
  if (isSend && !s.sentAt) {
    confirmDialog('Wurde der Stundenzettel gesendet?', 'Dann wird er in der Liste mit einem Haken markiert.', 'Ja, gesendet', () => {
      s.sentAt = Date.now();
      saveSheets(s);
    });
  }
}

// ───────────────────────── Reisekosten ─────────────────────────
// Abrechnung: { id, sheetId, dates: ['YYYY-MM-DD'], over: { Datum: { start, end, places, works, meal } }, from, to (angezeigte Tage),
//   place, signDate, name, sentAt, createdAt, updatedAt }. Ohne Eintrag in „over“ kommt der Wert aus dem Stundenzettel.

const TRIP_KEY = 'yetizettel.trips.v1';
let trips = readJson(TRIP_KEY, []);
let tripId = null;

function saveTrips(changed) {
  if (changed) changed.updatedAt = Date.now();
  if (currentView === 'trip') updatePdfThumb();
  try {
    localStorage.setItem(TRIP_KEY, JSON.stringify(trips));
  } catch {
    toast('Speichern fehlgeschlagen!');
  }
}
const findTrip = (id) => trips.find((t) => t.id === id);
const currentTrip = () => findTrip(tripId);
const fmtClock = (m) => (m === 1440 ? '24:00' : fmtTime(m));
const fmtEuro = (v) => `${v.toFixed(2).replace('.', ',')} €`;
const fmtStd = (m) => `${String(Math.round((m / 60) * 100) / 100).replace('.', ',')} Std.`;

/** Tag aus dem passenden Stundenzettel (oder null) */
function sheetDayFor(date) {
  const s = existingSheet(date);
  const i = (date.getDay() + 6) % 7;
  return s && sheetIsActive(s, i) ? s.days[i] : null;
}

/** Baustellen zusammenfassen: „Muster GmbH, Nordstadt“ + „Muster GmbH, Südstadt“ → „Muster GmbH, Nordstadt, Südstadt“ */
function joinSites(sites) {
  const groups = [];
  for (const site of sites) {
    const m = site.match(/^([^,]+),\s*(.+)$/);
    const last = groups.at(-1);
    if (m && last && sameKey(last.prefix) === sameKey(m[1])) last.rest.push(m[2].trim());
    else groups.push(m ? { prefix: m[1].trim(), rest: [m[2].trim()] } : { prefix: site, rest: [] });
  }
  return groups.map((g) => [g.prefix, ...g.rest].join(', ')).join(', ');
}
const uniqueTexts = (list) => {
  const seen = new Set();
  return list.filter((v) => v && !seen.has(sameKey(v)) && seen.add(sameKey(v)));
};

/** Reiseanlass aus dem Stundenzettel: Reiseorte (Baustellen) und Tätigkeiten (Art der Arbeit) */
function tripTextFor(day) {
  if (!day || !canWork(day)) return { places: '', works: '' };
  const sites = uniqueTexts(day.rows.map((r) => (r.site || '').trim()));
  const works = uniqueTexts(day.rows.flatMap((r) => (r.work || '').split(',').map((w) => w.trim())));
  return { places: joinSites(sites), works: works.join(', ') };
}

/** Automatische Werte: erster Tag ab Arbeitsbeginn bis 24:00, mittlere Tage ganz, letzter Tag bis Arbeitsende */
function tripAuto(trip, iso) {
  const date = parseDate(iso);
  const prev = trip.dates.includes(isoDate(addDays(date, -1)));
  const next = trip.dates.includes(isoDate(addDays(date, 1)));
  const day = sheetDayFor(date);
  const rows = day && canWork(day) ? day.rows : [];
  const starts = rows.map((r) => r.start).filter((v) => v != null);
  const ends = rows.map((r) => r.end).filter((v) => v != null);
  return {
    start: prev ? 0 : starts.length ? Math.min(...starts) : null,
    end: next ? 1440 : ends.length ? Math.max(...ends) : null,
    ...tripTextFor(day),
    // Nur mehrtägige Reisen: An- und Abreisetag 14 €, volle Tage 28 €
    meal: prev && next ? 28 : prev || next ? 14 : 0,
  };
}

/** Alle Reisetage mit den gültigen Werten (eigene Änderungen vor Werten aus dem Stundenzettel) */
function tripRows(trip) {
  return [...trip.dates].sort().map((iso) => {
    const auto = tripAuto(trip, iso);
    const over = { ...(trip.over[iso] || {}) };
    // Frühere Fassung: ein gemeinsames Textfeld „text“ (Reiseorte, Zeilenumbruch, Tätigkeiten)
    if ('text' in over && !('places' in over) && !('works' in over)) {
      const [first, ...rest] = String(over.text || '').split('\n');
      over.places = first;
      over.works = rest.join(' ');
    }
    const pick = (k) => (k in over ? over[k] : auto[k]);
    const start = pick('start');
    const end = pick('end');
    const places = pick('places') || '';
    const works = pick('works') || '';
    // Im PDF: Reiseorte, darunter die Tätigkeiten
    const text = [places.trim(), works.trim()].filter(Boolean).join('\n');
    const meal = pick('meal') || 0;
    const minutes = start != null && end != null ? (end >= start ? end - start : end + 1440 - start) : null;
    return { iso, date: parseDate(iso), start, end, minutes, places, works, text, meal, auto, over };
  });
}
const tripTotal = (rows) => rows.reduce((t, r) => t + r.meal, 0);
const tripTitle = (trip) => {
  const d = [...trip.dates].sort();
  return d.length ? `Reisekostenabrechnung ${fmtShort(parseDate(d[0]))} - ${fmtShort(parseDate(d.at(-1)))}` : 'Reisekostenabrechnung';
};

/** Abrechnungen, die Tage dieses Stundenzettels enthalten oder von ihm aus angelegt wurden */
function tripsForSheet(s) {
  const dates = new Set(sheetActiveDays(s).map((i) => isoDate(sheetDate(s, i))));
  return trips.filter((t) => t.sheetId === s.id || t.dates.some((d) => dates.has(d)));
}

/** Neue, noch leere Abrechnung anlegen und öffnen; angezeigt werden zunächst die Tage from–to */
function createTrip(from, to, sheet) {
  const t = {
    id: uid(),
    sheetId: sheet ? sheet.id : null,
    dates: [],
    over: {},
    from: isoDate(from),
    to: isoDate(to),
    place: settings.place,
    signDate: isoDate(new Date()),
    name: (sheet && sheet.name) || settings.name,
    sentAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  trips.push(t);
  saveTrips();
  location.hash = `#/reise/${t.id}`;
}

function openTripMenu(s) {
  const list = tripsForSheet(s).filter((t) => t.dates.length);
  const create = () => createTrip(sheetFirstDate(s), sheetLastDate(s), s);
  if (!list.length) return create();
  actionSheet([
    ...list.map((t) => ({ label: escapeHtml(tripTitle(t)), run: () => (location.hash = `#/reise/${t.id}`) })),
    { label: 'Neue Reisekostenabrechnung', run: create },
  ]);
}

/** Leere Abrechnungen (kein Tag angetippt) beim Verlassen wieder entfernen */
function dropEmptyTrip() {
  const t = currentTrip();
  if (t && !t.dates.length) {
    trips = trips.filter((x) => x !== t);
    saveTrips();
  }
}

/** Karte auf der Startseite: führt zur Liste der Reisekostenabrechnungen */
function tripsCardHTML() {
  const list = trips.filter((t) => t.dates.length);
  const open = list.filter((t) => !t.sentAt).length;
  return `<a draggable="false" class="card stats-card trips-card" href="#/reisekosten">
    <span class="trips-icon">${ICON.suitcase}</span>
    <span class="stats-item"><span class="trips-title">Reisekosten</span><span class="stats-label">${
      list.length ? `${list.length} ${list.length === 1 ? 'Abrechnung' : 'Abrechnungen'}${open ? ` · ${open} offen` : ''}` : 'Noch keine Abrechnung'
    }</span></span>
    <span class="list-chevron">${ICON.chevronRight}</span>
  </a>`;
}

const tripFirstDate = (t) => parseDate([...t.dates].sort()[0]);
const tripLastDate = (t) => parseDate([...t.dates].sort().at(-1));

function renderTripList() {
  const list = trips.filter((t) => t.dates.length);
  const groups = new Map();
  for (const t of list) {
    const d = tripFirstDate(t);
    const key = d.getFullYear() * 100 + d.getMonth() + 1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const keys = [...groups.keys()].sort((a, b) => b - a);
  app.innerHTML = `
    <header class="nav">
      <button class="nav-btn back" data-act="back" aria-label="Zurück">${ICON.back}</button>
      <span class="nav-title"></span>
      <span class="nav-btn"></span>
    </header>
    <h1 class="large-title">Reisekosten</h1>
    ${
      keys.length
        ? keys
            .map((k) => {
              const items = groups.get(k).sort((a, b) => tripFirstDate(b) - tripFirstDate(a));
              return `<h2 class="section-title">${MONTHS[(k % 100) - 1]} ${Math.floor(k / 100)}</h2>
          <div class="card list">${items.map(tripRowHTML).join('')}</div>`;
            })
            .join('')
        : `<div class="empty">
      <div class="empty-icon">${svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>', 44)}</div>
      <p><b>Noch keine Reisekostenabrechnung</b></p>
      <p class="muted">Tippe unten auf „Neue Reisekostenabrechnung“ und wähle eine Woche.</p>
    </div>`
    }
    <div class="bottom-bar">
      <button class="to-top" data-act="to-top" aria-label="Nach oben">${ICON.up}</button>
      <button class="primary" data-act="trip-new">${ICON.plus} Neue Reisekostenabrechnung</button>
    </div>`;
}

function tripRowHTML(t) {
  const sent = !!t.sentAt;
  const rows = tripRows(t);
  const sites = joinSites(
    uniqueTexts(
      rows.flatMap((r) => {
        const day = sheetDayFor(r.date);
        return day && canWork(day) ? day.rows.map((x) => (x.site || '').trim()) : [];
      })
    )
  );
  return `<div class="swipe">
    <div class="swipe-track">
      <a draggable="false" class="list-row" href="#/reise/${encodeURIComponent(t.id)}">
        <span class="status ${sent ? 'sent' : 'open'}">${sent ? ICON.check : ''}</span>
        <span class="list-main">
          <span class="list-title">${fmtShort(tripFirstDate(t))} – ${fmtShort(tripLastDate(t))}</span>
          <span class="list-sub trip-sites">${sent ? 'gesendet' : 'offen'}${sites ? ` · ${escapeHtml(sites)}` : ''}</span>
        </span>
        <span class="list-hours">${fmtEuro(tripTotal(rows))}</span>
        <span class="list-chevron">${ICON.chevronRight}</span>
      </a>
      <button class="swipe-del" data-act="trip-delete" data-id="${t.id}">Löschen</button>
    </div>
  </div>`;
}

function newTripFromList() {
  weekPicker(new Date(), null, (anchor) => {
    const monday = mondayOf(anchor);
    createTrip(monday, addDays(monday, 6), existingSheet(anchor));
  }, true);
}

function askDeleteTrip(t, leave, onCancel = null) {
  confirmDialog('Abrechnung löschen?', `${escapeHtml(tripTitle(t))} wird endgültig gelöscht.`, 'Löschen', () => {
    trips = trips.filter((x) => x !== t);
    saveTrips();
    if (leave) goBack();
    else renderTripList();
  }, true, 'Abbrechen', onCancel);
}

function renderTrip(id) {
  const t = findTrip(id);
  if (!t) {
    location.replace('#/');
    return;
  }
  tripId = id;
  app.innerHTML = `
    <header class="nav">
      <button class="nav-btn back" data-act="back" aria-label="Zurück">${ICON.back}</button>
      <span class="nav-title">Reisekosten</span>
      <span class="nav-actions">
        <button class="nav-btn" data-act="trip-share" aria-label="Als PDF senden">${ICON.share}</button>
        <button class="nav-btn" data-act="trip-more" aria-label="Weitere Aktionen">${ICON.more}</button>
      </span>
    </header>
    <div id="trip-body">${tripBodyHTML(t)}</div>
    ${pdfThumbHTML('Abrechnung', true)}`;
  fitTripTexts();
  updatePdfThumb(true);
}

/** Textfelder so hoch wie ihr Text (auch nach dem Öffnen und beim Drehen des Geräts) */
function fitTripTexts() {
  const fit = () => document.querySelectorAll('.trip-text').forEach(fitTextarea);
  fit();
  requestAnimationFrame(fit);
}
window.addEventListener('resize', () => currentView === 'trip' && fitTripTexts());

function tripBodyHTML(t) {
  const rows = tripRows(t);
  const selected = new Set(t.dates);
  // Angezeigte Tage: Bereich der Abrechnung, mindestens alle angetippten Tage
  const sorted = [...t.dates].sort();
  let from = parseDate(sorted[0] && sorted[0] < t.from ? sorted[0] : t.from);
  const to = parseDate(sorted.at(-1) && sorted.at(-1) > t.to ? sorted.at(-1) : t.to);
  const picks = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const iso = isoDate(d);
    const day = sheetDayFor(d);
    const info = !day ? '' : day.status ? DAY_STATUS_SHORT[day.status] : joinSites(uniqueTexts(day.rows.map((r) => (r.site || '').trim())));
    picks.push(`<button class="trip-pick ${selected.has(iso) ? 'on' : ''}" data-act="trip-toggle" data-date="${iso}">
        <span class="trip-check">${selected.has(iso) ? ICON.check : ''}</span>
        <span class="trip-pick-day">${WEEKDAYS_SHORT[(d.getDay() + 6) % 7]} ${fmtDayMonth(d)}</span>
        <span class="trip-pick-info muted">${escapeHtml(info) || '–'}</span>
      </button>`);
  }
  const sig = settings.signature && settings.signature.strokes && settings.signature.strokes.length;
  return `
    <h2 class="section-title">Reisetage</h2>
    <div class="card list">${picks.join('')}</div>
    <div class="trip-range">
      <button class="link-btn" data-act="trip-range" data-dir="-1">${ICON.chevronLeft} Woche davor</button>
      <button class="link-btn" data-act="trip-range" data-dir="1">Woche danach ${ICON.chevronRight}</button>
    </div>
    <p class="footnote">Tippe die Tage an, an denen du unterwegs warst.</p>
    ${rows.map(tripDayHTML).join('')}
    ${
      rows.length
        ? `<h2 class="section-title">Abschluss</h2>
    <div class="card form">
      <label class="field"><span>Ort</span><input data-tp="place" placeholder="z. B. Firmensitz" value="${escapeHtml(t.place || '')}" enterkeyhint="done"></label>
      <label class="field"><span>Datum</span><input type="date" data-tp="signDate" value="${t.signDate || ''}"></label>
      <div class="field"><span>Unterschrift</span><span class="muted">${sig ? 'aus den Einstellungen' : 'keine (in den Einstellungen)'}</span></div>
    </div>
    <div class="card summary"><div class="sum-row"><span>Gesamtsumme</span><b id="trip-total">${fmtEuro(tripTotal(rows))}</b></div></div>`
        : ''
    }`;
}

function tripDayHTML(r) {
  const wd = WEEKDAYS[(r.date.getDay() + 6) % 7];
  const timeBtn = (which, label) =>
    `<button class="time ${r[which] == null ? 'empty' : ''}" data-act="trip-time" data-which="${which}">${r[which] == null ? label : fmtClock(r[which])}</button>`;
  return `<section class="day trip-day wd-${(r.date.getDay() + 6) % 7}" data-date="${r.iso}">
    <div class="day-head"><div><b>${wd}</b> <span class="muted">${fmtDayMonth(r.date)}</span></div><span class="muted trip-std">${r.minutes == null ? '' : fmtStd(r.minutes)}</span></div>
    <div class="row">
      <div class="row-times">
        ${timeBtn('start', 'Beginn')}
        <span class="arrow">–</span>
        ${timeBtn('end', 'Ende')}
        ${r.start == null || r.end == null || tripDayIssues(r).length ? `<span class="time-warn show">${WARN}</span>` : ''}
      </div>
      ${tripDayIssues(r)
        .map((x) => `<p class="trip-issue">${WARN} ${escapeHtml(x)}</p>`)
        .join('')}
      <div class="trip-field"><span class="field-icon">${ICON.pin}</span><textarea class="trip-text" data-t="places" rows="1" maxlength="${TRIP_MAX_LEN}" placeholder="Reiseorte (Baustellen)" autocapitalize="sentences">${escapeHtml(r.places)}</textarea></div>
      <div class="trip-field"><span class="field-icon">${ICON.tool}</span><textarea class="trip-text" data-t="works" rows="1" maxlength="${TRIP_MAX_LEN}" placeholder="Tätigkeiten" autocapitalize="sentences">${escapeHtml(r.works)}</textarea></div>
    </div>
    <div class="day-foot">
      <span>Verpflegung</span>
      <label class="trip-meal"><input data-t="meal" type="text" inputmode="decimal" value="${r.meal ? r.meal.toFixed(2).replace('.', ',') : ''}" placeholder="0,00" enterkeyhint="done"> €</label>
    </div>
  </section>`;
}

/** Ansicht neu aufbauen, Scroll-Position bleibt */
function refreshTrip() {
  const t = currentTrip();
  const body = document.getElementById('trip-body');
  if (!t || !body) return;
  const y = window.scrollY;
  body.innerHTML = tripBodyHTML(t);
  fitTripTexts();
  window.scrollTo(0, y);
}
/** Baustelle / Art der Arbeit: Feld so hoch wie sein Text (mehrzeilig statt rechts abgeschnitten) */
const fitRowTexts = () => document.querySelectorAll('textarea.txt').forEach(fitTextarea);
window.addEventListener('resize', () => currentView === 'editor' && fitRowTexts());
const fitTextarea = (el) => {
  el.style.height = 'auto';
  // + Rahmen (Linie unten), weil die Höhe den Rahmen mit einschließt
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
};

function setTripOver(t, iso, key, value) {
  t.over[iso] = { ...(t.over[iso] || {}), [key]: value };
  saveTrips(t);
}

function editTripTime(btn) {
  const t = currentTrip();
  const iso = btn.closest('[data-date]').dataset.date;
  const which = btn.dataset.which;
  const r = tripRows(t).find((x) => x.iso === iso);
  const initial = r[which] ?? (which === 'start' ? 6 * 60 : 18 * 60);
  const step = settings.minuteStep;
  const hours = Array.from({ length: 25 }, (_, i) => i);
  const minutes = Array.from({ length: 60 / step }, (_, i) => i * step);
  wheelPicker(
    which === 'start' ? 'Reisebeginn' : 'Reiseende',
    [
      { values: hours, label: pad },
      { values: minutes, label: pad, sep: ':' },
    ],
    [Math.floor(initial / 60), initial % 60],
    ([h, m]) => {
      setTripOver(t, iso, which, Math.min(h * 60 + m, 1440));
      refreshTrip();
    },
    which in r.over ? `<button class="modal-wide" data-m="extra">Wie im Stundenzettel</button>` : '',
    () => {
      delete t.over[iso][which];
      saveTrips(t);
      refreshTrip();
    }
  );
}

function toggleTripDay(iso) {
  const t = currentTrip();
  if (t.dates.includes(iso)) t.dates = t.dates.filter((d) => d !== iso);
  else t.dates.push(iso);
  saveTrips(t);
  refreshTrip();
}

function shiftTripRange(dir) {
  const t = currentTrip();
  if (dir < 0) t.from = isoDate(addDays(parseDate(t.from), -7));
  else t.to = isoDate(addDays(parseDate(t.to), 7));
  saveTrips(t);
  refreshTrip();
}

function tripMoreMenu() {
  const t = currentTrip();
  actionSheet([
    { label: 'Als PDF senden', run: () => sendTripWithCheck(t) },
    {
      label: 'Neu aus Stundenzettel übernehmen',
      run: () =>
        confirmDialog('Neu übernehmen?', 'Deine Änderungen an Uhrzeiten, Reiseanlass und Verpflegung werden verworfen.', 'Übernehmen', () => {
          t.over = {};
          saveTrips(t);
          refreshTrip();
        }),
    },
    t.sentAt
      ? { label: 'Als offen markieren', run: () => { t.sentAt = null; saveTrips(t); toast('Als offen markiert'); } }
      : { label: 'Als gesendet markieren', run: () => { t.sentAt = Date.now(); saveTrips(t); toast('Als gesendet markiert'); } },
    {
      label: 'Abrechnung löschen',
      destructive: true,
      run: () => askDeleteTrip(t, true),
    },
  ]);
}

/**
 * Widersprüche eines Reisetags zum Stundenzettel: kein Zettel / kein Eintrag / Urlaub, Krank, Frei an dem Tag;
 * Reise beginnt nach dem Arbeitsbeginn bzw. endet vor dem Arbeitsende (nur An- und Abreisetag, 0:00/24:00 zählt nicht).
 */
function tripDayIssues(r) {
  const day = sheetDayFor(r.date);
  if (!day) return ['Kein Stundenzettel für diesen Tag'];
  if (!canWork(day)) return [`Im Stundenzettel als ${DAY_STATUS_SHORT[day.status]} eingetragen`];
  const rows = day.rows.filter((x) => !rowIsEmpty(x));
  if (!rows.length) return ['Im Stundenzettel kein Eintrag'];
  const issues = [];
  const starts = rows.map((x) => x.start).filter((v) => v != null);
  const ends = rows.map((x) => x.end).filter((v) => v != null);
  const workStart = starts.length ? Math.min(...starts) : null;
  const workEnd = ends.length ? Math.max(...ends) : null;
  if (r.start != null && r.start > 0 && workStart != null && r.start > workStart)
    issues.push(`Reise beginnt ${fmtClock(r.start)}, Arbeit laut Zettel schon ${fmtTime(workStart)}`);
  if (r.end != null && r.end < 1440 && workEnd != null && r.end < workEnd)
    issues.push(`Reise endet ${fmtClock(r.end)}, Arbeit laut Zettel erst ${fmtTime(workEnd)}`);
  return issues;
}

function tripProblems(t) {
  const problems = [];
  if (!(t.name || settings.name).trim()) problems.push('Name fehlt (in den Einstellungen)');
  for (const r of tripRows(t)) {
    const day = `${WEEKDAYS_SHORT[(r.date.getDay() + 6) % 7]} ${fmtDayMonth(r.date)}`;
    const missing = [r.start == null && 'Beginn', r.end == null && 'Ende', !r.text.trim() && 'Reiseanlass'].filter(Boolean);
    if (missing.length) problems.push(`${day}: ${missing.join(', ')} ${missing.length > 1 ? 'fehlen' : 'fehlt'}`);
    for (const issue of tripDayIssues(r)) problems.push(`${day}: ${issue}`);
  }
  if (!(t.place || '').trim()) problems.push('Ort fehlt');
  if (!(settings.signature && settings.signature.strokes && settings.signature.strokes.length))
    problems.push('Unterschrift fehlt (in den Einstellungen)');
  return problems;
}

function sendTripWithCheck(t) {
  if (!t.dates.length) return toast('Bitte zuerst die Reisetage antippen');
  const problems = tripProblems(t);
  if (!problems.length) return shareTripPdf(t);
  confirmDialog(
    'Bitte prüfen',
    `<ul class="problem-list">${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`,
    'Trotzdem senden',
    () => shareTripPdf(t),
    false,
    'Zurück'
  );
}

function tripPdfFile(t) {
  const rows = tripRows(t);
  const sorted = rows.map((r) => r.date);
  const blob = buildTravelPdf({
    title: tripTitle(t),
    name: t.name || settings.name,
    from: fmtShort(sorted[0]),
    to: fmtShort(sorted.at(-1)),
    rows,
    total: tripTotal(rows),
    place: (t.place || '').trim(),
    signDate: t.signDate ? fmtShort(parseDate(t.signDate)) : '',
    signature: settings.signature,
  });
  return new File([blob], `${tripTitle(t)}.pdf`, { type: 'application/pdf' });
}

async function shareTripPdf(t) {
  let file;
  try {
    file = tripPdfFile(t);
  } catch (e) {
    toast('PDF konnte nicht erstellt werden');
    return;
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(tripTitle(t)).then(
      () => toast('Betreff kopiert – in Mail bei „Betreff“ einsetzen', 4000),
      () => {}
    );
  }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      downloadFile(file);
    }
  } else {
    downloadFile(file);
  }
  if (!t.sentAt) {
    confirmDialog('Wurde die Abrechnung gesendet?', 'Dann wird sie als gesendet markiert.', 'Ja, gesendet', () => {
      t.sentAt = Date.now();
      saveTrips(t);
    });
  }
}

// ───────────────────────── Unterschrift ─────────────────────────
// Gespeichert als Linienzüge: { ratio: Höhe/Breite, strokes: [[[x, y], …], …] } mit x, y zwischen 0 und 1

function signatureSVG(sig, height = 44) {
  const ratio = sig.ratio || 0.35;
  const paths = sig.strokes
    .map((st) => `<polyline points="${st.map(([x, y]) => `${(x * 100).toFixed(1)},${(y * ratio * 100).toFixed(1)}`).join(' ')}"/>`)
    .join('');
  return `<svg class="sig-preview" viewBox="0 0 100 ${(ratio * 100).toFixed(1)}" height="${height}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/** Gültige Unterschrift? { ratio, strokes: [[[x, y], …], …] } */
const isSignature = (sig) =>
  !!sig && typeof sig.ratio === 'number' && Array.isArray(sig.strokes) && sig.strokes.length > 0 &&
  sig.strokes.every((st) => Array.isArray(st) && st.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));

function signaturePad() {
  const modal = openModal(
    `${modalHead('Unterschrift')}
    <div class="sig-wrap"><canvas class="sig-canvas"></canvas><div class="sig-line"></div><span class="sig-hint muted">Mit dem Finger unterschreiben</span></div>
    <button class="modal-wide" data-m="clear">Neu beginnen</button>`,
    'sheet'
  );
  const canvas = modal.querySelector('canvas');
  const hint = modal.querySelector('.sig-hint');
  const w = modal.querySelector('.sig-wrap').clientWidth;
  const h = Math.round(w * 0.4);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = getComputedStyle(document.body).color;
  let strokes = [];
  let current = null;
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    current = [point(e)];
    strokes.push(current);
    hint.hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    const p = point(e);
    const last = current.at(-1);
    current.push(p);
    ctx.beginPath();
    ctx.moveTo(last[0] * w, last[1] * h);
    ctx.lineTo(p[0] * w, p[1] * h);
    ctx.stroke();
  });
  const stop = () => (current = null);
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  modal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    if (b.dataset.m === 'clear') {
      strokes = [];
      ctx.clearRect(0, 0, w, h);
      hint.hidden = false;
      return;
    }
    if (b.dataset.m === 'ok' && strokes.length) {
      const round = (v) => Math.round(v * 1000) / 1000;
      settings.signature = { ratio: round(h / w), strokes: strokes.map((st) => st.map(([x, y]) => [round(x), round(y)])) };
      saveSettings();
    }
    closeModal();
    renderSettings();
  });
}

// ───────────────────────── Einstellungen ─────────────────────────

function renderSettings() {
  app.innerHTML = `
    <header class="nav">
      <button class="nav-btn back" data-act="back" aria-label="Zurück">${ICON.back}</button>
      <span class="nav-title"></span>
      <span class="nav-btn"></span>
    </header>
    <h1 class="large-title">Einstellungen</h1>
    <h2 class="section-title">Stundenzettel</h2>
    <div class="card form">
      <label class="field"><span>Name</span><input data-s="name" placeholder="Vor- und Nachname" value="${escapeHtml(settings.name)}" autocomplete="name" enterkeyhint="done"></label>
    </div>
    <p class="footnote">Steht auf jedem neuen Stundenzettel.</p>

    <h2 class="section-title">Lohn</h2>
    <div class="card form">
      <label class="field"><span>Stundenlohn</span><input data-s="wage" inputmode="decimal" placeholder="0,00" value="${escapeHtml(settings.wage)}" enterkeyhint="done"><span class="unit">€</span></label>
      <label class="field"><span>Feste Zulage im Monat</span><input data-s="bonus" inputmode="decimal" placeholder="0,00" value="${escapeHtml(settings.bonus)}" enterkeyhint="done"><span class="unit">€</span></label>
      <label class="field"><span>Steuerklasse</span><select data-s="taxClass">${[1, 2, 3, 4, 5, 6]
        .map((k) => `<option value="${k}" ${String(settings.taxClass) === String(k) ? 'selected' : ''}>${['I', 'II', 'III', 'IV', 'V', 'VI'][k - 1]}</option>`)
        .join('')}</select></label>
      <label class="field"><span>Kirchensteuer</span><input type="checkbox" class="toggle" data-s="church" ${settings.church ? 'checked' : ''}></label>
      <label class="field"><span>Kinder</span><select data-s="children">${[0, 1, 2, 3, 4, 5]
        .map((k) => `<option value="${k}" ${String(settings.children) === String(k) ? 'selected' : ''}>${k === 5 ? '5 oder mehr' : k}</option>`)
        .join('')}</select></label>
      <label class="field"><span>Zusatzbeitrag Krankenkasse</span><input data-s="kvExtra" inputmode="decimal" placeholder="0,00" value="${escapeHtml(settings.kvExtra)}" enterkeyhint="done"><span class="unit">%</span></label>
      <label class="field"><span>Betriebsrente (dein Beitrag)</span><input data-s="bav" inputmode="decimal" placeholder="0,00" value="${escapeHtml(settings.bav)}" enterkeyhint="done"><span class="unit">€</span></label>
    </div>
    <p class="footnote">Damit schätzt die Übersicht dein Netto je Monat: Soll-Stunden mal Stundenlohn, Überstunden mit 25 % Zuschlag, dazu die feste Zulage. Dein Beitrag zur Betriebsrente wird vom Brutto abgezogen, der Zuschuss vom Arbeitgeber ändert dein Netto nicht. Die Angaben bleiben auf diesem iPhone.</p>

    ${hiddenSuggestionsHTML()}

    <h2 class="section-title">Reisekosten</h2>
    <div class="card form">
      <label class="field"><span>Ort</span><input data-s="place" placeholder="z. B. Firmensitz" value="${escapeHtml(settings.place || '')}" enterkeyhint="done"></label>
      ${
        settings.signature
          ? `<div class="field sig-field"><span>Unterschrift</span>${signatureSVG(settings.signature)}</div>
      <button class="list-btn" data-act="sign">Neu unterschreiben …</button>
      <button class="list-btn destructive" data-act="sign-clear">Unterschrift löschen</button>`
          : `<button class="list-btn" data-act="sign">Unterschrift hinzufügen …</button>`
      }
    </div>
    <p class="footnote">Ort und Unterschrift stehen unten auf der Reisekostenabrechnung. Ohne Unterschrift bleibt das Feld leer.</p>

    <h2 class="section-title">Datensicherung</h2>
    <div class="card list">
      <button class="list-btn" data-act="backup-export">Sicherung speichern …</button>
      <label class="list-btn">Sicherung einlesen …<input type="file" multiple accept="${IMPORT_ACCEPT}" data-act-change="backup-import" hidden></label>
    </div>
    <p class="footnote">Deine Zettel sind nur auf diesem iPhone. Speichere ab und zu eine Sicherung in iCloud Drive. Beim Einlesen geht nichts verloren.</p>
    <p class="footnote">Einlesen geht auch mit Stundenzetteln als Numbers- oder PDF-Datei, auch mehrere auf einmal.</p>
    <p class="footnote center muted">${sheets.length} Stundenzettel gespeichert</p>`;
}

function hiddenSuggestionsHTML() {
  const items = ['site', 'work'].flatMap((field) => settings.hiddenSuggestions[field].map((value) => ({ field, value })));
  return `<h2 class="section-title">Vorschläge</h2>
    ${
      items.length
        ? `<div class="card form">${items
            .map(
              ({ field, value }) => `<div class="field"><span class="hidden-sugg"><span class="field-icon-inline">${field === 'site' ? ICON.pin : ICON.tool}</span>${escapeHtml(value)}</span>
          <button class="link-btn" data-act="unhide" data-field="${field}" data-value="${escapeHtml(value)}">Wiederherstellen</button></div>`
            )
            .join('')}</div>`
        : ''
    }
    <p class="footnote">Lange auf einen Vorschlag über der Tastatur drücken, um ihn auszublenden.</p>`;
}

function exportBackup() {
  const data = JSON.stringify({ app: 'stundenzettel', version: 1, exportedAt: new Date().toISOString(), sheets, trips, settings, payslips }, null, 2);
  const file = new File([data], `Yetizettel-Sicherung ${isoDate(new Date())}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch((e) => {
      if (!e || e.name !== 'AbortError') downloadFile(file);
    });
  } else {
    downloadFile(file);
  }
}

/** Inhalt eines Tages zum Vergleichen und Anzeigen: „07:00–16:00 Ort · Arbeit; Pause 0,50 h“ bzw. „Urlaub“ */
function dayText(d) {
  const rows = d.rows
    .filter((r) => !rowIsEmpty(r))
    .map((r) => {
      const time = r.start != null || r.end != null ? `${r.start != null ? fmtTime(r.start) : '?'}–${r.end != null ? fmtTime(r.end) : '?'}` : '';
      return [time, [(r.site || '').trim(), (r.work || '').trim()].filter(Boolean).join(' · ')].filter(Boolean).join(' ');
    });
  if (d.status && !canWork(d)) return DAY_STATUS_SHORT[d.status];
  const parts = [...(d.status ? [DAY_STATUS_SHORT[d.status]] : []), ...rows];
  if (d.pause) parts.push(`Pause ${fmtH(d.pause)}`);
  return parts.join('; ') || '–';
}
/** Tage, an denen sich zwei Fassungen desselben Zettels unterscheiden: [{ i, mine, theirs }] */
function sheetDiff(mine, theirs) {
  return sheetActiveDays(mine)
    .map((i) => ({ i, mine: dayText(mine.days[i]), theirs: dayText(theirs.days[i] || { rows: [] }) }))
    .filter((x) => x.mine !== x.theirs);
}
/** Ein Reisetag als Text für den Vergleich; „–“, wenn der Tag nicht zur Abrechnung gehört */
function tripDayText(r) {
  if (!r) return '–';
  const time = r.start != null || r.end != null ? `${r.start != null ? fmtClock(r.start) : '?'}–${r.end != null ? fmtClock(r.end) : '?'}` : '';
  return [time, [r.places.trim(), r.works.trim()].filter(Boolean).join(' · '), r.meal ? fmtEuro(r.meal) : ''].filter(Boolean).join(' ') || '–';
}
/** Unterschiede zweier Fassungen derselben Abrechnung: [{ label, mine, theirs }] (Tage, dazu Ort/Datum der Unterschrift) */
function tripDiff(mine, theirs) {
  const a = new Map(tripRows(mine).map((r) => [r.iso, r]));
  const b = new Map(tripRows(theirs).map((r) => [r.iso, r]));
  const out = [...new Set([...a.keys(), ...b.keys()])].sort().map((iso) => {
    const d = parseDate(iso);
    return { label: `${WEEKDAYS_SHORT[(d.getDay() + 6) % 7]} ${fmtDayMonth(d)}`, mine: tripDayText(a.get(iso)), theirs: tripDayText(b.get(iso)) };
  });
  const sign = (t) => [(t.place || '').trim(), t.signDate ? fmtShort(parseDate(t.signDate)) : ''].filter(Boolean).join(', ') || '–';
  out.push({ label: 'Ort, Datum', mine: sign(mine), theirs: sign(theirs) });
  return out.filter((x) => x.mine !== x.theirs);
}
const weekKey = (s) => `${s.weekStart}|${s.year}|${s.month}`;
/** „12.10.26, 14:03“ */
const fmtStamp = (ms) => (ms ? `${fmtShort(new Date(ms))}, ${fmtTime(new Date(ms).getHours() * 60 + new Date(ms).getMinutes())}` : 'unbekannt');

/**
 * Sicherung (JSON) übernehmen. Neue Zettel kommen dazu; gibt es die Woche (oder die ID) schon, wird verglichen:
 * gleich → nichts, verschieden → Rückfrage (conflicts, wird in importBackup entschieden).
 */
function mergeBackup(data) {
  const incoming = Array.isArray(data) ? data : data.sheets;
  if (!Array.isArray(incoming) || !incoming.every((s) => s && s.id && s.weekStart && Array.isArray(s.days))) throw new Error('format');
  let added = 0;
  let same = 0;
  const conflicts = [];
  // Neues Gerät (noch kein Name eingetragen, z. B. nach dem Neu-Anlegen auf dem Home-Bildschirm):
  // Einstellungen aus der Sicherung übernehmen – Name, Ort, ausgeblendete Vorschläge usw.
  // Die fest vorgegebenen Werte (Wochenstunden, Bundesland, Zeitschritte) bleiben unverändert.
  let settingsRestored = false;
  if (!settings.name.trim() && data.settings && typeof data.settings === 'object' && String(data.settings.name || '').trim()) {
    const fixed = ['target', 'hoursPerDay', 'state', 'minuteStep', 'signature'];
    for (const [k, v] of Object.entries(data.settings)) if (!fixed.includes(k)) settings[k] = v;
    settings.hiddenSuggestions = { site: [], work: [], ...settings.hiddenSuggestions };
    saveSettings();
    settingsRestored = true;
  }
  const myName = settings.name.trim();
  let renamed = 0;
  for (const s of incoming) {
    // Eigener Name aus den Einstellungen statt des Namens in der Sicherung
    if (myName && s.name !== myName) {
      s.name = myName;
      renamed++;
    }
    const current = sheets.find((x) => x.id === s.id) || sheets.find((x) => weekKey(x) === weekKey(s));
    if (!current) {
      sheets.push(s);
      added++;
    } else if (sheetDiff(current, s).length) conflicts.push({ existing: current, incoming: s, stamp: s.updatedAt, stampLabel: 'geändert', backup: true });
    else same++;
  }
  saveSheets();
  // Unterschrift aus der Sicherung nur, wenn auf diesem Gerät noch keine gesetzt ist
  let signature = false;
  if (!settings.signature && data.settings && isSignature(data.settings.signature)) {
    settings.signature = data.settings.signature;
    saveSettings();
    signature = true;
  }
  // Reisekostenabrechnungen (gleiche ID): gleich → nichts, verschieden → Rückfrage wie bei den Zetteln
  let tripsAdded = 0;
  let tripsSame = 0;
  if (Array.isArray(data.trips)) {
    for (const raw of data.trips) {
      if (!raw || !raw.id || !Array.isArray(raw.dates)) continue;
      const t = { over: {}, ...raw, ...(myName ? { name: myName } : {}) };
      const cur = findTrip(t.id);
      if (!cur) {
        trips.push(t);
        tripsAdded++;
      } else if (tripDiff(cur, t).length) conflicts.push({ trip: true, existing: cur, incoming: t, stamp: t.updatedAt, stampLabel: 'geändert', backup: true });
      else tripsSame++;
    }
    saveTrips();
  }
  // Lohnabrechnungen: fehlende Monate übernehmen, vorhandene bleiben
  if (data.payslips && typeof data.payslips === 'object') {
    let n = 0;
    for (const [k, p] of Object.entries(data.payslips)) {
      if (!payslips[k] && p && p.year && p.month && p.hours) {
        payslips[k] = p;
        n++;
      }
    }
    if (n) savePayslips();
  }
  return { added, same, conflicts, signature, renamed, tripsAdded, tripsSame, settingsRestored };
}

/** Eine oder mehrere Dateien einlesen: Sicherung (.json), Stundenzettel als Numbers-Datei oder PDF */
/** Dateitypen für „Einlesen“ (nur diese, damit iOS keine Kamera/Fotos anbietet) */
const IMPORT_ACCEPT =
  '.json,.numbers,.pdf,application/json,application/pdf,application/vnd.apple.numbers,application/x-iwork-numbers-sffnumbers';

/** Dateiauswahl zum Einlesen öffnen – muss direkt im Antippen laufen, sonst blockiert Safari sie */
function pickImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = IMPORT_ACCEPT;
  input.hidden = true;
  input.addEventListener('change', () => {
    importBackup(input);
    input.remove();
  });
  document.body.append(input);
  input.click();
}

async function importBackup(input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const lines = [];
  const conflicts = [];
  let total = 0;
  let tripCount = 0;
  toast(files.length > 1 ? `${files.length} Dateien werden eingelesen …` : 'Wird eingelesen …', 10000);
  for (const file of files) {
    const label = `<b>${escapeHtml(file.name)}</b>`;
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 1))[0];
      if (/\.json$/i.test(file.name) || head === 0x7b || head === 0x5b) {
        const r = mergeBackup(JSON.parse(new TextDecoder().decode(buf)));
        total += r.added;
        tripCount += r.tripsAdded;
        r.conflicts.forEach((c) => conflicts.push({ ...c, file: file.name }));
        const sheetConf = r.conflicts.filter((c) => !c.trip).length;
        const tripConf = r.conflicts.length - sheetConf;
        const parts = [`${r.added} Stundenzettel neu`];
        if (r.same) parts.push(`${r.same} schon vorhanden (gleich)`);
        if (sheetConf) parts.push(`${sheetConf} mit Unterschieden`);
        if (r.tripsAdded || r.tripsSame || tripConf) {
          const tp = [`${r.tripsAdded} Reisekostenabrechnung${r.tripsAdded === 1 ? '' : 'en'} neu`];
          if (r.tripsSame) tp.push(`${r.tripsSame} schon vorhanden (gleich)`);
          if (tripConf) tp.push(`${tripConf} mit Unterschieden`);
          parts.push(tp.join(', '));
        }
        if (r.settingsRestored) parts.push('Einstellungen übernommen');
        if (r.signature) parts.push('Unterschrift übernommen');
        if (r.renamed) parts.push(`Name bei ${r.renamed} auf „${escapeHtml(settings.name.trim())}“ geändert`);
        lines.push(`${label}: ${parts.join(', ')}`);
        continue;
      }
      const s = await importTimesheetFile(file.name, buf);
      const existing = existingSheet(sheetFirstDate(s));
      const other = s.importedName && s.importedName.trim() !== s.name;
      delete s.importedName;
      if (existing) {
        const range = `${fmtShort(sheetFirstDate(s))} – ${fmtShort(sheetLastDate(s))}`;
        if (!sheetDiff(existing, s).length) lines.push(`${label}: ${range} schon vorhanden (gleich)`);
        else {
          conflicts.push({ existing, incoming: s, stamp: file.lastModified, stampLabel: 'Datei vom', file: file.name });
          lines.push(`${label}: ${range} schon vorhanden, mit Unterschieden`);
        }
        continue;
      }
      s.sentAt = Date.now(); // eingelesene Zettel gelten als schon gesendet
      sheets.push(s);
      saveSheets(s);
      total++;
      lines.push(
        `${label}: ${fmtShort(sheetFirstDate(s))} – ${fmtShort(sheetLastDate(s))}, ${fmtH(sheetTotal(s))}${other ? ` · Name auf „${escapeHtml(s.name)}“ geändert` : ''}`
      );
    } catch (e) {
      lines.push(`${label}: konnte nicht gelesen werden${e && e.message && e.message !== 'format' ? ` (${escapeHtml(e.message)})` : ''}`);
    }
  }
  document.getElementById('toast').classList.remove('show');
  // Zettel und Abrechnungen mit Unterschieden: selbst entscheiden (einzeln, oder alle ersetzen / alle überspringen)
  let all = null;
  for (let k = 0; k < conflicts.length; k++) {
    const c = conflicts[k];
    const choice = all || (await askConflict(c, conflicts.length - k));
    if (choice === 'replaceAll' || choice === 'keepAll') all = choice;
    const replace = choice === 'replace' || choice === 'replaceAll';
    if (replace) {
      if (c.trip) {
        replaceTrip(c);
        tripCount++;
      } else {
        replaceSheet(c);
        total++;
      }
    }
    lines.push(`<b>${escapeHtml(conflictTitle(c))}</b>: ${replace ? 'durch die neue Fassung ersetzt' : 'Fassung in der App behalten'}`);
  }
  if (conflicts.some((c) => !c.trip)) saveSheets();
  if (conflicts.some((c) => c.trip)) saveTrips();
  if (currentView === 'settings') renderSettings();
  if (currentView === 'list') renderList();
  if (currentView === 'trips') renderTripList();
  const done = [total ? `${total} Stundenzettel` : '', tripCount ? `${tripCount} Reisekostenabrechnung${tripCount === 1 ? '' : 'en'}` : ''].filter(Boolean);
  infoDialog(done.length ? `${done.join(' und ')} eingelesen` : 'Nichts eingelesen', `<ul class="problem-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`);
}

/** Neue Fassung übernehmen; der Zettel behält seine ID (Verknüpfung zu Reisekosten), aus Dateien auch den Status */
function replaceSheet(c) {
  const { existing, incoming } = c;
  if (c.backup) {
    Object.assign(existing, { ...incoming, id: existing.id });
  } else {
    existing.days = incoming.days;
    existing.name = incoming.name;
  }
  existing.updatedAt = Date.now();
}

/** Neue Fassung einer Abrechnung übernehmen (ID bleibt) */
function replaceTrip(c) {
  Object.assign(c.existing, { ...c.incoming, id: c.existing.id });
  c.existing.updatedAt = Date.now();
}

/** „06.07.26 – 10.07.26“ (Zettel) bzw. „Reisekostenabrechnung 06.07.26 - 08.07.26“ */
const conflictTitle = (c) =>
  c.trip ? tripTitle(c.existing) : `${fmtShort(sheetFirstDate(c.existing))} – ${fmtShort(sheetLastDate(c.existing))}`;

/** Rückfrage bei einem doppelten Zettel (oder einer Abrechnung) mit Unterschieden; Ergebnis: 'keep' | 'replace' | 'keepAll' | 'replaceAll' */
function askConflict(c, remaining) {
  return new Promise((resolve) => {
    const { existing: mine, incoming: theirs } = c;
    const sentLabel = (s) => (s.sentAt ? 'gesendet' : 'offen');
    const sum = (x) => (c.trip ? fmtEuro(tripTotal(tripRows(x))) : fmtH(sheetTotal(x)));
    const diffs = c.trip
      ? tripDiff(mine, theirs)
      : sheetDiff(mine, theirs).map((d) => ({ ...d, label: `${WEEKDAYS_SHORT[d.i]} ${fmtDayMonth(sheetDate(mine, d.i))}` }));
    const diff = diffs
      .map(
        (d) => `<li><b>${d.label}</b>
          <span class="cf-line"><span class="cf-tag app">App</span>${escapeHtml(d.mine)}</span>
          <span class="cf-line"><span class="cf-tag new">Neu</span>${escapeHtml(d.theirs)}</span></li>`
      )
      .join('');
    const modal = openModal(
      `<div class="alert-body cf">
        <b>${c.trip ? 'Reisekostenabrechnung doppelt' : 'Stundenzettel doppelt'}</b>
        <div class="alert-msg">
          <p class="cf-intro"><b>${escapeHtml(conflictTitle(c))}</b> gibt es schon, aber mit Unterschieden.</p>
          <div class="cf-versions">
            <div><span class="cf-tag app">App</span>geändert ${fmtStamp(mine.updatedAt)} · ${sum(mine)} · ${sentLabel(mine)}</div>
            <div><span class="cf-tag new">Neu</span>${escapeHtml(c.stampLabel)} ${fmtStamp(c.stamp)} · ${sum(theirs)}${c.backup ? ` · ${sentLabel(theirs)}` : ''}<br><span class="muted">aus ${escapeHtml(c.file)}</span></div>
          </div>
          <ul class="cf-diff">${diff}</ul>
        </div>
      </div>
      <div class="alert-buttons stacked">
        <button data-c="replace">Neue Fassung übernehmen</button>
        <button data-c="keep" class="strong">Fassung in der App behalten</button>
        ${remaining > 1 ? `<button data-c="replaceAll">Alle ${remaining} ersetzen</button><button data-c="keepAll">Alle ${remaining} überspringen</button>` : ''}
      </div>`,
      'alert wide'
    );
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      closeModal();
      // Nächste Rückfrage erst, wenn diese ganz geschlossen ist
      setTimeout(() => resolve(v), 280);
    };
    modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (b) finish(b.dataset.c);
    });
    // Antippen neben das Fenster: Fassung in der App behalten
    layer.querySelector('.backdrop').addEventListener('click', () => finish('keep'));
  });
}

function infoDialog(title, message) {
  const modal = openModal(
    `<div class="alert-body"><b>${title}</b><div class="alert-msg">${message}</div></div>
    <div class="alert-buttons single"><button data-c="ok" class="strong">OK</button></div>`,
    'alert'
  );
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-c]')) closeModal();
  });
}

// ───────────────────────── Modale Fenster ─────────────────────────

const layer = document.getElementById('modal-layer');
let modalGen = 0;

function openModal(html, className = '') {
  const gen = ++modalGen;
  layer.innerHTML = `<div class="backdrop"></div><div class="modal ${className}" role="dialog" aria-modal="true">${html}</div>`;
  layer.classList.add('open');
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  requestAnimationFrame(() => requestAnimationFrame(() => gen === modalGen && layer.classList.add('show')));
  layer.querySelector('.backdrop').addEventListener('click', () => closeModal());
  return layer.querySelector('.modal');
}

/** Bei offenem Fenster scrollt nichts im Hintergrund: Ziehen zählt nur in Bereichen des Fensters, die selbst scrollen
 *  (Uhrzeit-Räder, lange Hinweise). Eigene Gesten wie das Monats-Ziehen im Kalender laufen weiter über ihre Touch-Ereignisse. */
function scrollableIn(el) {
  for (; el && el !== layer; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
  }
  return null;
}
layer.addEventListener(
  'touchmove',
  (e) => {
    if (!scrollableIn(e.target)) e.preventDefault();
  },
  { passive: false }
);

function closeModal(immediate = false) {
  const gen = ++modalGen;
  layer.classList.remove('show');
  const clear = () => {
    if (gen !== modalGen) return;
    layer.classList.remove('open');
    layer.innerHTML = '';
  };
  if (immediate) clear();
  else setTimeout(clear, 260);
}

function modalHead(title, okLabel = 'Fertig') {
  return `<div class="modal-head">
    <button class="modal-btn" data-m="cancel">Abbrechen</button>
    <b>${title}</b>
    <button class="modal-btn strong" data-m="ok">${okLabel}</button>
  </div>`;
}

/** Scroll-Räder wie bei iOS. columns: [{ values, label }], initial: Werte je Spalte */
function wheelPicker(title, columns, initial, onDone, extraHTML = '', onExtra = null) {
  const ITEM = 40;
  const modal = openModal(
    `${modalHead(title)}
    <div class="wheels">
      ${columns
        .map(
          (col, ci) => `${ci > 0 && col.sep ? `<div class="wheel-sep">${col.sep}</div>` : ''}
        <div class="wheel" data-col="${ci}"><div class="wheel-list">${col.values
          .map((v) => `<div class="wheel-item">${col.label(v)}</div>`)
          .join('')}</div></div>`
        )
        .join('')}
      <div class="wheel-band"></div>
    </div>
    ${extraHTML}`,
    'sheet'
  );
  const lists = [...modal.querySelectorAll('.wheel-list')];
  const indexOf = (list) => Math.max(0, Math.min(list.children.length - 1, Math.round(list.scrollTop / ITEM)));
  const mark = (list) => {
    const idx = indexOf(list);
    [...list.children].forEach((el, i) => el.classList.toggle('sel', i === idx));
  };
  lists.forEach((list, ci) => {
    const col = columns[ci];
    let idx = col.values.indexOf(initial[ci]);
    if (idx < 0) {
      // nächstliegenden Wert wählen
      idx = col.values.reduce((best, v, i) => (Math.abs(v - initial[ci]) < Math.abs(col.values[best] - initial[ci]) ? i : best), 0);
    }
    list.scrollTop = idx * ITEM;
    mark(list);
    let raf = 0;
    list.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => mark(list));
    });
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.wheel-item');
      if (item) list.scrollTo({ top: [...list.children].indexOf(item) * ITEM, behavior: 'smooth' });
    });
  });
  modal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    if (b.dataset.m === 'ok') {
      const vals = lists.map((list, ci) => columns[ci].values[indexOf(list)]);
      closeModal();
      onDone(vals);
    } else if (b.dataset.m === 'cancel') {
      closeModal();
    } else if (b.dataset.m === 'extra' && onExtra) {
      closeModal();
      onExtra();
    }
  });
}

function timePicker(title, initial, hasValue, onDone) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const step = settings.minuteStep;
  const minutes = Array.from({ length: 60 / step }, (_, i) => i * step);
  wheelPicker(
    title,
    [
      { values: hours, label: pad },
      { values: minutes, label: pad, sep: ':' },
    ],
    [Math.floor(initial / 60), Math.floor((initial % 60) / step) * step],
    ([h, m]) => onDone(h * 60 + m),
    hasValue ? `<button class="modal-wide destructive" data-m="extra">Zeit löschen</button>` : '',
    () => onDone(null)
  );
}

/** Wochenwahl; forTrip: für eine Reisekostenabrechnung (ganze Woche, ohne Hinweise zu Stundenzetteln) */
function weekPicker(initial, excludeId, onPick, forTrip = false) {
  let selected = startOfDay(initial);
  let month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const modal = openModal(`${modalHead('Woche wählen', 'Übernehmen')}<div class="wp"></div>`, 'sheet wp-sheet');
  const wp = modal.querySelector('.wp');

  // Wochen, für die es schon einen Zettel bzw. eine Abrechnung gibt: Montag → 'sent' oder 'open' (offen hat Vorrang)
  const known = new Map();
  const mark = (monday, sent) => {
    const k = isoDate(mondayOf(monday));
    known.set(k, known.get(k) === 'open' || !sent ? 'open' : 'sent');
  };
  if (forTrip) for (const t of trips) for (const d of new Set([t.from, ...t.dates])) mark(parseDate(d), !!t.sentAt);
  else for (const sh of sheets) if (sh.id !== excludeId) mark(parseDate(sh.weekStart), !!sh.sentAt);

  /** Ein Monat als Raster: Kopfzeile, KW-Spalte, Tage – immer 6 Wochen, damit der Kalender beim Blättern gleich hoch bleibt */
  function gridHTML(m) {
    const preview = newSheet(selected, '');
    const weeks = [0, 1, 2, 3, 4, 5].map((k) => addDays(mondayOf(m), 7 * k));
    const today = new Date();
    return `<div class="wp-grid">
        <div class="wp-h">KW</div>${WEEKDAYS_SHORT.map((d) => `<div class="wp-h">${d}</div>`).join('')}
        ${weeks
          .map((w) => {
            const inWeek = isoDate(w) === preview.weekStart;
            return `<div class="wp-kw ${known.get(isoDate(w)) || ''}"><span>${isoWeek(w)}</span></div>${[0, 1, 2, 3, 4, 5, 6]
              .map((i) => {
                const d = addDays(w, i);
                const cls = [
                  'wp-day',
                  d.getMonth() !== m.getMonth() ? 'out' : '',
                  inWeek ? 'in-week' : '',
                  inWeek && (forTrip || (d.getMonth() + 1 === preview.month && d.getFullYear() === preview.year)) ? 'in-sheet' : '',
                  sameDay(d, selected) ? 'sel' : '',
                  sameDay(d, today) ? 'today' : '',
                  holidayName(d) ? 'holiday' : '',
                ].join(' ');
                return `<button class="${cls}" data-date="${isoDate(d)}"><span class="wp-num">${d.getDate()}</span></button>`;
              })
              .join('')}`;
          })
          .join('')}
      </div>`;
  }

  // Vormonat, Monat und Folgemonat liegen nebeneinander; beim Wischen wird der Streifen mit dem Finger verschoben
  let strip = null;
  let viewport = null;
  function draw() {
    const preview = newSheet(selected, '');
    const exists = existingSheet(selected, excludeId);
    const prevMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);

    wp.innerHTML = `
      <div class="wp-nav">
        <button class="icon-btn" data-wp="prev" aria-label="Voriger Monat">${ICON.chevronLeft}</button>
        <b>${MONTHS[month.getMonth()]} ${month.getFullYear()}</b>
        <button class="icon-btn" data-wp="next" aria-label="Nächster Monat">${ICON.chevronRight}</button>
      </div>
      <div class="wp-viewport"><div class="wp-strip">${gridHTML(prevMonth)}${gridHTML(month)}${gridHTML(nextMonth)}</div></div>
      ${
        forTrip
          ? `<div class="wp-preview">
        <b>Woche ${fmtShort(mondayOf(selected))} – ${fmtShort(addDays(mondayOf(selected), 6))}</b>
        <span class="muted">Danach tippst du die Reisetage an.</span>
        ${holidaysLine()}
      </div>`
          : `<div class="wp-preview">
        <b>${sheetTitle(preview)}</b>
        <span class="muted">${exists ? (excludeId ? 'Für diese Woche gibt es schon einen Zettel' : 'Gibt es schon – wird geöffnet') : 'Ausgegraute Tage gehören zum anderen Monat'}</span>
        ${holidaysLine()}
      </div>`
      }`;
    viewport = wp.querySelector('.wp-viewport');
    strip = wp.querySelector('.wp-strip');
  }
  /** Feiertage der gewählten Woche: „Feiertag: Fr 03.10. Tag der Deutschen Einheit“ (Platz für zwei Zeilen) */
  function holidaysLine() {
    const monday = mondayOf(selected);
    const list = [0, 1, 2, 3, 4, 5, 6]
      .map((i) => addDays(monday, i))
      .filter((d) => holidayName(d))
      .map((d) => `${WEEKDAYS_SHORT[(d.getDay() + 6) % 7]} ${fmtDayMonth(d)} ${escapeHtml(holidayName(d))}`);
    // Zeile ist immer da (auch leer), damit der Kalender beim Auswählen nicht springt
    return `<span class="wp-hol-line">${list.length ? `Feiertag: ${list.join(', ')}` : ''}</span>`;
  }

  const POS = { '-1': '0%', 0: '-33.3333%', 1: '-66.6667%' };
  let animating = false;
  /** Streifen einrasten lassen: dir −1 = Vormonat, 0 = zurück, 1 = Folgemonat */
  function settle(dir) {
    animating = true;
    strip.style.transition = 'transform 0.28s cubic-bezier(0.25, 0.8, 0.3, 1)';
    strip.style.transform = `translateX(${POS[dir]})`;
    setTimeout(() => {
      animating = false;
      if (dir) {
        month = new Date(month.getFullYear(), month.getMonth() + dir, 1);
        draw();
      }
    }, 290);
  }
  const shiftMonth = (dir) => !animating && settle(dir);
  draw();

  // Monat mit dem Finger ziehen (wie das Wischen zum Löschen)
  let drag = null;
  let draggedAt = 0;
  wp.addEventListener(
    'touchstart',
    (e) => {
      drag =
        !animating && e.touches.length === 1 && e.target.closest('.wp-viewport')
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dx: 0, active: false, dead: false }
          : null;
    },
    { passive: true }
  );
  wp.addEventListener(
    'touchmove',
    (e) => {
      if (!drag || drag.dead) return;
      const dx = e.touches[0].clientX - drag.x;
      const dy = e.touches[0].clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) return void (drag.dead = true);
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        drag.active = true;
        drag.x = e.touches[0].clientX;
        strip.style.transition = 'none';
        return;
      }
      drag.dx = dx;
      strip.style.transform = `translateX(calc(-33.3333% + ${dx}px))`;
    },
    { passive: true }
  );
  const endDrag = () => {
    const d = drag;
    drag = null;
    if (!d || !d.active) return;
    draggedAt = Date.now();
    const fast = Math.abs(d.dx) / Math.max(1, Date.now() - d.t) > 0.5 && Math.abs(d.dx) > 30;
    settle(Math.abs(d.dx) > viewport.offsetWidth * 0.25 || fast ? (d.dx < 0 ? 1 : -1) : 0);
  };
  wp.addEventListener('touchend', endDrag, { passive: true });
  wp.addEventListener('touchcancel', endDrag, { passive: true });

  modal.addEventListener('click', (e) => {
    const t = e.target.closest('[data-wp],[data-date],[data-m]');
    if (!t) return;
    if (t.dataset.wp === 'prev') return shiftMonth(-1);
    if (t.dataset.wp === 'next') return shiftMonth(1);
    if (t.dataset.date) {
      if (animating || Date.now() - draggedAt < 350) return; // nach dem Ziehen keinen Tag auswählen
      selected = parseDate(t.dataset.date);
    }
    else if (t.dataset.m === 'cancel') return closeModal();
    else if (t.dataset.m === 'ok') {
      closeModal();
      onPick(selected);
      return;
    }
    draw();
  });
}

function actionSheet(actions) {
  const modal = openModal(
    `<div class="action-group">${actions
      .map((a, i) => `<button class="action ${a.destructive ? 'destructive' : ''}" data-i="${i}">${a.label}</button>`)
      .join('')}</div>
    <button class="action cancel" data-i="-1">Abbrechen</button>`,
    'actions'
  );
  modal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeModal();
    const a = actions[Number(b.dataset.i)];
    // sofort ausführen: Zwischenablage und Teilen-Menü funktionieren in Safari nur direkt beim Antippen
    if (a) a.run();
  });
}

function confirmDialog(title, message, okLabel, onOk, destructive = false, cancelLabel = 'Abbrechen', onCancel = null) {
  const modal = openModal(
    `<div class="alert-body"><b>${title}</b><div class="alert-msg">${message}</div></div>
    <div class="alert-buttons">
      <button data-c="no">${cancelLabel}</button>
      <button data-c="yes" class="${destructive ? 'destructive' : 'strong'}">${okLabel}</button>
    </div>`,
    'alert'
  );
  modal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    closeModal();
    if (b.dataset.c === 'yes') onOk();
    else if (onCancel) onCancel();
  });
  // Antippen neben das Fenster zählt wie Abbrechen
  if (onCancel) layer.querySelector('.backdrop').addEventListener('click', onCancel);
}

let toastTimer = 0;
function toast(text, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ───────────────────────── Vorschläge (Baustelle / Art der Arbeit) ─────────────────────────

/** Feste Leiste direkt über der Tastatur, zeigt die Vorschläge zum gerade bearbeiteten Feld */
const suggestBar = document.createElement('div');
suggestBar.id = 'suggest-bar';
suggestBar.innerHTML = '<div class="suggest-grid"></div>';
document.body.appendChild(suggestBar);
const suggestGrid = suggestBar.firstChild;
/** Abstand zweier Texte: Buchstaben einfügen, löschen, ersetzen oder zwei benachbarte vertauschen zählt je 1 */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * Tippfehler bei Baustelle / Art der Arbeit: Ein Eintrag, den es so in keiner anderen Zeile gibt, der aber fast einem
 * schon benutzten gleicht (nur Groß-/Kleinschreibung, Leerzeichen, Satzzeichen oder 1–2 Buchstaben anders).
 * Kurze Texte sind strenger: unter 5 Zeichen nie, unter 10 Zeichen höchstens 1 Buchstabe Unterschied; andere Zahlen nie.
 * Ergebnis: { part, suggestion } oder null. „So lassen“ (✕) merkt sich der Eintrag in row.typoOk.
 */
function typoFor(field, row) {
  const value = row[field] || '';
  if (!value.trim() || (row.typoOk && row.typoOk[field] === value)) return null;
  // Schreibweisen aus allen anderen Zeilen: sameKey → { Schreibweise → Anzahl }
  const known = new Map();
  for (const sh of sheets)
    for (const d of sh.days)
      for (const r of d.rows) {
        if (r === row) continue;
        for (const part of field === 'work' ? (r[field] || '').split(',') : [r[field] || '']) {
          const v = part.trim();
          if (!v) continue;
          if (!known.has(sameKey(v))) known.set(sameKey(v), new Map());
          const m = known.get(sameKey(v));
          m.set(v, (m.get(v) || 0) + 1);
        }
      }
  const hidden = new Set(settings.hiddenSuggestions[field].map(sameKey));
  const best = (m) => [...m].sort((a, b) => b[1] - a[1])[0];
  const candidates = [...known].filter(([k]) => !hidden.has(k)).map(([, m]) => best(m));
  for (const raw of field === 'work' ? value.split(',') : [value]) {
    const part = raw.trim();
    if (!part) continue;
    const same = known.get(sameKey(part));
    if (same && same.has(part)) continue; // genau so schon benutzt
    if (same && !hidden.has(sameKey(part))) return { part, suggestion: best(same)[0] };
    const key = searchKey(part);
    const max = key.length >= 10 ? 2 : key.length >= 5 ? 1 : 0;
    let hit = null;
    const digits = (x) => x.replace(/\D/g, '');
    for (const [v, n] of candidates) {
      // Andere Zahlen („Halle 3“ / „Halle 4“, „Markt 12“ / „Markt 13“) sind kein Tippfehler
      if (digits(searchKey(v)) !== digits(key)) continue;
      const dist = searchKey(v) === key ? 0 : max ? editDistance(key, searchKey(v)) : Infinity;
      if (dist <= max && (!hit || dist < hit.dist || (dist === hit.dist && n > hit.n))) hit = { v, n, dist };
    }
    if (hit) return { part, suggestion: hit.v };
  }
  return null;
}
const typoHintHTML = (field, row) => {
  const t = typoFor(field, row);
  return t
    ? `<div class="typo-hint" data-typo="${field}">${WARN} Meintest du <button data-act="typo-fix" data-f="${field}" data-v="${escapeHtml(t.suggestion)}" data-p="${escapeHtml(t.part)}">„${escapeHtml(t.suggestion)}“</button>?<button class="typo-x" data-act="typo-ok" data-f="${field}" aria-label="So lassen">✕</button></div>`
    : '';
};
/** Hinweis eines Feldes neu setzen (nach dem Verlassen des Feldes); beim Tippen ausblenden */
function refreshTypoHint(input, show = true) {
  const { row } = rowContext(input);
  const wrap = input.closest('.suggest-wrap');
  const old = wrap.nextElementSibling;
  if (old && old.classList.contains('typo-hint')) old.remove();
  if (show && row) wrap.insertAdjacentHTML('afterend', typoHintHTML(input.dataset.f, row));
}

let suggestInput = null;

/** Art der Arbeit: Teile vor dem letzten Komma (fertig) und der Text dahinter (Suchbegriff) */
function workParts(value) {
  const parts = value.split(',');
  const last = parts.pop().trim();
  return { done: parts.map((p) => p.trim()).filter(Boolean), last };
}
const isKnown = (field, text) => suggestions[field].some((v) => sameKey(v) === sameKey(text));

function suggestionsFor(input) {
  const field = input.dataset.f;
  let q = input.value;
  let used = [];
  if (field === 'work') {
    const { done, last } = workParts(input.value);
    used = done.map(sameKey);
    // Ein vollständiger Eintrag am Ende gilt als ausgewählt, danach wird alles Übrige vorgeschlagen
    if (last && isKnown('work', last)) {
      used.push(sameKey(last));
      q = '';
    } else {
      q = last;
    }
  }
  // Vergleich ohne Apostrophe, Leerzeichen usw.: „bäckerseck“ findet „Bäcker's Eck“
  const match = (query) =>
    suggestions[field].filter((v) => {
      const k = sameKey(v);
      return k !== sameKey(query) && !used.includes(k) && (!searchKey(query) || searchKey(v).includes(searchKey(query)));
    });
  let list = match(q);
  // Art der Arbeit: Passt eigener Text zu keinem Vorschlag, trotzdem alle zum Anhängen zeigen
  if (field === 'work' && q && !list.length) list = match('');
  if (field === 'work') {
    // Was an der Baustelle dieser Zeile schon gemacht wurde, steht vorne (die häufigsten zuerst)
    const siteInput = input.closest('.row')?.querySelector('[data-f="site"]');
    const counts = workBySite.get(sameKey(siteInput ? siteInput.value : ''));
    if (counts) {
      const n = (v) => counts.get(sameKey(v)) || 0;
      list = [...list.filter((v) => n(v)).sort((a, b) => n(b) - n(a)), ...list.filter((v) => !n(v))];
    }
  }
  // Was mit dem getippten Text beginnt, steht vor dem, was ihn nur irgendwo enthält (Reihenfolge sonst wie oben)
  const typed = searchKey(q);
  if (typed) list = [...list.filter((v) => searchKey(v).startsWith(typed)), ...list.filter((v) => !searchKey(v).startsWith(typed))];
  return list;
}

/** Vorschlag aus der Leiste ausblenden (nach langem Drücken) */
function askHideSuggestion(text) {
  const input = suggestInput;
  if (!input) return;
  const field = input.dataset.f;
  confirmDialog(
    'Vorschlag ausblenden?',
    `„${escapeHtml(text)}“ erscheint nicht mehr in der Leiste. Deine Zettel bleiben unverändert. In den Einstellungen kannst du ihn wiederherstellen.`,
    'Ausblenden',
    () => {
      settings.hiddenSuggestions[field].push(text);
      saveSettings();
      suggestions[field] = suggestions[field].filter((v) => sameKey(v) !== sameKey(text));
      toast('Vorschlag ausgeblendet');
    }
  );
}

function showChips(input) {
  suggestInput = input;
  const list = suggestionsFor(input).slice(0, 30);
  // Zwei unabhängige Reihen, jede Kapsel so breit wie ihr Text: der nächste Vorschlag kommt in die
  // kürzere Reihe (geschätzt nach Zeichen), so bleiben beide etwa gleich lang und man sieht mehr Vorschläge
  const rows = [[], []];
  const len = [0, 0];
  for (const v of list) {
    const r = len[0] <= len[1] ? 0 : 1;
    rows[r].push(v);
    len[r] += v.length + 4;
  }
  suggestGrid.innerHTML = rows
    .filter((r) => r.length)
    .map((r) => `<div class="suggest-row">${r.map((v) => `<button class="chip" data-chip="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}</div>`)
    .join('');
  suggestGrid.scrollLeft = 0;
  suggestBar.classList.toggle('show', list.length > 0);
  placeSuggestBar();
}
/** Art der Arbeit: ein Komma am Ende (von der letzten Auswahl) wieder entfernen */
function trimWorkInput(input) {
  if (!input || input.dataset.f !== 'work') return;
  const trimmed = input.value.replace(/[\s,]+$/, '');
  if (trimmed === input.value) return;
  input.value = trimmed;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function hideChips() {
  suggestInput = null;
  suggestBar.classList.remove('show');
}

/** Leiste an die Oberkante der Tastatur setzen; beim Öffnen und Tippen das Feld darüber sichtbar halten */
function placeSuggestBar(keepVisible = true) {
  if (!suggestBar.classList.contains('show')) return;
  const vv = window.visualViewport;
  const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const top = bottom - suggestBar.offsetHeight;
  suggestBar.style.transform = `translate3d(0, ${top}px, 0)`;
  if (keepVisible && suggestInput) {
    const r = suggestInput.getBoundingClientRect();
    if (r.bottom > top - 8) window.scrollBy(0, r.bottom - top + 16);
  }
}
/** Eingabefeld, in dem gerade getippt wird */
const typingField = () => {
  const el = document.activeElement;
  return el && el.matches('input, textarea') ? el : null;
};
/** Tastatur offen: der sichtbare Ausschnitt ist deutlich kleiner als das Fenster */
const keyboardOpen = () => !!window.visualViewport && window.innerHeight - visualViewport.height > 120;
/** Bei offener Tastatur verschiebt iOS den sichtbaren Ausschnitt; die feste Kopfzeile (z. B. die Suche) bleibt oben im Bild.
 *  Nur dann – beim Nachfedern am Seitenende verschiebt iOS den Ausschnitt ebenfalls, da soll die Kopfzeile stehen bleiben. */
function placeNav() {
  const nav = document.querySelector('.nav');
  const y = typingField() && keyboardOpen() ? Math.max(0, visualViewport.offsetTop) : 0;
  if (nav) nav.style.transform = y ? `translate3d(0, ${y}px, 0)` : '';
}
// Nach dem Schließen der Tastatur kommen die letzten Meldungen von iOS teils noch während der Animation:
// Position mehrmals nachprüfen, damit die Kopfzeile nicht verschoben stehen bleibt
document.addEventListener('focusout', () => {
  requestAnimationFrame(placeNav);
  for (const ms of [150, 350, 700, 1200]) setTimeout(placeNav, ms);
});
/** Wie in iOS-Apps: Ziehen am Inhalt schließt die Tastatur (mit Tastatur würden die festen Leisten beim Scrollen zittern).
 *  Langsames Ziehen meldet iOS teils kaum über touchmove – daher zählt auch jedes Scrollen, solange der Finger aufliegt. */
let scrollTouch = null; // { y, target }
function dismissKeyboardOnScroll() {
  const el = typingField();
  if (!scrollTouch || drag || !el) return;
  if (scrollTouch.target === el || scrollTouch.target.closest?.('#suggest-bar')) return;
  scrollTouch = null;
  el.blur();
}
document.addEventListener(
  'touchstart',
  (e) => {
    scrollTouch = e.touches.length === 1 ? { y: e.touches[0].clientY, target: e.target } : null;
    // In der Suche schließt schon das Berühren der Ergebnisliste die Tastatur (vor dem Scrollen, das iOS
    // auf Listeneinträgen bei langsamem Start nicht zuverlässig meldet)
    const el = typingField();
    if (el && el.matches('[data-search]') && !e.target.closest('.nav')) el.blur();
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    if (scrollTouch && Math.abs(e.touches[0].clientY - scrollTouch.y) > 6) dismissKeyboardOnScroll();
  },
  { passive: true }
);
// Nur touchend beendet die Geste: Bei langsamem Start auf einem Listeneintrag (Link) bricht iOS die Berührung
// mit touchcancel ab, scrollt aber weiter, solange der Finger aufliegt
document.addEventListener('touchend', () => (scrollTouch = null), { passive: true });
// Wechsel ins nächste Feld (Pfeile über der Tastatur) scrollt ebenfalls – das soll die Tastatur nicht schließen
document.addEventListener('focusin', () => (scrollTouch = null));
window.addEventListener('scroll', dismissKeyboardOnScroll, { passive: true });
if (window.visualViewport) visualViewport.addEventListener('scroll', dismissKeyboardOnScroll);

/** Beginnt die Berührung im Feld, in dem gerade geschrieben wird (z. B. lange drücken für den Cursor),
 *  scrollt die Seite nicht: Ziehen wird unterbunden und ein trotzdem ausgelöstes Scrollen zurückgesetzt. */
let fieldTouch = null; // { y: Scrollstand beim Berühren }
document.addEventListener(
  'touchstart',
  (e) => {
    const el = typingField();
    fieldTouch = el && e.touches.length === 1 && e.target === el && keyboardOpen() ? { y: window.scrollY } : null;
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    if (fieldTouch && e.cancelable) e.preventDefault();
  },
  { passive: false }
);
window.addEventListener(
  'scroll',
  () => {
    if (fieldTouch && window.scrollY !== fieldTouch.y) window.scrollTo(0, fieldTouch.y);
  },
  { passive: true }
);
document.addEventListener('touchend', () => (fieldTouch = null), { passive: true });
document.addEventListener('focusout', () => (fieldTouch = null));

/** Antippen eines Textfelds: iOS scrollt die Seite sonst beim Fokussieren, auch wenn das Feld über der Tastatur
 *  sichtbar bliebe. Darum selbst fokussieren, ohne zu scrollen, und den Cursor an die angetippte Stelle setzen
 *  (den Klick danach unterdrücken, sonst scrollt iOS doch). Verdeckt die Tastatur oder die
 *  Vorschlagsleiste das Feld, schiebt es `revealField` bzw. `placeSuggestBar` nur so weit wie nötig nach oben. */
const TAP_FIELDS = 'textarea, input:not([type]), input[type="text"]';
let tapStart = null; // { x, y }
document.addEventListener(
  'touchstart',
  (e) => (tapStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null),
  { passive: true }
);
document.addEventListener(
  'touchend',
  (e) => {
    const el = e.target.closest?.(TAP_FIELDS);
    const t = e.changedTouches[0];
    if (!el || el === document.activeElement || el.disabled || el.readOnly || !tapStart) return;
    if (Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > 10) return;
    const pos = caretAt(el, t.clientX, t.clientY);
    // Ohne den folgenden Klick, der iOS sonst doch noch scrollen lässt
    if (e.cancelable) e.preventDefault();
    el.focus({ preventScroll: true });
    el.setSelectionRange(pos, pos);
  },
  { passive: false }
);
/** Textstelle unter einem Punkt im Feld: Text in einer unsichtbaren Kopie mit gleicher Schrift und Breite nachmessen.
 *  Wie bei iOS landet der Cursor am Wortende bzw. -anfang, nicht mitten im Wort. */
function caretAt(el, x, y) {
  const text = el.value;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const m = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing', 'textIndent', 'lineHeight', 'textAlign', 'boxSizing'])
    m.style[p] = cs[p];
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    m.style[`padding${side}`] = cs[`padding${side}`];
    m.style[`border${side}Width`] = cs[`border${side}Width`];
  }
  // Unsichtbar (durchsichtige Schrift), aber kurz oben auf, damit die Abfrage die Kopie trifft
  Object.assign(m.style, {
    position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    whiteSpace: el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre', overflowWrap: 'break-word', overflow: 'hidden',
    color: 'transparent', background: 'none', borderStyle: 'solid', borderColor: 'transparent', zIndex: '2147483647',
    webkitUserSelect: 'text', userSelect: 'text',
  });
  m.textContent = text;
  document.body.appendChild(m);
  const hit = document.caretRangeFromPoint?.(x, y);
  const pos = hit && hit.startContainer === m.firstChild ? hit.startOffset : text.length;
  m.remove();
  // Wie iOS: im Wort an dessen Anfang oder Ende, je nachdem, was näher liegt
  const before = text.slice(0, pos).search(/\S*$/);
  const after = pos + text.slice(pos).search(/\s|$/);
  return pos - before <= after - pos ? before : after;
}
/** Feld, in dem geschrieben wird, über der Tastatur halten (mit Vorschlägen übernimmt das `placeSuggestBar`) */
function revealField() {
  const el = typingField();
  if (!el || !keyboardOpen() || suggestBar.classList.contains('show') || el.closest('.nav, #modal-layer')) return;
  const bottom = visualViewport.offsetTop + visualViewport.height;
  const r = el.getBoundingClientRect();
  if (r.bottom > bottom - 8) window.scrollBy(0, r.bottom - bottom + 16);
}

if (window.visualViewport) {
  // Beim Scrollen nur mitziehen, sofort und ohne die Seite zu verschieben (sonst zittert die Leiste)
  visualViewport.addEventListener('resize', () => {
    placeSuggestBar();
    revealField();
    placeNav();
  });
  visualViewport.addEventListener('scroll', () => {
    placeSuggestBar(false);
    placeNav();
  });
}

/** Vorschlag übernehmen: Baustelle ersetzt und schließt, Art der Arbeit hängt mit Komma an */
function pickChip(text) {
  const input = suggestInput;
  if (!input) return;
  if (input.dataset.f === 'work') {
    const { done, last } = workParts(input.value);
    // Angefangener Text wird durch den Vorschlag ersetzt, ein fertiger Eintrag bleibt stehen
    if (last && isKnown('work', last)) done.push(last);
    else if (last && !searchKey(text).includes(searchKey(last))) done.push(last);
    done.push(text);
    // Passt der Vorschlag nicht mehr in die Zeile (Zeichengrenze), wird er nicht angehängt
    if (done.join(', ').length > MAX_LEN.work) return toast('Kein Platz mehr in dieser Zeile');
    // Komma und Leerzeichen gleich mitsetzen, damit direkt weitergeschrieben werden kann
    input.value = `${done.join(', ')}, `.slice(0, MAX_LEN.work);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hideChips();
    input.blur();
  }
}

// Antippen ohne Fokusverlust: Auswahl beim Loslassen, Wischen zum Blättern bleibt möglich
// Lange drücken (600 ms) blendet den Vorschlag aus
let chipTouch = null;
suggestBar.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  const chip = e.target.closest('[data-chip]');
  const touch = { x: t.clientX, y: t.clientY, chip, long: false };
  if (chip) {
    touch.timer = setTimeout(() => {
      touch.long = true;
      askHideSuggestion(chip.dataset.chip);
    }, 600);
  }
  chipTouch = touch;
}, { passive: true });
suggestBar.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (chipTouch && (Math.abs(t.clientX - chipTouch.x) > 10 || Math.abs(t.clientY - chipTouch.y) > 10)) clearTimeout(chipTouch.timer);
}, { passive: true });
suggestBar.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  const start = chipTouch;
  chipTouch = null;
  e.preventDefault(); // kein Klick danach, das Eingabefeld behält den Fokus
  if (start) clearTimeout(start.timer);
  if (start && start.chip && !start.long && Math.abs(t.clientX - start.x) < 10 && Math.abs(t.clientY - start.y) < 10) {
    pickChip(start.chip.dataset.chip);
  }
}, { passive: false });
suggestBar.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const chip = e.target.closest('[data-chip]');
  if (chip && !('ontouchstart' in window)) askHideSuggestion(chip.dataset.chip);
});
suggestBar.addEventListener('mousedown', (e) => e.preventDefault());
suggestBar.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (chip) pickChip(chip.dataset.chip);
});

// ───────────────────────── Ereignisse ─────────────────────────

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || layer.contains(el)) return;
  const act = el.dataset.act;
  switch (act) {
    case 'settings':
      location.hash = '#/einstellungen';
      break;
    case 'new':
      weekPicker(new Date(), null, (anchor) => {
        location.hash = `#/zettel/${encodeURIComponent(openOrCreate(anchor))}`;
      });
      break;
    case 'gap': {
      // Fehlende Woche: einlesen oder neu erstellen (dann immer erst die Wochenauswahl, bei der ersten fehlenden Woche)
      const date = parseDate(el.dataset.date);
      actionSheet([
        { label: 'Stundenzettel einlesen …', run: pickImportFile },
        {
          label: 'Neuen Stundenzettel erstellen',
          run: () => weekPicker(date, null, (anchor) => (location.hash = `#/zettel/${encodeURIComponent(openOrCreate(anchor))}`)),
        },
      ]);
      break;
    }
    case 'delete':
      clearTimeout(swipeTimer); // offen lassen, solange die Rückfrage angezeigt wird
      askDelete(el.dataset.id, false, closeSwipe);
      break;
    case 'back':
      goBack();
      break;
    case 'week':
      changeWeek();
      break;
    case 'more':
      moreMenu();
      break;
    case 'share':
      // direkt im Antippen ausführen: Teilen-Menü und Zwischenablage gehen in Safari sonst nicht
      sendWithCheck(currentSheet());
      break;
    case 'time':
      editTime(el);
      break;
    case 'pause':
      editPause(el);
      break;
    case 'status':
      chooseStatus(el);
      break;
    case 'addrow': {
      const { s, dayIndex, day } = rowContext(el);
      // Neue Zeile beginnt dort, wo die vorherige geendet hat
      const row = emptyRow();
      const prev = day.rows.at(-1);
      if (prev && prev.end != null) row.start = prev.end;
      day.rows.push(row);
      saveSheets(s);
      refreshDay(dayIndex);
      break;
    }
    case 'typo-fix': {
      // Vorgeschlagene Schreibweise übernehmen (bei Art der Arbeit nur den betroffenen Teil)
      const input = el.closest('.row').querySelector(`[data-f="${el.dataset.f}"]`);
      input.value =
        el.dataset.f === 'work'
          ? input.value
              .split(',')
              .map((p) => (p.trim() === el.dataset.p ? el.dataset.v : p.trim()))
              .filter(Boolean)
              .join(', ')
          : el.dataset.v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      break;
    }
    case 'typo-ok': {
      // „So lassen“: Hinweis für genau diesen Text nicht mehr zeigen
      const { s, row } = rowContext(el);
      row.typoOk = { ...row.typoOk, [el.dataset.f]: row[el.dataset.f] };
      saveSheets(s);
      el.closest('.typo-hint').remove();
      break;
    }
    case 'pdf-preview':
      openPdfPreview();
      break;
    case 'delrow': {
      const { s, dayIndex, day, rowIndex, row } = rowContext(el);
      const remove = () => {
        day.rows.splice(rowIndex, 1);
        saveSheets(s);
        refreshDay(dayIndex);
      };
      if (rowIsEmpty(row)) remove();
      else confirmDialog('Zeile löschen?', 'Die Einträge dieser Zeile gehen verloren.', 'Löschen', remove, true);
      break;
    }
    case 'backup-export':
      exportBackup();
      break;
    case 'payslip-delete': {
      const key = el.dataset.key;
      const p = payslips[key];
      if (!p) break;
      confirmDialog(`Lohnabrechnung ${MONTHS[p.month - 1]} ${p.year} löschen?`, 'Die eingelesenen Werte gehen verloren.', 'Löschen', () => {
        delete payslips[key];
        savePayslips();
        location.replace('#/uebersicht');
      }, true);
      break;
    }
    case 'open-trip': {
      e.preventDefault(); // nicht den Stundenzettel öffnen (Knopf liegt in dessen Zeile)
      const s = findSheet(el.dataset.id);
      const list = s ? tripsForSheet(s).filter((t) => t.dates.length) : [];
      if (list.length === 1) location.hash = `#/reise/${list[0].id}`;
      else if (list.length) actionSheet(list.map((t) => ({ label: escapeHtml(tripTitle(t)), run: () => (location.hash = `#/reise/${t.id}`) })));
      break;
    }
    case 'unhide': {
      const list = settings.hiddenSuggestions[el.dataset.field];
      settings.hiddenSuggestions[el.dataset.field] = list.filter((v) => v !== el.dataset.value);
      saveSettings();
      renderSettings();
      toast('Vorschlag wiederhergestellt');
      break;
    }
    case 'trip-new':
      newTripFromList();
      break;
    case 'trip-delete': {
      const t = findTrip(el.dataset.id);
      clearTimeout(swipeTimer);
      if (t) askDeleteTrip(t, false, closeSwipe);
      break;
    }
    case 'trip-toggle':
      toggleTripDay(el.dataset.date);
      break;
    case 'trip-range':
      shiftTripRange(Number(el.dataset.dir));
      break;
    case 'trip-time':
      editTripTime(el);
      break;
    case 'trip-more':
      tripMoreMenu();
      break;
    case 'trip-share':
      // direkt im Antippen ausführen: Teilen-Menü und Zwischenablage gehen in Safari sonst nicht
      sendTripWithCheck(currentTrip());
      break;
    case 'sign':
      signaturePad();
      break;
    case 'sign-clear':
      confirmDialog('Unterschrift löschen?', 'Neue Abrechnungen haben dann keine Unterschrift.', 'Löschen', () => {
        settings.signature = null;
        saveSettings();
        renderSettings();
      }, true);
      break;
    case 'search':
      searchQuery = '';
      renderList();
      window.scrollTo(0, 0);
      document.querySelector('[data-search]').focus();
      break;
    case 'search-close':
      searchQuery = null;
      renderList();
      window.scrollTo(0, 0);
      break;
    case 'to-top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'jump':
      jumpToDay(Number(el.dataset.day));
      break;
    case 'expand': {
      const { s, dayIndex } = rowContext(el);
      expandedDays.add(`${s.id}:${dayIndex}`);
      refreshDay(dayIndex);
      break;
    }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.ps && t.dataset.ps !== 'month' && t.dataset.ps !== 'year') {
    updatePayslipField(t);
    return;
  }
  if (t.dataset.f) {
    const s = currentSheet();
    if (!s) return;
    // Ein Eintrag bleibt eine Zeile Text (eingefügte Zeilenumbrüche werden zu Leerzeichen); das Feld wächst mit
    if (/\n/.test(t.value)) t.value = t.value.replace(/\s*\n\s*/g, ' ');
    if (t.matches('textarea')) fitTextarea(t);
    const { row } = rowContext(t);
    if (row) {
      row[t.dataset.f] = t.value;
      const { day } = rowContext(t);
      updateDayWarnings(t.closest('.day'), day);
      // Tippfehler-Hinweis erst nach dem Verlassen des Feldes (nicht während des Tippens)
      if (document.activeElement === t) refreshTypoHint(t, false);
      else refreshTypoHint(t);
    }
    showChips(t);
    saveSheets(s);
  } else if (t.dataset.t) {
    const trip = currentTrip();
    const iso = t.closest('[data-date]').dataset.date;
    if (t.dataset.t === 'places' || t.dataset.t === 'works') {
      // Jeder Kasten im PDF ist eine Textzeile (höchstens zweizeilig umbrochen): keine Zeilenumbrüche
      if (/\n/.test(t.value)) t.value = t.value.replace(/\s*\n\s*/g, ' ');
      // Beide Felder speichern, damit eine alte gemeinsame Fassung („text“) nicht mehr gilt
      const dayEl = t.closest('.trip-day');
      const o = { ...(trip.over[iso] || {}) };
      delete o.text;
      o.places = dayEl.querySelector('[data-t="places"]').value;
      o.works = dayEl.querySelector('[data-t="works"]').value;
      trip.over[iso] = o;
      saveTrips(trip);
      fitTextarea(t);
    } else {
      const v = parseFloat(t.value.replace(',', '.'));
      setTripOver(trip, iso, 'meal', Number.isNaN(v) ? 0 : Math.max(0, v));
      document.getElementById('trip-total').textContent = fmtEuro(tripTotal(tripRows(trip)));
    }
  } else if (t.dataset.tp) {
    const trip = currentTrip();
    trip[t.dataset.tp] = t.value;
    saveTrips(trip);
  } else if (t.dataset.search != null) {
    searchQuery = t.value;
    refreshListBody();
  } else if (t.dataset.s) {
    settings[t.dataset.s] = t.type === 'checkbox' ? t.checked : t.value;
    saveSettings();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.dataset.actChange === 'backup-import') importBackup(e.target);
  else if (e.target.dataset.actChange === 'payslip-import') importPayslip(e.target);
  else if (e.target.dataset.ps === 'month' || e.target.dataset.ps === 'year') updatePayslipField(e.target);
  else if (e.target.dataset.s === 'name') renameAll(e.target.value);
});

/** Neuer Name aus den Einstellungen gilt für alle gespeicherten Zettel und Abrechnungen (beim Verlassen des Feldes) */
function renameAll(value) {
  const name = value.trim();
  if (!name) return;
  const now = Date.now();
  let n = 0;
  for (const s of sheets) {
    if (s.name === name) continue;
    s.name = name;
    s.updatedAt = now;
    n++;
  }
  let t = 0;
  for (const trip of trips) {
    if (trip.name === name) continue;
    trip.name = name;
    trip.updatedAt = now;
    t++;
  }
  if (n) saveSheets();
  if (t) saveTrips();
  if (n || t) toast(`Name in ${n} Stundenzettel${n === 1 ? '' : 'n'}${t ? ` und ${t} Abrechnung${t === 1 ? '' : 'en'}` : ''} geändert`);
}

document.addEventListener('focusin', (e) => {
  if (e.target.matches('.txt')) showChips(e.target);
});
document.addEventListener('focusout', (e) => {
  if (!e.target.matches('.txt')) return;
  trimWorkInput(e.target);
  if (suggestInput === e.target) hideChips();
  if (e.target.dataset.f && currentSheet()) refreshTypoHint(e.target);
});
document.addEventListener('keydown', (e) => {
  // Reisekosten: Return schließt die Tastatur (kein Zeilenumbruch im Kasten)
  if (e.key === 'Enter' && e.target.matches('textarea.trip-text')) {
    e.target.blur();
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox]), textarea.txt')) {
    // „Weiter“ springt zum nächsten Feld der Zeile
    if (e.target.dataset.f === 'site') {
      const work = e.target.closest('.row').querySelector('[data-f="work"]');
      work.focus();
      // Mehrzeilige Felder setzen den Cursor sonst an den Anfang
      work.setSelectionRange(work.value.length, work.value.length);
    } else e.target.blur();
    e.preventDefault();
  }
});

// ───────────────────────── Wischen zum Löschen ─────────────────────────
// Eintrag in der Liste nach links ziehen: erst bei deutlich waagerechter Bewegung, „Löschen“ bleibt erst ab 70 px stehen.
// Die Option schließt nach 3 Sekunden, beim Berühren einer anderen Stelle und nach „Abbrechen“ in der Rückfrage.

const SWIPE_W = 92;
const SWIPE_OPEN = 70;
let swipeOpen = null;
let swipeTimer = 0;
let swipeDrag = null;
let swipeDraggedAt = 0;

function closeSwipe() {
  clearTimeout(swipeTimer);
  if (swipeOpen) swipeOpen.querySelector('.swipe-track').style.transform = '';
  swipeOpen = null;
}
function openSwipe(el) {
  if (swipeOpen && swipeOpen !== el) closeSwipe();
  swipeOpen = el;
  el.querySelector('.swipe-track').style.transform = `translateX(${-SWIPE_W}px)`;
  clearTimeout(swipeTimer);
  swipeTimer = setTimeout(closeSwipe, 3000);
}
document.addEventListener(
  'touchstart',
  (e) => {
    const el = e.target.closest('.swipe');
    if (swipeOpen && el !== swipeOpen) closeSwipe();
    swipeDrag =
      el && e.touches.length === 1 && !e.target.closest('.swipe-del')
        ? { el, x: e.touches[0].clientX, y: e.touches[0].clientY, base: el === swipeOpen ? -SWIPE_W : 0, active: false, dead: false, pos: 0 }
        : null;
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    const d = swipeDrag;
    if (!d || d.dead) return;
    const dx = e.touches[0].clientX - d.x;
    const dy = e.touches[0].clientY - d.y;
    if (!d.active) {
      // Senkrecht: normales Scrollen, die Zeile bleibt stehen
      if (Math.abs(dy) > 8 && Math.abs(dy) * 1.2 >= Math.abs(dx)) {
        d.dead = true;
        return;
      }
      if (Math.abs(dx) < 18 || Math.abs(dx) < Math.abs(dy) * 2) return;
      d.active = true;
      d.x = e.touches[0].clientX; // ab hier folgt die Zeile dem Finger, ohne Sprung
      clearTimeout(swipeTimer);
      d.track = d.el.querySelector('.swipe-track');
      d.track.classList.add('dragging');
      return;
    }
    d.pos = Math.max(-SWIPE_W - 24, Math.min(0, d.base + dx));
    d.track.style.transform = `translateX(${d.pos}px)`;
  },
  { passive: true }
);
const endSwipe = () => {
  const d = swipeDrag;
  swipeDrag = null;
  if (!d || !d.active) return;
  swipeDraggedAt = Date.now();
  d.track.classList.remove('dragging');
  if (d.pos <= -SWIPE_OPEN) openSwipe(d.el);
  else {
    if (swipeOpen === d.el) swipeOpen = null;
    clearTimeout(swipeTimer);
    d.track.style.transform = '';
  }
};
document.addEventListener('touchend', endSwipe, { passive: true });
document.addEventListener('touchcancel', endSwipe, { passive: true });
// Nach dem Ziehen nicht den Zettel öffnen; bei offener Option schließt ein Tipp auf den Eintrag sie nur
document.addEventListener(
  'click',
  (e) => {
    const sw = e.target.closest('.swipe');
    if (!sw || e.target.closest('.swipe-del')) return;
    if (Date.now() - swipeDraggedAt < 400 || sw === swipeOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeSwipe();
    }
  },
  true
);

// ───────────────────────── Zeilen verschieben ─────────────────────────
// Lange auf eine Zeile drücken (nicht in ein Textfeld), dann nach oben oder unten ziehen.

let press = null; // { rowEl, timer, x, y }
let drag = null; // { rowEl, dayEl, grab, moved }

function startDrag() {
  const { rowEl } = press;
  const dayEl = rowEl.closest('.day');
  if (!dayEl || dayEl.querySelectorAll('.row').length < 2) return;
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  drag = { rowEl, dayEl, grab: press.y - rowEl.getBoundingClientRect().top };
  rowEl.classList.add('dragging');
  dayEl.classList.add('reordering');
}

function moveDrag(y) {
  const { rowEl, grab } = drag;
  const prev = rowEl.previousElementSibling;
  const next = rowEl.nextElementSibling;
  if (prev && prev.classList.contains('row')) {
    const r = prev.getBoundingClientRect();
    if (y - grab < r.top + r.height / 2) prev.before(rowEl);
  }
  if (next && next.classList.contains('row')) {
    const r = next.getBoundingClientRect();
    if (y - grab + rowEl.offsetHeight > r.top + r.height / 2) next.after(rowEl);
  }
  rowEl.style.transform = '';
  const natural = rowEl.getBoundingClientRect().top;
  rowEl.style.transform = `translateY(${y - grab - natural}px)`;
}

function endDrag() {
  const { rowEl, dayEl } = drag;
  drag = null;
  rowEl.classList.remove('dragging');
  rowEl.style.transform = '';
  dayEl.classList.remove('reordering');
  const s = currentSheet();
  const i = Number(dayEl.dataset.day);
  const day = s.days[i];
  const order = [...dayEl.querySelectorAll('.row')].map((el) => el.dataset.row);
  const before = day.rows.map((r) => r.id).join();
  day.rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  if (day.rows.map((r) => r.id).join() !== before) saveSheets(s);
  refreshDay(i);
}

document.addEventListener(
  'touchstart',
  (e) => {
    const rowEl = e.target.closest('.day .row');
    if (!rowEl || e.touches.length > 1 || e.target.closest('input')) return;
    const t = e.touches[0];
    press = { rowEl, x: t.clientX, y: t.clientY, timer: setTimeout(startDrag, 450) };
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    const t = e.touches[0];
    if (drag) {
      e.preventDefault(); // Seite scrollt beim Ziehen nicht mit
      moveDrag(t.clientY);
    } else if (press && (Math.abs(t.clientX - press.x) > 8 || Math.abs(t.clientY - press.y) > 8)) {
      clearTimeout(press.timer);
      press = null;
    }
  },
  { passive: false }
);
const endPress = (e) => {
  if (press) clearTimeout(press.timer);
  press = null;
  if (drag) {
    e.preventDefault(); // kein Klick auf Uhrzeit oder Löschen nach dem Loslassen
    endDrag();
  }
};
document.addEventListener('touchend', endPress, { passive: false });
document.addEventListener('touchcancel', endPress, { passive: false });
// Kein Kontextmenü beim langen Drücken auf eine Zeile
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.day .row') && !e.target.closest('input')) e.preventDefault();
});

// ───────────────────────── Start ─────────────────────────

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
history.replaceState('root', '', location.hash || '#/');
route();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

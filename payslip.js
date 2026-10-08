// Lohnabrechnung einlesen: Foto → Texterkennung (Tesseract.js, läuft auf dem iPhone; Programm und Sprachdaten
// werden beim ersten Mal aus dem Netz geladen) → Werte aus dem Text (DATEV-Abrechnung „Brutto/Netto-Bezüge“).
// Das Foto selbst wird nicht gespeichert, nur die erkannten Zahlen.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const PAYSLIP_MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];

let tesseractLoad = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  tesseractLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = resolve;
    s.onerror = () => {
      tesseractLoad = null;
      reject(new Error('Texterkennung konnte nicht geladen werden (Internet?)'));
    };
    document.head.append(s);
  });
  return tesseractLoad;
}

/** Foto verkleinern (lange Seite höchstens 2400 px) und in Graustufen – schneller und genauer */
async function payslipCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const f = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * f);
  c.height = Math.round(bmp.height * f);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.15)';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c;
}

/** Text einer Lohnabrechnung erkennen; onProgress(0…1) */
async function recognizePayslip(file, onProgress = () => {}) {
  await loadTesseract();
  const canvas = await payslipCanvas(file);
  const worker = await Tesseract.createWorker('deu', 1, {
    logger: (m) => m.status === 'recognizing text' && onProgress(m.progress),
  });
  try {
    // Seite als ein Textblock lesen: so bleiben die Zeilen der Lohnarten zusammen
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    worker.terminate();
  }
}

/** „1.234,50“ / „500 ,00“ → 1234.5 */
const payslipNum = (s) => parseFloat(String(s).replace(/\s+/g, '').replace(/\./g, '').replace(',', '.'));
/** Letzter Euro-Betrag einer Zeile („2.345,60“, auch „500 ,00-“) */
function lastMoney(line) {
  const all = [...String(line || '').matchAll(/(\d{1,3}(?:\.\d{3})*\s?,\s?\d{2})(?!\d)/g)];
  return all.length ? payslipNum(all.at(-1)[1]) : null;
}
/** Betrag aus der Zeile mit dem Stichwort oder – steht die Zahl darunter – aus den folgenden Zeilen */
function moneyAfter(lines, re, ahead = 2) {
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return null;
  for (let k = i; k <= Math.min(lines.length - 1, i + ahead); k++) {
    const v = lastMoney(k === i ? lines[k].slice(lines[k].search(re)) : lines[k]);
    if (v != null) return v;
  }
  return null;
}

/**
 * Werte aus dem erkannten Text.
 * hours: Stunden je Art (arbeit, ueber, urlaub, feiertag, krank, sonst), pay: Beträge der Lohnarten,
 * rate: Stundenlohn, zulage: Zulagen ohne Stunden, brutto/steuer/sv/netto (Netto-Verdienst), abschlag (bereits
 * erhalten), bav (Betriebsrente, Netto-Abzug), auszahlung. Fehlendes bleibt null.
 */
function parsePayslipText(text) {
  const lines = String(text).split('\n').map((l) => l.replace(/[|]/g, ' ').trim()).filter(Boolean);
  const r = {
    year: null,
    month: null,
    rate: null,
    hours: { arbeit: 0, ueber: 0, urlaub: 0, feiertag: 0, krank: 0, sonst: 0 },
    pay: { arbeit: 0, ueber: 0, urlaub: 0, feiertag: 0, krank: 0, sonst: 0 },
    zulage: 0,
    brutto: null,
    steuer: null,
    sv: null,
    netto: null,
    abschlag: 0,
    bav: 0,
    auszahlung: null,
  };
  // „für August 2026“ (die Texterkennung liest das Jahr teils als „_2 026“)
  const mm = String(text).match(/f[üu]r\s+([A-Za-zÄäÖöÜü]+)[\s_.]*((?:\d[\s_]?){4})/);
  if (mm) {
    const name = mm[1].toLowerCase().replace('marz', 'märz');
    const i = PAYSLIP_MONTHS.indexOf(name);
    const year = Number(mm[2].replace(/\D/g, ''));
    if (i >= 0 && year > 2000) {
      r.month = i + 1;
      r.year = year;
    }
  }
  // Sonst: Druckdatum oben rechts („03.02.2026 Blatt 1“) – die Abrechnung gilt für den Vormonat
  if (!r.month) {
    const dm = String(text).match(/(\d{2})\.(\d{2})\.(20\d\d)\s+Blatt/);
    if (dm) {
      const d = new Date(Number(dm[3]), Number(dm[2]) - 2, 1);
      r.month = d.getMonth() + 1;
      r.year = d.getFullYear();
    }
  }
  for (const line of lines) {
    // Lohnart mit Stunden: „101 Stundenlohn  Std 160,00  12,50  …  2.000,00“
    const h = line.match(/(\d{3})\s+(.+?)\s+Std\.?\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3},\d{2})/);
    if (h) {
      const label = h[2].toLowerCase();
      const kind = /berst/.test(label)
        ? 'ueber'
        : /urlaub/.test(label)
          ? 'urlaub'
          : /feiertag/.test(label)
            ? 'feiertag'
            : /krank|lohnfortz|efz/.test(label)
              ? 'krank'
              : /stundenlohn|zeitlohn|grundlohn/.test(label)
                ? 'arbeit'
                : 'sonst';
      r.hours[kind] += payslipNum(h[3]);
      const amount = lastMoney(line.slice(h.index + h[0].length));
      if (amount != null) r.pay[kind] += amount;
      if (kind === 'arbeit' || r.rate == null) r.rate = payslipNum(h[4]);
      continue;
    }
    // Zulagen ohne Stunden („204 Leistungszulage brutto … 100,00“); Betriebsrente (bAV, Betr.AV) zählt nicht
    const z = line.match(/^\D{0,3}(\d{3})\s+([A-Za-zÄÖÜäöüß.+%\- ]+?)\s{2,}/);
    if (z && !/bav|betr\.?\s?av|altersv/i.test(z[2]) && /zulage|prämie|praemie|zuschlag|pauschale/i.test(z[2])) {
      const v = lastMoney(line);
      if (v != null && !/\d,\d{2}-\s*$/.test(line)) r.zulage += v;
    }
  }
  r.brutto = moneyAfter(lines, /^\s*Gesamt-Brut/);
  r.steuer = moneyAfter(lines, /Steuerrechtliche Abz/);
  r.sv = moneyAfter(lines, /SV-rechtliche Abz/);
  r.netto = moneyAfter(lines, /Netto-Verdienst/);
  r.abschlag = moneyAfter(lines, /bereits erhalten/, 0) || 0;
  r.bav = moneyAfter(lines, /Altersvorsorge|betr\.\s?AV/i, 0) || 0;
  r.auszahlung = moneyAfter(lines, /Auszahlungsbetrag/);
  const r2 = (v) => Math.round(v * 100) / 100;
  // Gesamt-Brutto nicht erkannt: Summe der Lohnarten
  if (r.brutto == null) {
    const sum = Object.values(r.pay).reduce((x, y) => x + y, 0) + r.zulage;
    if (sum > 0) r.brutto = r2(sum);
  }
  // Steuern oder Sozialabgaben nicht erkannt: aus Brutto − Netto − der anderen Summe
  if (r.sv == null && r.brutto != null && r.netto != null && r.steuer != null) r.sv = r2(r.brutto - r.netto - r.steuer);
  if (r.steuer == null && r.brutto != null && r.netto != null && r.sv != null) r.steuer = r2(r.brutto - r.netto - r.sv);
  // Auszahlung nicht erkannt: aus Netto, Abschlag und Betriebsrente
  if (r.auszahlung == null && r.netto != null) r.auszahlung = Math.round((r.netto - r.abschlag - r.bav) * 100) / 100;
  return r;
}

/** Plausibilität: Lohnarten ergeben das Gesamt-Brutto, Netto − Abzüge ergibt die Auszahlung */
function payslipChecks(p) {
  const sumPay = Object.values(p.pay).reduce((a, b) => a + b, 0) + (p.zulage || 0);
  const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.02;
  return {
    brutto: near(Math.round(sumPay * 100) / 100, p.brutto),
    netto: near(p.brutto - (p.steuer || 0) - (p.sv || 0), p.netto),
    auszahlung: near(p.netto - (p.abschlag || 0) - (p.bav || 0), p.auszahlung),
  };
}

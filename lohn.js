// Netto-Schätzung für einen Monat: Lohnsteuer nach dem Einkommensteuertarif 2026 (Programmablaufplan, vereinfacht)
// und Sozialabgaben Arbeitnehmeranteil. Ergebnis ist eine Schätzung, keine Lohnabrechnung.
// Geprüft an einer echten Abrechnung (Steuerklasse I, kinderlos, ohne Kirchensteuer): Lohnsteuer und
// Sozialabgaben stimmen auf den Cent.

const LOHN_2026 = {
  bbgKv: 5812.5, // Beitragsbemessungsgrenze Kranken-/Pflegeversicherung je Monat
  bbgRv: 8450, // Renten-/Arbeitslosenversicherung je Monat
  kv: 7.3, // allgemeiner Beitragssatz, Arbeitnehmeranteil (%)
  kvVsp: 7.0, // ermäßigter Satz für die Vorsorgepauschale (%)
  rv: 9.3,
  av: 1.3,
  pv: 1.8,
  pvKinderlos: 0.6, // Zuschlag für Kinderlose ab 23
  pvAbschlag: 0.25, // je Kind ab dem 2. (bis zum 5.), Kinder unter 25
  bavSteuerfrei: 676, // 8 % der BBG RV je Monat (Entgeltumwandlung steuerfrei)
  bavSvFrei: 338, // 4 % der BBG RV je Monat (sozialversicherungsfrei)
  werbungskosten: 1230,
  sonderausgaben: 36,
  entlastung: 4260, // Steuerklasse II, erstes Kind
  entlastungWeitere: 240,
  soliFreigrenze: 20350,
  kirche: 9, // Niedersachsen (%)
  // Steuerklasse V/VI
  w1: 14071,
  w2: 34939,
  w3: 222260,
};

/** Einkommensteuer nach Grundtarif 2026 (ganze Euro) */
function tarif2026(zve) {
  const x = Math.floor(zve);
  if (x <= 12348) return 0;
  if (x <= 17799) {
    const y = (x - 12348) / 10000;
    return Math.floor((914.51 * y + 1400) * y);
  }
  if (x <= 69878) {
    const z = (x - 17799) / 10000;
    return Math.floor((173.1 * z + 2397) * z + 1034.87);
  }
  if (x <= 277825) return Math.floor(0.42 * x - 11135.63);
  return Math.floor(0.45 * x - 19470.38);
}

/** Steuerklasse V und VI: eigene Formel ohne Grundfreibetrag (PAP „MST5-6“) */
function tarif56(zzx) {
  const c = LOHN_2026;
  const up = (zx) => {
    const diff = (tarif2026(zx * 1.25) - tarif2026(zx * 0.75)) * 2;
    return Math.max(diff, Math.floor(zx * 0.14));
  };
  if (zzx > c.w2) {
    let st = up(c.w2);
    st += zzx > c.w3 ? (c.w3 - c.w2) * 0.42 + (zzx - c.w3) * 0.45 : (zzx - c.w2) * 0.42;
    return Math.floor(st);
  }
  const vergl = up(zzx);
  if (zzx <= c.w1) return vergl;
  return Math.floor(Math.min(vergl, up(c.w1) + (zzx - c.w1) * 0.42));
}

/**
 * Netto für einen Monat.
 * brutto: steuer- und beitragspflichtiger Bruttolohn (Grundlohn, Überstunden, Zulagen)
 * opts: { klasse 1–6, kirche, kinder, zusatz (KV-Zusatzbeitrag %), bav (Entgeltumwandlung € je Monat) }
 * Ergebnis: { brutto, lohnsteuer, soli, kirchensteuer, kv, rv, av, pv, bav, netto }
 */
function nettoMonat(brutto, opts) {
  const c = LOHN_2026;
  const klasse = Number(opts.klasse) || 1;
  const kinder = Math.max(0, Math.floor(Number(opts.kinder) || 0));
  const zusatz = Number(opts.zusatz) || 0;
  const bav = Math.max(0, Number(opts.bav) || 0);
  const r2 = (v) => Math.round(v * 100) / 100;

  // Entgeltumwandlung (Betriebsrente) mindert das steuer- und beitragspflichtige Brutto bis zu den Grenzen
  const steuerBrutto = brutto - Math.min(bav, c.bavSteuerfrei);
  const svBrutto = brutto - Math.min(bav, c.bavSvFrei);

  // Sozialversicherung, Arbeitnehmeranteil
  const pvSatz = c.pv + (kinder === 0 ? c.pvKinderlos : -c.pvAbschlag * Math.max(0, Math.min(kinder, 5) - 1));
  const kvBasis = Math.min(svBrutto, c.bbgKv);
  const rvBasis = Math.min(svBrutto, c.bbgRv);
  const kv = r2((kvBasis * (c.kv + zusatz / 2)) / 100);
  const pv = r2((kvBasis * pvSatz) / 100);
  const rv = r2((rvBasis * c.rv) / 100);
  const av = r2((rvBasis * c.av) / 100);

  // Lohnsteuer über den Jahresbetrag
  const jahr = steuerBrutto * 12;
  const vsp = Math.ceil(
    (Math.min(jahr, c.bbgRv * 12) * c.rv) / 100 + (Math.min(jahr, c.bbgKv * 12) * (c.kvVsp + zusatz / 2 + pvSatz)) / 100
  );
  let frei = vsp;
  if (klasse !== 6) frei += c.werbungskosten + c.sonderausgaben;
  if (klasse === 2) frei += c.entlastung + c.entlastungWeitere * Math.max(0, kinder - 1);
  const zve = Math.max(0, Math.floor(jahr - frei));
  let st;
  if (klasse === 3) st = 2 * tarif2026(Math.floor(zve / 2));
  else if (klasse === 5 || klasse === 6) st = tarif56(zve);
  else st = tarif2026(zve);
  const freigrenze = c.soliFreigrenze * (klasse === 3 ? 2 : 1);
  const soliJahr = st > freigrenze ? Math.min(st * 0.055, (st - freigrenze) * 0.119) : 0;
  const lohnsteuer = Math.floor((st / 12) * 100) / 100;
  const soli = Math.floor((soliJahr / 12) * 100) / 100;
  const kirchensteuer = opts.kirche ? Math.floor(((st * c.kirche) / 100 / 12) * 100) / 100 : 0;

  const netto = r2(brutto - lohnsteuer - soli - kirchensteuer - kv - rv - av - pv - bav);
  return { brutto: r2(brutto), lohnsteuer, soli, kirchensteuer, kv, rv, av, pv, bav, netto };
}

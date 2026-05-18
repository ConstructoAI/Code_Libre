import { describe, it, expect } from 'vitest';
import {
  parseImperialInput,
  parseFeetInput,
  formatPartialInput,
  metersToImperialInput,
  metersToImperialDisplay,
  formatFeetImperial,
  formatInchesImperial,
  directionToDelta,
  angleToDelta,
  snapAngle15,
  angleFromPoints,
} from '../imperialInput';

// Tests adaptes du module standalone METRE_PDF/frontend/src/utils/imperialInput.test.ts
// avec ajout du Format B compact (PPIISS 6 digits) introduit dans le port ERP-React.
describe('parseImperialInput - Format A (PP-II-SS dashes)', () => {
  it('parses full PP-II-SS format', () => {
    const result = parseImperialInput('20-06-08');
    expect(result).not.toBeNull();
    expect(result!.feet).toBe(20);
    expect(result!.inches).toBe(6);
    expect(result!.sixteenths).toBe(8);
    expect(result!.totalMeters).toBeCloseTo(6.2611, 3);
    expect(result!.displayString).toBe("20'-6 1/2\"");
  });

  it('parses feet only', () => {
    const result = parseImperialInput('8');
    expect(result).not.toBeNull();
    expect(result!.feet).toBe(8);
    expect(result!.inches).toBe(0);
    expect(result!.sixteenths).toBe(0);
    expect(result!.totalMeters).toBeCloseTo(2.4384, 4);
  });

  it('parses feet-inches', () => {
    const result = parseImperialInput('12-06');
    expect(result).not.toBeNull();
    expect(result!.feet).toBe(12);
    expect(result!.inches).toBe(6);
    expect(result!.sixteenths).toBe(0);
    expect(result!.totalMeters).toBeCloseTo(3.81, 2);
  });

  it('parses inches only', () => {
    const result = parseImperialInput('0-09-12');
    expect(result).not.toBeNull();
    expect(result!.feet).toBe(0);
    expect(result!.inches).toBe(9);
    expect(result!.sixteenths).toBe(12);
    expect(result!.displayString).toBe('9 3/4"');
  });

  it('returns null for empty input', () => {
    expect(parseImperialInput('')).toBeNull();
    expect(parseImperialInput('   ')).toBeNull();
  });

  it('returns null for invalid values', () => {
    expect(parseImperialInput('5-12-00')).toBeNull(); // inches > 11
    expect(parseImperialInput('5-05-16')).toBeNull(); // sixteenths > 15
    expect(parseImperialInput('0-0-0')).toBeNull();   // zero total
    expect(parseImperialInput('a-b-c')).toBeNull();   // non-numeric
    expect(parseImperialInput('1-2-3-4')).toBeNull(); // too many parts
  });

  it('rejects malformed dashes (leading, trailing, consecutive)', () => {
    expect(parseImperialInput('-5')).toBeNull();
    expect(parseImperialInput('5-')).toBeNull();
    expect(parseImperialInput('5--3')).toBeNull();
    expect(parseImperialInput('-')).toBeNull();
    expect(parseImperialInput('--')).toBeNull();
    expect(parseImperialInput('-5-3-2')).toBeNull();
  });

  it('handles common fractions correctly', () => {
    expect(parseImperialInput('0-0-08')!.displayString).toBe('0 1/2"');
    expect(parseImperialInput('0-0-04')!.displayString).toBe('0 1/4"');
    expect(parseImperialInput('0-0-12')!.displayString).toBe('0 3/4"');
  });
});

describe('parseImperialInput - Format B (PPIISS 6 digits compact)', () => {
  it('parses 160608 as 16-06-08', () => {
    const result = parseImperialInput('160608');
    expect(result).not.toBeNull();
    expect(result!.feet).toBe(16);
    expect(result!.inches).toBe(6);
    expect(result!.sixteenths).toBe(8);
    expect(result!.totalMeters).toBeCloseTo(5.0419, 3);
  });

  it('parses 100000 as 10 feet even', () => {
    const result = parseImperialInput('100000');
    expect(result).not.toBeNull();
    expect(result!.feet).toBe(10);
    expect(result!.inches).toBe(0);
    expect(result!.sixteenths).toBe(0);
    expect(result!.totalMeters).toBeCloseTo(3.048, 3);
  });

  it('parses 000600 as 6 inches', () => {
    const result = parseImperialInput('000600');
    expect(result).not.toBeNull();
    expect(result!.feet).toBe(0);
    expect(result!.inches).toBe(6);
    expect(result!.sixteenths).toBe(0);
    expect(result!.totalMeters).toBeCloseTo(0.1524, 3);
  });

  it('rejects 7 digits or 5 digits compact', () => {
    // Note: '1234567' et '12345' NE matchent PAS le pattern /^\d{6}$/ et tombent
    // dans le parser Format A qui interprete comme un seul nombre de pieds
    // (parseInt('1234567') = 1234567 ft). Comportement documente, hors plage realiste.
    // On verifie ici que le pattern Format B compact ne match QUE 6 digits exactement.
    const r7 = parseImperialInput('1234567');
    expect(r7).not.toBeNull();
    expect(r7!.feet).toBe(1234567);
    expect(r7!.inches).toBe(0);
    expect(r7!.sixteenths).toBe(0);

    const r5 = parseImperialInput('12345');
    expect(r5).not.toBeNull();
    expect(r5!.feet).toBe(12345);
    expect(r5!.inches).toBe(0);
    expect(r5!.sixteenths).toBe(0);
  });

  it('rejects compact with invalid inches (> 11) or sixteenths (> 15)', () => {
    expect(parseImperialInput('051200')).toBeNull(); // inches=12
    expect(parseImperialInput('050516')).toBeNull(); // sixteenths=16
  });

  it('rejects compact with all zeros', () => {
    expect(parseImperialInput('000000')).toBeNull();
  });
});

describe('formatPartialInput', () => {
  it('formats valid input', () => {
    expect(formatPartialInput('18-04-12')).toBe("18'-4 3/4\"");
  });

  it('returns raw input for invalid', () => {
    expect(formatPartialInput('abc')).toBe('abc');
  });
});

describe('metersToImperialInput', () => {
  it('converts meters to PP-II-SS', () => {
    expect(metersToImperialInput(2.4384)).toBe('8-00-00');
  });

  it('round-trips Format A correctly', () => {
    const original = '10-06-08';
    const parsed = parseImperialInput(original)!;
    const backToInput = metersToImperialInput(parsed.totalMeters);
    expect(backToInput).toBe(original);
  });

  it('handles negative, zero, and non-finite values', () => {
    expect(metersToImperialInput(0)).toBe('0-00-00');
    expect(metersToImperialInput(-1)).toBe('0-00-00');
    expect(metersToImperialInput(-100)).toBe('0-00-00');
    expect(metersToImperialInput(Infinity)).toBe('0-00-00');
    expect(metersToImperialInput(-Infinity)).toBe('0-00-00');
    expect(metersToImperialInput(NaN)).toBe('0-00-00');
  });
});

describe('metersToImperialDisplay', () => {
  it('displays readable imperial', () => {
    expect(metersToImperialDisplay(2.4384)).toBe("8'");
    expect(metersToImperialDisplay(0.1524)).toBe('6"');
  });

  it('handles negative, zero, and non-finite values', () => {
    expect(metersToImperialDisplay(0)).toBe('0"');
    expect(metersToImperialDisplay(-1)).toBe('0"');
    expect(metersToImperialDisplay(Infinity)).toBe('0"');
    expect(metersToImperialDisplay(NaN)).toBe('0"');
  });

  it('displays feet + inches + sixteenths combined', () => {
    const parsed = parseImperialInput('10-06-08')!;
    expect(metersToImperialDisplay(parsed.totalMeters)).toBe("10'-6 1/2\"");
  });
});

describe('formatFeetImperial', () => {
  it('formats whole feet', () => {
    expect(formatFeetImperial(8)).toBe("8'");
    expect(formatFeetImperial(0)).toBe('0"');
  });

  it('formats fractional feet', () => {
    expect(formatFeetImperial(8.5)).toBe("8'-6\"");
  });

  it('handles negative and non-finite', () => {
    expect(formatFeetImperial(-1)).toBe('0"');
    expect(formatFeetImperial(Infinity)).toBe('0"');
    expect(formatFeetImperial(NaN)).toBe('0"');
  });
});

describe('formatInchesImperial', () => {
  it('formats fractional inches', () => {
    expect(formatInchesImperial(7.625)).toBe('7 5/8"');
    // Note: 15 in roule en feet (15 >= 12), donc on teste avec 11" qui reste pur.
    // Le test 'rolls inches >= 12 to feet' ci-dessous couvre le rollover.
    expect(formatInchesImperial(11)).toBe('11"');
  });

  it('rolls inches >= 12 to feet', () => {
    expect(formatInchesImperial(13)).toBe("1'-1\"");
  });

  it('handles negative and non-finite', () => {
    expect(formatInchesImperial(-1)).toBe('0"');
    expect(formatInchesImperial(NaN)).toBe('0"');
  });
});

// Tests Round 5 -- 4 fonctions exportees non couvertes (Round 5 QA gap):
// directionToDelta, angleToDelta, snapAngle15, angleFromPoints

describe('directionToDelta', () => {
  it('returns correct delta for each direction (PDF coords: y inverse)', () => {
    expect(directionToDelta('up', 100)).toEqual({ x: 0, y: -100 });
    expect(directionToDelta('down', 100)).toEqual({ x: 0, y: 100 });
    expect(directionToDelta('right', 100)).toEqual({ x: 100, y: 0 });
    expect(directionToDelta('left', 100)).toEqual({ x: -100, y: 0 });
  });

  it('respects pixelDistance scaling', () => {
    expect(directionToDelta('right', 250)).toEqual({ x: 250, y: 0 });
    // Note: directionToDelta('left', 0) retourne { x: -0, y: 0 } car -1*0 = -0 en JS.
    // toEqual distingue -0 et +0 (Object.is), donc on compare numeriquement
    // avec === qui considere -0 === 0 -> true.
    const leftZero = directionToDelta('left', 0);
    expect(leftZero.x === 0).toBe(true);
    expect(leftZero.y === 0).toBe(true);
  });
});

describe('angleToDelta', () => {
  it('calculates delta at 0 degrees (right)', () => {
    const d = angleToDelta(0, 100);
    expect(d.x).toBeCloseTo(100, 5);
    expect(d.y).toBeCloseTo(0, 5);
  });

  it('calculates delta at 90 degrees (down in PDF coords)', () => {
    const d = angleToDelta(90, 100);
    expect(d.x).toBeCloseTo(0, 5);
    expect(d.y).toBeCloseTo(100, 5);
  });

  it('calculates delta at 45 degrees', () => {
    const d = angleToDelta(45, 100);
    expect(d.x).toBeCloseTo(70.7107, 3);
    expect(d.y).toBeCloseTo(70.7107, 3);
  });

  it('calculates delta at 270 degrees (up)', () => {
    const d = angleToDelta(270, 100);
    expect(d.x).toBeCloseTo(0, 5);
    expect(d.y).toBeCloseTo(-100, 5);
  });

  it('calculates delta at 360 degrees (same as 0)', () => {
    const d = angleToDelta(360, 100);
    expect(d.x).toBeCloseTo(100, 5);
    expect(d.y).toBeCloseTo(0, 5);
  });
});

describe('snapAngle15', () => {
  it('snaps to nearest 15-degree increment', () => {
    expect(snapAngle15(7)).toBe(0);
    expect(snapAngle15(8)).toBe(15);
    expect(snapAngle15(22)).toBe(15);
    expect(snapAngle15(23)).toBe(30);
    expect(snapAngle15(44)).toBe(45);
    expect(snapAngle15(90)).toBe(90);
    expect(snapAngle15(180)).toBe(180);
    expect(snapAngle15(352)).toBe(345);
    expect(snapAngle15(353)).toBe(0);
  });

  it('normalizes negative angles to [0, 360)', () => {
    expect(snapAngle15(-7)).toBe(0);
    expect(snapAngle15(-8)).toBe(345);
    expect(snapAngle15(-90)).toBe(270);
    expect(snapAngle15(-180)).toBe(180);
    expect(snapAngle15(-360)).toBe(0);
  });

  it('normalizes angles >= 360', () => {
    expect(snapAngle15(360)).toBe(0);
    expect(snapAngle15(375)).toBe(15);
    expect(snapAngle15(720)).toBe(0);
  });
});

describe('angleFromPoints', () => {
  it('returns 0 for point directly to the right', () => {
    expect(angleFromPoints({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(0, 5);
  });

  it('returns 90 for point directly below (PDF coords)', () => {
    expect(angleFromPoints({ x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(90, 5);
  });

  it('returns 180 for point directly to the left', () => {
    expect(angleFromPoints({ x: 0, y: 0 }, { x: -100, y: 0 })).toBeCloseTo(180, 5);
  });

  it('returns 270 for point directly above', () => {
    expect(angleFromPoints({ x: 0, y: 0 }, { x: 0, y: -100 })).toBeCloseTo(270, 5);
  });

  it('returns 0 for coincident points', () => {
    expect(angleFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });
});

describe('parseFeetInput - BOM composite_inputs panel (LeftPanel)', () => {
  it('parses compact PPIISS 6 digits as feet decimal', () => {
    expect(parseFeetInput('100608')).toBeCloseTo(10.5417, 4); // 10'-6 1/2"
    expect(parseFeetInput('010400')).toBeCloseTo(1.3333, 4);   // 1'-4"
    expect(parseFeetInput('080000')).toBeCloseTo(8.0, 4);      // 8 ft
    expect(parseFeetInput('160608')).toBeCloseTo(16.5417, 4);  // 16'-6 1/2"
  });

  it('parses compact IISS 4 digits as feet decimal (sub-foot values)', () => {
    expect(parseFeetInput('0608')).toBeCloseTo(0.5417, 4); // 6 1/2"
    expect(parseFeetInput('0400')).toBeCloseTo(0.3333, 4); // 4"
    expect(parseFeetInput('0800')).toBeCloseTo(0.6667, 4); // 8"
    expect(parseFeetInput('0608')).toBeCloseTo(6.5 / 12, 4);
  });

  it('parses decimal with point as feet', () => {
    expect(parseFeetInput('1.333')).toBe(1.333);
    expect(parseFeetInput('0.5')).toBe(0.5);
    expect(parseFeetInput('8.0')).toBe(8.0);
    expect(parseFeetInput('0.0')).toBe(0.0);
  });

  it('parses decimal with comma (FR locale) as feet', () => {
    expect(parseFeetInput('1,333')).toBe(1.333);
    expect(parseFeetInput('0,5')).toBe(0.5);
    expect(parseFeetInput('8,0')).toBe(8.0);
  });

  it('parses plain integer as feet decimal', () => {
    expect(parseFeetInput('8')).toBe(8);
    expect(parseFeetInput('120')).toBe(120);
    expect(parseFeetInput('0')).toBe(0);
  });

  it('parses PP-II-SS dashes format as feet decimal', () => {
    expect(parseFeetInput('10-06-08')).toBeCloseTo(10.5417, 4);
    expect(parseFeetInput('1-04-00')).toBeCloseTo(1.3333, 4);
  });

  it('returns null for empty or whitespace', () => {
    expect(parseFeetInput('')).toBeNull();
    expect(parseFeetInput('   ')).toBeNull();
  });

  it('returns null for invalid PPIISS (inches > 11 or sixteenths > 15)', () => {
    expect(parseFeetInput('001500')).toBeNull(); // 15 in (> 11)
    expect(parseFeetInput('001016')).toBeNull(); // 16 sixteenths (> 15)
    expect(parseFeetInput('1500')).toBeNull();   // 15 in IISS (> 11)
    expect(parseFeetInput('1016')).toBeNull();   // 16 sixteenths IISS (> 15)
  });

  it('returns null for negative input', () => {
    expect(parseFeetInput('-1.5')).toBeNull();
    expect(parseFeetInput('-100608')).toBeNull();
  });

  it('returns null for non-numeric junk', () => {
    expect(parseFeetInput('abc')).toBeNull();
    expect(parseFeetInput('1.2.3')).toBeNull();
  });

  it('returns null for all-zero compact input (B-4 fix)', () => {
    // "0000" et "000000" retournent null pour ne PAS overrider le default
    // du composite avec 0. Sylvain pourrait taper accidentellement 0 et
    // perdre la valeur par defaut (ex: hauteur_pierre_drain default 0.5).
    expect(parseFeetInput('0000')).toBeNull();
    expect(parseFeetInput('000000')).toBeNull();
  });

  // ── QA gap tests (Round 6) ──────────────────────────────────────
  // Edge cases additionnels identifies par audit QA:

  it('rejects internal whitespace (B-1 fix)', () => {
    // Le fix B-1 ajoute `if (/\s/.test(trimmed)) return null` apres trim
    // pour eviter la silent parseInt truncation. '100 608' = null au lieu
    // de 100 (qui était silencieusement enregistré comme 100 pi).
    expect(parseFeetInput('100 608')).toBeNull();
    expect(parseFeetInput('10 -06-08')).toBeNull();
    expect(parseFeetInput('1 .333')).toBeNull();
  });

  it('trims leading/trailing whitespace correctly', () => {
    // Espaces autour: trim() doit s appliquer.
    expect(parseFeetInput(' 100608 ')).toBeCloseTo(10.5417, 4);
    expect(parseFeetInput('\t8\n')).toBe(8);
    expect(parseFeetInput('  1.5  ')).toBe(1.5);
  });

  it('handles very large plain integers (overflow domain)', () => {
    // Inputs hors plage realiste BOM (chantier residentiel max ~200 ft).
    // Pas de rejet code mais documenter le comportement.
    expect(parseFeetInput('999999')).toBeNull(); // PPIISS: ff=99 in=99 sx=99 -> null
    expect(parseFeetInput('9999')).toBeNull();   // IISS: in=99 sx=99 -> null
    expect(parseFeetInput('99999999')).toBe(99999999); // 8 digits -> parseInt fallback
  });

  it('rejects scientific notation (B-1 fix)', () => {
    // La nouvelle regex stricte `^\d+$` sur le fallback rejette
    // toute notation non-purement-numerique, incluant '1e3', '1E3'.
    // Le risque d'ambiguite (utilisateur attend 1000 ou 1 ft ?) disparaît.
    expect(parseFeetInput('1e3')).toBeNull();
    expect(parseFeetInput('1E3')).toBeNull();
    expect(parseFeetInput('1.5e2')).toBeNull();
  });

  it('handles trailing zeros in decimals', () => {
    // Trailing zeros doivent etre accepte (saisie utilisateur courante).
    expect(parseFeetInput('0.5000')).toBe(0.5);
    expect(parseFeetInput('8.0000')).toBe(8.0);
    expect(parseFeetInput('10.10')).toBe(10.1);
  });

  it('rejects very long zero-padded plain integers', () => {
    // "010400000" (9 digits) ne match ni PPIISS (6) ni IISS (4) -> parseInt fallback.
    // Documente comportement potentiellement surprenant.
    expect(parseFeetInput('010400000')).toBe(10400000);
    expect(parseFeetInput('00000001')).toBe(1);
  });

  it('rejects unicode/emoji input', () => {
    expect(parseFeetInput('🏠')).toBeNull();
    expect(parseFeetInput('１００６０８')).toBeNull(); // full-width digits
    expect(parseFeetInput('café')).toBeNull();
    expect(parseFeetInput('1.5ft')).toBeNull();
  });

  it('rejects mixed formats (dash + decimal)', () => {
    // "1.5-08" et variantes: regex strict decimal et le parseImperialInput
    // doivent tous deux rejeter.
    expect(parseFeetInput('1.5-08')).toBeNull();
    expect(parseFeetInput('1-5.0')).toBeNull();
    expect(parseFeetInput('10,5-06')).toBeNull();
  });

  it('rejects leading + sign (B-1 fix)', () => {
    // La nouvelle regex stricte `^\d+$` rejette le leading '+' de facon
    // symetrique sur tous les formats. Plus d'asymetrie regex vs parseInt.
    expect(parseFeetInput('+1.5')).toBeNull();
    expect(parseFeetInput('+100608')).toBeNull();
    expect(parseFeetInput('+0608')).toBeNull();
    expect(parseFeetInput('+8')).toBeNull();
  });

  it('rejects bare separators or partial decimals', () => {
    // Edge cases de saisie incomplete utilisateur.
    expect(parseFeetInput('.')).toBeNull();
    expect(parseFeetInput(',')).toBeNull();
    expect(parseFeetInput('.5')).toBeNull(); // notre regex exige \d+\.?\d*
    expect(parseFeetInput(',5')).toBeNull();
    expect(parseFeetInput('-')).toBeNull();
  });

  it('handles trailing dot/comma in decimals', () => {
    // "1." et "1," : ambigus, regex actuelle accepte (\d+\.?\d*).
    expect(parseFeetInput('1.')).toBe(1);
    expect(parseFeetInput('1,')).toBe(1);
    expect(parseFeetInput('100.')).toBe(100);
  });

  it('rejects multiple decimal separators', () => {
    // "1.2.3" et "1,2,3": deja teste dans junk mais on couvre les variantes.
    expect(parseFeetInput('1,2,3')).toBeNull();
    expect(parseFeetInput('1.2,3')).toBeNull();
    expect(parseFeetInput('1,2.3')).toBeNull();
  });

  it('handles leading zero in plain integer (not 4 or 6 digits)', () => {
    // "08" (2 digits) ne match ni PPIISS ni IISS -> parseInt = 8.
    // "000" (3 digits) -> parseInt = 0.
    // "08000" (5 digits) -> parseInt = 8000. Comportement potentiellement surprenant.
    expect(parseFeetInput('08')).toBe(8);
    expect(parseFeetInput('000')).toBe(0);
    expect(parseFeetInput('08000')).toBe(8000);
  });

  it('handles 5-digit input (between IISS and PPIISS)', () => {
    // 5 digits ne match aucun format compact -> parseInt fallback.
    // Risque BOM: utilisateur tape "10608" pensant "1'-6 1/2"" mais obtient 10608 ft.
    expect(parseFeetInput('10608')).toBe(10608);
    expect(parseFeetInput('00608')).toBe(608);
  });

  it('handles dash-prefix variants beyond simple negative', () => {
    // "--1.5" et "1--5" doivent rejeter.
    expect(parseFeetInput('--1.5')).toBeNull();
    expect(parseFeetInput('1--5')).toBeNull();
    expect(parseFeetInput('-1-04-00')).toBeNull();
  });

  it('handles decimal with whitespace around separator', () => {
    // "1 . 5" : espaces internes -> rejet.
    expect(parseFeetInput('1 . 5')).toBeNull();
    expect(parseFeetInput('1 , 5')).toBeNull();
  });
});

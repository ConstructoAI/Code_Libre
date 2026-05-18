import { describe, it, expect } from 'vitest';
import { evaluateFormula, extractVariables } from '../bomEvaluator';

describe('evaluateFormula -- basic arithmetic', () => {
  it('evaluates simple addition', () => {
    expect(evaluateFormula('1 + 2', {})).toEqual({ value: 3, error: null });
  });

  it('respects operator precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', {})).toEqual({ value: 14, error: null });
    expect(evaluateFormula('(2 + 3) * 4', {})).toEqual({ value: 20, error: null });
  });

  it('handles unary minus', () => {
    expect(evaluateFormula('-5 + 3', {})).toEqual({ value: -2, error: null });
    expect(evaluateFormula('-(2 + 3)', {})).toEqual({ value: -5, error: null });
  });

  it('handles decimals', () => {
    expect(evaluateFormula('0.5 + 0.25', {})).toEqual({ value: 0.75, error: null });
  });

  it('handles division', () => {
    expect(evaluateFormula('10 / 4', {})).toEqual({ value: 2.5, error: null });
  });

  it('returns NaN for division by zero', () => {
    const result = evaluateFormula('10 / 0', {});
    expect(Number.isNaN(result.value)).toBe(true);
  });
});

describe('evaluateFormula -- variables', () => {
  it('reads named inputs', () => {
    expect(evaluateFormula('perimetre_ss * 0.25 + 3', { perimetre_ss: 164 })).toEqual({
      value: 44,
      error: null,
    });
  });

  it('errors when variable is not provided', () => {
    const r = evaluateFormula('foo + 1', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('Variable non fournie: foo');
  });

  it('treats undefined input as missing (not zero)', () => {
    const r = evaluateFormula('a + b', { a: 1 });
    expect(Number.isNaN(r.value)).toBe(true);
  });
});

describe('evaluateFormula -- functions', () => {
  it('IF returns then-branch when condition truthy', () => {
    expect(evaluateFormula('IF(surface > 800, 3, 2)', { surface: 1128 })).toEqual({
      value: 3,
      error: null,
    });
  });

  it('IF returns else-branch when condition falsy', () => {
    expect(evaluateFormula('IF(x > 0, 1, -1)', { x: -5 })).toEqual({
      value: -1,
      error: null,
    });
  });

  it('MIN/MAX', () => {
    expect(evaluateFormula('MIN(3, 7, 1)', {})).toEqual({ value: 1, error: null });
    expect(evaluateFormula('MAX(3, 7, 1)', {})).toEqual({ value: 7, error: null });
  });

  it('ROUND with 1 and 2 args', () => {
    expect(evaluateFormula('ROUND(3.7)', {})).toEqual({ value: 4, error: null });
    expect(evaluateFormula('ROUND(3.14159, 2)', {})).toEqual({ value: 3.14, error: null });
  });

  it('SUM aggregates', () => {
    expect(evaluateFormula('SUM(1, 2, 3, 4)', {})).toEqual({ value: 10, error: null });
  });

  it('ABS, CEIL, FLOOR', () => {
    expect(evaluateFormula('ABS(-7.5)', {})).toEqual({ value: 7.5, error: null });
    expect(evaluateFormula('CEIL(3.1)', {})).toEqual({ value: 4, error: null });
    expect(evaluateFormula('FLOOR(3.9)', {})).toEqual({ value: 3, error: null });
  });

  it('rejects unknown function', () => {
    const r = evaluateFormula('FOO(1)', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('Fonction inconnue');
  });

  it('functions are case-insensitive', () => {
    expect(evaluateFormula('if(1=1, 5, 10)', {})).toEqual({ value: 5, error: null });
  });
});

describe('evaluateFormula -- comparisons', () => {
  it('greater/less than', () => {
    expect(evaluateFormula('5 > 3', {})).toEqual({ value: 1, error: null });
    expect(evaluateFormula('5 < 3', {})).toEqual({ value: 0, error: null });
  });

  it('equality (== and =)', () => {
    expect(evaluateFormula('5 == 5', {})).toEqual({ value: 1, error: null });
    expect(evaluateFormula('5 = 5', {})).toEqual({ value: 1, error: null });
  });

  it('inequality (!= and <>)', () => {
    expect(evaluateFormula('5 != 3', {})).toEqual({ value: 1, error: null });
    expect(evaluateFormula('5 <> 5', {})).toEqual({ value: 0, error: null });
  });
});

describe('evaluateFormula -- error guards (DoS protection)', () => {
  it('rejects empty formula', () => {
    expect(evaluateFormula('', {}).error).toBe('Formule vide');
    expect(evaluateFormula('   ', {}).error).toBe('Formule vide');
  });

  it('rejects formulas exceeding 500 chars', () => {
    const long = '1 + '.repeat(150) + '1'; // ~600 chars
    expect(evaluateFormula(long, {}).error).toContain('trop longue');
  });

  it('rejects deeply nested parentheses (parse depth > 32)', () => {
    // 50 nested parens around a number
    const deep = '('.repeat(50) + '1' + ')'.repeat(50);
    const r = evaluateFormula(deep, {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('trop imbriquee');
  });

  it('rejects deeply nested IFs (parse depth > 32)', () => {
    // 40 IF imbriques + close
    let formula = '';
    for (let i = 0; i < 40; i++) formula += 'IF(1, ';
    formula += '1';
    for (let i = 0; i < 40; i++) formula += ', 0)';
    const r = evaluateFormula(formula, {});
    expect(Number.isNaN(r.value)).toBe(true);
  });

  it('catches malformed syntax', () => {
    expect(Number.isNaN(evaluateFormula('1 +', {}).value)).toBe(true);
    // Note: '1 ++ 2' est ACCEPTE par la grammaire (1 + (+2) = 3) car parseUnary
    // accepte le '+' unaire. Comportement documente, comme JavaScript.
    expect(evaluateFormula('1 ++ 2', {}).value).toBe(3);
    expect(Number.isNaN(evaluateFormula('a..b', {}).value)).toBe(true);
    expect(Number.isNaN(evaluateFormula('1.2.3', {}).value)).toBe(true);
  });

  it('rejects unbalanced parens', () => {
    expect(Number.isNaN(evaluateFormula('(1 + 2', {}).value)).toBe(true);
    expect(Number.isNaN(evaluateFormula('1 + 2)', {}).value)).toBe(true);
  });

  it('rejects extra tokens after expression', () => {
    expect(Number.isNaN(evaluateFormula('1 + 2 3', {}).value)).toBe(true);
  });
});

describe('extractVariables', () => {
  it('extracts unique snake_case identifiers', () => {
    expect(extractVariables('perimetre_ss * 0.25 + surface_rc')).toEqual([
      'perimetre_ss',
      'surface_rc',
    ]);
  });

  it('excludes function names', () => {
    expect(extractVariables('IF(perimetre > 100, MIN(a, b), MAX(c, 0))')).toEqual([
      'a',
      'b',
      'c',
      'perimetre',
    ]);
  });

  it('returns empty for formula without variables', () => {
    expect(extractVariables('1 + 2 * 3')).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(extractVariables('')).toEqual([]);
  });

  it('silently ignores tokenize errors', () => {
    // Le tokenize echoue sur '@' AVANT de retourner les tokens deja construits,
    // donc extractVariables retourne []. Comportement documente: si la formule
    // contient un char invalide, AUCUNE variable n'est extraite. C'est OK car
    // l'UI affichera l'erreur de tokenize a la prochaine evaluation.
    expect(extractVariables('a + @')).toEqual([]);
  });
});

describe('evaluateFormula -- BOM Mario realistic formulas', () => {
  it('typical perimetre formula', () => {
    const r = evaluateFormula('perimetre_ss * 0.25 + 3', { perimetre_ss: 200 });
    expect(r.value).toBe(53);
    expect(r.error).toBeNull();
  });

  it('conditional based on surface', () => {
    const r = evaluateFormula(
      'IF(surface_ss > 800, perimetre_ss * 0.3, perimetre_ss * 0.25)',
      { surface_ss: 1000, perimetre_ss: 200 },
    );
    expect(r.value).toBe(60);
  });

  it('rounding with ceiling for box count', () => {
    const r = evaluateFormula('CEIL(longueur_mur / 8)', { longueur_mur: 17.5 });
    expect(r.value).toBe(3);
  });
});

describe('evaluateFormula -- numeric edge cases (Round 5)', () => {
  it('Infinity * 0 returns NaN with non-fini error', () => {
    // Note: la notation scientifique (1e308) n'est PAS supportee par le tokenizer
    // (qui split '1e308' en num '1' + ident 'e308'). On simule donc l'overflow
    // via la multiplication de deux entiers litteraux a 200 chiffres (= 1e200).
    // 1e200 * 1e200 = 1e400 > Number.MAX_VALUE (1.8e308) -> Infinity.
    const big = '1' + '0'.repeat(200); // 201 chars chacun
    const r = evaluateFormula(`${big} * ${big}`, {}); // ~405 chars, sous la limite 500
    expect(Number.isNaN(r.value) || !Number.isFinite(r.value)).toBe(true);
    expect(r.error).toBe('Resultat non fini');
  });

  it('Float precision 0.1 + 0.2 == 0.3 fails (JS classic)', () => {
    // 0.1 + 0.2 = 0.30000000000000004 -- different de 0.3
    const r = evaluateFormula('0.1 + 0.2 == 0.3', {});
    expect(r.value).toBe(0); // false en convention 0/1
  });

  it('Chained comparisons left-associative: 1 < 2 < 3 -> (1<2)<3 -> 1<3 -> 1', () => {
    const r = evaluateFormula('1 < 2 < 3', {});
    expect(r.value).toBe(1);
  });

  it('Chained comparisons: 3 > 2 > 1 -> (3>2)>1 -> 1>1 -> 0', () => {
    const r = evaluateFormula('3 > 2 > 1', {});
    expect(r.value).toBe(0);
  });

  it('rejects standalone dot token "." as invalid number', () => {
    const r = evaluateFormula('.', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('Nombre invalide');
  });

  it('rejects malformed multiple dots "1.2.3"', () => {
    const r = evaluateFormula('1.2.3', {});
    expect(Number.isNaN(r.value)).toBe(true);
  });
});

describe('evaluateFormula -- prototype safety (Round 5)', () => {
  it('rejects __proto__ as variable name with clear message', () => {
    const r = evaluateFormula('__proto__ + 1', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('Variable non fournie: __proto__');
  });

  it('rejects constructor as variable name with clear message', () => {
    const r = evaluateFormula('constructor', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('Variable non fournie: constructor');
  });

  it('rejects toString as variable name with clear message', () => {
    const r = evaluateFormula('toString * 2', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('Variable non fournie: toString');
  });

  it('inputs.hasOwnProperty=42 takes precedence (own property)', () => {
    const r = evaluateFormula('hasOwnProperty + 1', { hasOwnProperty: 42 });
    expect(r.value).toBe(43);
    expect(r.error).toBeNull();
  });
});

describe('evaluateFormula -- IF eager evaluation (Round 5)', () => {
  it('IF evaluates ALL args eagerly (then-branch unused but evaluated)', () => {
    // 1/0 dans else-branche est evaluee meme si then-branche est prise.
    // 1/0 returne NaN (pas une exception), donc IF retourne 1.
    const r = evaluateFormula('IF(1, 1, 1/0)', {});
    expect(r.value).toBe(1);
    expect(r.error).toBeNull();
  });

  it('IF eager: missing variable in unused else-branch still throws', () => {
    // Comportement documente: les args sont evalues AVANT IF. Si une variable
    // manque dans else, throw meme si then est prise.
    const r = evaluateFormula('IF(1, 100, missing_var)', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('Variable non fournie: missing_var');
  });

  it('IF zero-condition takes else-branch', () => {
    const r = evaluateFormula('IF(0, 1, 2)', {});
    expect(r.value).toBe(2);
  });

  it('IF NaN-condition takes else-branch', () => {
    // FUNCTIONS.IF: args[0] !== 0 && !Number.isNaN(args[0]) ? then : else
    const r = evaluateFormula('IF(0/0, 1, 2)', {});
    expect(r.value).toBe(2);
  });
});

describe('evaluateFormula -- function arity edge cases (Round 5)', () => {
  it('MIN with 0 args returns Infinity -> Resultat non fini', () => {
    const r = evaluateFormula('MIN()', {});
    expect(r.error).toBe('Resultat non fini');
  });

  it('MAX with 0 args returns -Infinity -> Resultat non fini', () => {
    const r = evaluateFormula('MAX()', {});
    expect(r.error).toBe('Resultat non fini');
  });

  it('SUM with 0 args returns 0', () => {
    const r = evaluateFormula('SUM()', {});
    expect(r.value).toBe(0);
    expect(r.error).toBeNull();
  });

  it('IF with 2 args throws clear error', () => {
    const r = evaluateFormula('IF(1, 2)', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('IF(cond, then, else)');
  });

  it('ROUND with 3 args throws clear error', () => {
    const r = evaluateFormula('ROUND(1, 2, 3)', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('ROUND');
  });

  it('ABS with 0 args throws clear error', () => {
    const r = evaluateFormula('ABS()', {});
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toContain('ABS');
  });
});

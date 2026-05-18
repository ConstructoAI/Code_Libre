/**
 * Safe parametric BOM formula evaluator.
 *
 * Used by the Metre PDF module to compute child component quantities
 * from a parent composite product's BOM, given a set of named inputs
 * (perimetre_ss, surface_rc, has_garage, ...).
 *
 * Design constraints:
 * - NEVER use eval() or new Function() -- formulas come from user / DB.
 * - Whitelist of operators and functions.
 * - Variables are limited to [a-z][a-z0-9_]* identifiers (snake_case inputs).
 * - Returns NaN on parse / runtime errors so the UI can show "--" instead of
 *   crashing the panel.
 *
 * Supported syntax:
 *   numbers          1, 1.5, 0.123
 *   identifiers      perimetre_ss, has_garage
 *   parens           (a + b)
 *   binary           +  -  *  /
 *   compare          >  <  >=  <=  ==  !=  =  <>
 *   functions        IF(cond, then, else), MIN(a,b), MAX(a,b), ROUND(x,n), SUM(a,b,c,...)
 *   booleans         literals not allowed -- use 0/1 (Excel convention)
 */

export type FormulaInputs = Record<string, number>;

interface Token {
  type: 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';
  value: string;
}

const OPERATOR_CHARS = '+-*/(),<>=!';
const COMPOUND_OPS = new Set(['>=', '<=', '==', '!=', '<>']);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // Numbers (incl. decimal)
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = src.slice(i, j);
      if ((num.match(/\./g) ?? []).length > 1) {
        throw new Error(`Nombre invalide: ${num}`);
      }
      tokens.push({ type: 'num', value: num });
      i = j;
      continue;
    }
    // Identifiers (variables and function names)
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i++;
      continue;
    }
    if (OPERATOR_CHARS.includes(ch)) {
      const two = src.slice(i, i + 2);
      if (COMPOUND_OPS.has(two)) {
        tokens.push({ type: 'op', value: two });
        i += 2;
        continue;
      }
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    throw new Error(`Caractere inattendu: ${ch} (position ${i})`);
  }
  return tokens;
}

// ------------------------------------------------------------------
// Recursive descent parser building an AST, then evaluator.
// Grammar (precedence ascending):
//   expr     = compare
//   compare  = add ((>|<|>=|<=|==|!=|=|<>) add)*
//   add      = mul ((+|-) mul)*
//   mul      = unary ((*|/) unary)*
//   unary    = (-)? primary
//   primary  = num | ident | ident '(' args ')' | '(' expr ')'
//   args     = expr (',' expr)*
// ------------------------------------------------------------------

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'binop'; op: string; left: Node; right: Node }
  | { kind: 'unary'; op: string; child: Node }
  | { kind: 'call'; name: string; args: Node[] };

// DoS guards: bornent la complexite des formules user-fournies pour eviter de
// faire freezer le frontend. Sous 500 chars (cap dans evaluateFormula), une
// formule peut imbriquer jusqu'a ~50 niveaux de IF(IF(IF(...))) ce qui suffit
// a saturer la pile JS dans certains navigateurs. Ces limites laissent une
// large marge pour les usages legitimes (BOM Mario typique = 3-5 niveaux).
const MAX_PARSE_DEPTH = 32;
const MAX_EVAL_ITERATIONS = 10000;

class Parser {
  pos = 0;
  depth = 0;
  constructor(public tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  eat(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('Fin de formule prematuree');
    this.pos++;
    return t;
  }
  expect(type: Token['type'], value?: string) {
    const t = this.eat();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Token attendu ${type}${value ? ` ${value}` : ''}, obtenu ${t.type} ${t.value}`);
    }
    return t;
  }

  parseExpr(): Node {
    this.depth++;
    if (this.depth > MAX_PARSE_DEPTH) {
      throw new Error(`Formule trop imbriquee (max ${MAX_PARSE_DEPTH} niveaux de parentheses/fonctions)`);
    }
    try {
      return this.parseCompare();
    } finally {
      this.depth--;
    }
  }

  parseCompare(): Node {
    let left = this.parseAdd();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== 'op') break;
      if (!['>', '<', '>=', '<=', '==', '!=', '=', '<>'].includes(t.value)) break;
      this.eat();
      const right = this.parseAdd();
      left = { kind: 'binop', op: t.value, left, right };
    }
    return left;
  }

  parseAdd(): Node {
    let left = this.parseMul();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== 'op' || !['+', '-'].includes(t.value)) break;
      this.eat();
      const right = this.parseMul();
      left = { kind: 'binop', op: t.value, left, right };
    }
    return left;
  }

  parseMul(): Node {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== 'op' || !['*', '/'].includes(t.value)) break;
      this.eat();
      const right = this.parseUnary();
      left = { kind: 'binop', op: t.value, left, right };
    }
    return left;
  }

  parseUnary(): Node {
    const t = this.peek();
    if (t && t.type === 'op' && t.value === '-') {
      this.eat();
      const child = this.parseUnary();
      return { kind: 'unary', op: '-', child };
    }
    if (t && t.type === 'op' && t.value === '+') {
      this.eat();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary(): Node {
    const t = this.eat();
    if (t.type === 'num') {
      // Valider que le token num est un nombre fini (rejette ".", ".." etc.
      // qui passent le tokenize regex `[0-9.]` mais parseFloat -> NaN).
      const value = parseFloat(t.value);
      if (!Number.isFinite(value)) {
        throw new Error(`Nombre invalide: ${t.value}`);
      }
      return { kind: 'num', value };
    }
    if (t.type === 'lparen') {
      const e = this.parseExpr();
      this.expect('rparen');
      return e;
    }
    if (t.type === 'ident') {
      const next = this.peek();
      if (next && next.type === 'lparen') {
        this.eat();
        const args: Node[] = [];
        if (this.peek()?.type !== 'rparen') {
          args.push(this.parseExpr());
          while (this.peek()?.type === 'comma') {
            this.eat();
            args.push(this.parseExpr());
          }
        }
        this.expect('rparen');
        return { kind: 'call', name: t.value, args };
      }
      return { kind: 'var', name: t.value };
    }
    throw new Error(`Expression inattendue: ${t.type} ${t.value}`);
  }
}

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  IF: (args) => {
    if (args.length !== 3) throw new Error('IF(cond, then, else) requiert 3 arguments');
    return args[0] !== 0 && !Number.isNaN(args[0]) ? args[1] : args[2];
  },
  MIN: (args) => Math.min(...args),
  MAX: (args) => Math.max(...args),
  ROUND: (args) => {
    if (args.length === 1) return Math.round(args[0]);
    if (args.length === 2) {
      const f = Math.pow(10, args[1]);
      return Math.round(args[0] * f) / f;
    }
    throw new Error('ROUND(x) ou ROUND(x, n)');
  },
  SUM: (args) => args.reduce((a, b) => a + b, 0),
  ABS: (args) => {
    if (args.length !== 1) throw new Error('ABS(x) requiert 1 argument');
    return Math.abs(args[0]);
  },
  CEIL: (args) => Math.ceil(args[0]),
  FLOOR: (args) => Math.floor(args[0]),
};

interface EvalContext {
  count: number;
}

function evalNode(node: Node, inputs: FormulaInputs, ctx: EvalContext): number {
  ctx.count++;
  if (ctx.count > MAX_EVAL_ITERATIONS) {
    throw new Error(`Formule trop complexe: max ${MAX_EVAL_ITERATIONS} operations`);
  }
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var': {
      // Utiliser hasOwnProperty (pas l'access direct) pour eviter le false-positive
      // sur les noms de proprietes du prototype Object (ex: "__proto__", "constructor",
      // "toString", "hasOwnProperty", "valueOf"). Sans ce guard, `inputs['__proto__']`
      // retourne le prototype object (truthy, !== undefined) et passerait silencieusement
      // -> Number({}) = NaN -> erreur trompeuse "Resultat non fini" au lieu du clair
      // "Variable non fournie".
      if (!Object.prototype.hasOwnProperty.call(inputs, node.name)) {
        throw new Error(`Variable non fournie: ${node.name}`);
      }
      const v = inputs[node.name];
      return Number(v);
    }
    case 'unary': {
      const c = evalNode(node.child, inputs, ctx);
      return node.op === '-' ? -c : c;
    }
    case 'binop': {
      const l = evalNode(node.left, inputs, ctx);
      const r = evalNode(node.right, inputs, ctx);
      switch (node.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return r === 0 ? NaN : l / r;
        case '>':
          return l > r ? 1 : 0;
        case '<':
          return l < r ? 1 : 0;
        case '>=':
          return l >= r ? 1 : 0;
        case '<=':
          return l <= r ? 1 : 0;
        case '==':
        case '=':
          return l === r ? 1 : 0;
        case '!=':
        case '<>':
          return l !== r ? 1 : 0;
        default:
          throw new Error(`Operateur inconnu: ${node.op}`);
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.name.toUpperCase()];
      if (!fn) throw new Error(`Fonction inconnue: ${node.name}`);
      const argVals = node.args.map((a) => evalNode(a, inputs, ctx));
      return fn(argVals);
    }
  }
}

export interface EvaluateResult {
  value: number;
  error: string | null;
}

/**
 * Evaluate a parametric BOM formula safely. Returns {value, error}.
 * On parse / runtime error, value is NaN and error is the message.
 *
 * @example
 *   evaluateFormula("perimetre_ss * 0.25 + 3", { perimetre_ss: 164 })
 *   // -> { value: 44, error: null }
 *
 *   evaluateFormula("IF(surface > 800, 3, 2)", { surface: 1128 })
 *   // -> { value: 3, error: null }
 */
export function evaluateFormula(formula: string, inputs: FormulaInputs): EvaluateResult {
  if (!formula || !formula.trim()) {
    return { value: NaN, error: 'Formule vide' };
  }
  if (formula.length > 500) {
    return { value: NaN, error: 'Formule trop longue (max 500 chars)' };
  }
  try {
    const tokens = tokenize(formula);
    const parser = new Parser(tokens);
    const ast = parser.parseExpr();
    if (parser.pos < tokens.length) {
      const remaining = tokens[parser.pos];
      throw new Error(`Tokens en trop apres la formule: ${remaining.value}`);
    }
    const value = evalNode(ast, inputs, { count: 0 });
    if (!Number.isFinite(value)) {
      return { value, error: 'Resultat non fini' };
    }
    return { value, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return { value: NaN, error: msg };
  }
}

/**
 * Extract the names of variables used in a formula. Useful to validate
 * that all required inputs are provided BEFORE evaluation.
 *
 * Returns a sorted list of unique snake_case identifiers, excluding
 * function names (IF, MIN, MAX, ...).
 */
export function extractVariables(formula: string): string[] {
  if (!formula) return [];
  const reservedFns = new Set(Object.keys(FUNCTIONS));
  const seen = new Set<string>();
  try {
    const tokens = tokenize(formula);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'ident' && !reservedFns.has(t.value.toUpperCase())) {
        // If the next token is '(', it's a function call we don't recognize --
        // skip it to avoid pollution. Otherwise it's a variable.
        const next = tokens[i + 1];
        if (next?.type !== 'lparen') {
          seen.add(t.value);
        }
      }
    }
  } catch {
    // Tokenize errors -- silently return what we collected so far.
  }
  return [...seen].sort();
}

import { catchErr } from '../../test/helpers/catch.ts';
import { cfg, I, snap } from '../../test/helpers/snapshot.ts';
import {
  checkPropFilter,
  checkProps,
  type PropFilter,
  parsePropAssignment,
  parsePropFilter,
  propMatches,
  propViolations,
} from './props.ts';

const config = cfg({
  props: {
    severity: {
      type: 'enum',
      values: ['critical', 'high', 'medium', 'low', 'info'],
      ordered: true,
      description: 'Schwere',
    },
    estimate_h: { type: 'number', description: 'Schätzung' },
    points: { type: 'integer', description: 'Punkte' },
    done_flag: { type: 'boolean', description: 'Flag' },
    note: { type: 'string', description: 'Notiz' },
    blob: { type: 'json', description: 'Beliebig' },
    area: { type: 'enum', values: ['a', 'b'], description: 'Bereich' },
  },
});

const hasK: PropFilter = { key: 'k', op: 'has' };

describe('checkProps', () => {
  test.each([
    [{ severity: 'urgent' }, 'severity'],
    [{ estimate_h: '4' }, 'estimate_h'],
    [{ estimate_h: Number.POSITIVE_INFINITY }, 'estimate_h'],
    [{ points: 1.5 }, 'points'],
    [{ done_flag: 'yes' }, 'done_flag'],
    [{ note: 3 }, 'note'],
    [{ area: 1 }, 'area'],
  ])('declared types reject %o', (touched, key) =>
    expect(catchErr(() => checkProps(config, touched)).details).toEqual({ reason: 'prop', key }),
  );

  test('the error is a validation error naming the key', () => {
    const err = catchErr(() => checkProps(config, { points: 'x' }));
    expect(err.code).toBe('validation');
    expect(err.message).toContain('points');
  });

  test('valid values pass', () =>
    expect(() =>
      checkProps(config, {
        severity: 'high',
        estimate_h: 4.5,
        points: 3,
        done_flag: false,
        note: 'x',
        blob: { a: [1, 'b'] },
        area: 'a',
      }),
    ).not.toThrow());

  test('null removes a declared key without a type check', () =>
    expect(() => checkProps(config, { severity: null })).not.toThrow());

  test('only touched keys are checked', () =>
    expect(() => checkProps(config, { other: 1 })).not.toThrow());

  test('props_strict rejects undeclared keys', () =>
    expect(
      catchErr(() => checkProps({ ...config, props_strict: true }, { other: 1 })).details,
    ).toEqual({ reason: 'prop', key: 'other' }));

  test('props_strict still allows removing an undeclared key', () =>
    expect(() => checkProps({ ...config, props_strict: true }, { other: null })).not.toThrow());
});

describe('parsePropAssignment', () => {
  test('k=v yields a string, possibly empty', () => {
    expect(parsePropAssignment('github.issue=42')).toEqual(['github.issue', '42']);
    expect(parsePropAssignment('k=')).toEqual(['k', '']);
    expect(parsePropAssignment('k=a=b')).toEqual(['k', 'a=b']);
  });

  test('k:=json yields the parsed value', () => {
    expect(parsePropAssignment('estimate_h:=4')).toEqual(['estimate_h', 4]);
    expect(parsePropAssignment('tags:=["sso","auth"]')).toEqual(['tags', ['sso', 'auth']]);
    expect(parsePropAssignment('k:=true')).toEqual(['k', true]);
    expect(parsePropAssignment('k:={"a":{"b":[1]}}')).toEqual(['k', { a: { b: [1] } }]);
  });

  test.each([
    'k:=1e999',
    'k:=-0',
    'k:=null',
    'k:=[1,null]',
    'k:={"a":null}',
    'k:=[-0]',
    'k:=[1e999]',
    'k:={"__proto__":1}',
    'k:={"a":{"__proto__":1}}',
    'k:=[{"__proto__":{}}]',
    'K=1',
    'k:={',
    'k>=1',
    'nokey',
  ])('rejects %s', (expr) => expect(catchErr(() => parsePropAssignment(expr)).code).toBe('usage'));

  test('the key appears in the message', () =>
    expect(catchErr(() => parsePropAssignment('mykey:=null')).message).toContain('mykey'));
});

describe('parsePropFilter', () => {
  test('k=a,b lists string alternatives', () =>
    expect(parsePropFilter('k=a,b')).toEqual({ key: 'k', op: 'eq', values: ['a', 'b'] }));

  test('k:=json carries exactly one parsed value, commas included', () =>
    expect(parsePropFilter('k:="a,b"')).toEqual({ key: 'k', op: 'eq', values: ['a,b'] }));

  test('k:=json rejects invalid values', () =>
    expect(catchErr(() => parsePropFilter('k:=null')).code).toBe('usage'));

  test('>= and <= parse numbers when possible', () => {
    expect(parsePropFilter('k>=3')).toEqual({ key: 'k', op: 'ge', value: 3 });
    expect(parsePropFilter('k<=2.5')).toEqual({ key: 'k', op: 'le', value: 2.5 });
    expect(parsePropFilter('k>=medium')).toEqual({ key: 'k', op: 'ge', value: 'medium' });
    expect(parsePropFilter('k>=')).toEqual({ key: 'k', op: 'ge', value: '' });
    expect(parsePropFilter('k>=1e999')).toEqual({ key: 'k', op: 'ge', value: '1e999' });
  });

  test('invalid expressions are usage errors', () => {
    expect(catchErr(() => parsePropFilter('K=1')).code).toBe('usage');
    expect(catchErr(() => parsePropFilter('k')).code).toBe('usage');
  });
});

describe('propMatches', () => {
  test('ordered enum range filter', () => {
    const ge = parsePropFilter('severity>=medium');
    const le = parsePropFilter('severity<=medium');
    const vals = ['critical', 'medium', 'low', 'bogus'];
    expect(vals.map((v) => propMatches({ severity: v }, ge, config))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(vals.map((v) => propMatches({ severity: v }, le, config))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  test('numeric range on declared and undeclared keys; non-numbers never match', () => {
    const ge = parsePropFilter('estimate_h>=4');
    expect([3, 4, 5, '5', true].map((v) => propMatches({ estimate_h: v }, ge, config))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
    const le = parsePropFilter('free<=2');
    expect([1, 2, 3, 'x'].map((v) => propMatches({ free: v }, le, config))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  test('a range filter with a non-numeric value never matches an undeclared key', () =>
    expect(propMatches({ free: 5 }, parsePropFilter('free>=x'), config)).toBe(false));

  test('missing props never match a range, eq or has filter', () => {
    expect(propMatches(undefined, parsePropFilter('estimate_h>=1'), config)).toBe(false);
    expect(propMatches({}, parsePropFilter('k=a'), config)).toBe(false);
    expect(propMatches(undefined, hasK, config)).toBe(false);
  });

  test('eq compares the JSON form, strings exactly', () => {
    const f = parsePropFilter('estimate_h=4');
    expect([4, '4', 4.5].map((v) => propMatches({ estimate_h: v }, f, config))).toEqual([
      true,
      true,
      false,
    ]);
    expect(propMatches({ k: 'a' }, parsePropFilter('k=A'), config)).toBe(false);
    expect(propMatches({ k: true }, parsePropFilter('k=true'), config)).toBe(true);
  });

  test('k=a,b matches one of the values', () => {
    const f = parsePropFilter('k=a,b');
    expect(['a', 'b', 'c'].map((v) => propMatches({ k: v }, f, config))).toEqual([
      true,
      true,
      false,
    ]);
  });

  test('a comma inside a value needs the JSON form', () => {
    const f = parsePropFilter('k:="a,b"');
    expect(propMatches({ k: 'a,b' }, f, config)).toBe(true);
    expect(propMatches({ k: 'a' }, f, config)).toBe(false);
  });

  test('a := filter compares structurally', () => {
    const f = parsePropFilter('k:={"a":[1,2],"b":true}');
    expect(propMatches({ k: { b: true, a: [1, 2] } }, f, config)).toBe(true);
    expect(propMatches({ k: { a: [1, 2] } }, f, config)).toBe(false);
    expect(propMatches({ k: { a: [1, 3], b: true } }, f, config)).toBe(false);
    expect(propMatches({ k: [1] }, parsePropFilter('k:={"0":1}'), config)).toBe(false);
    expect(propMatches({ k: 4 }, parsePropFilter('k:=4'), config)).toBe(true);
    expect(propMatches({ k: '4' }, parsePropFilter('k:=4'), config)).toBe(false);
    expect(propMatches({ k: [1, 2] }, parsePropFilter('k:=[1,2]'), config)).toBe(true);
    expect(propMatches({ k: [1, 2] }, parsePropFilter('k:=[1,2,3]'), config)).toBe(false);
  });

  test('has matches a present key', () => {
    expect(propMatches({ k: 0 }, hasK, config)).toBe(true);
    expect(propMatches({ j: 0 }, hasK, config)).toBe(false);
  });
});

describe('checkPropFilter', () => {
  test('rejects >= on an unordered enum', () =>
    expect(catchErr(() => checkPropFilter(parsePropFilter('area>=a'), config)).code).toBe('usage'));

  test('rejects ranges on string, boolean and json declarations', () => {
    for (const key of ['note', 'done_flag', 'blob'])
      expect(catchErr(() => checkPropFilter(parsePropFilter(`${key}>=1`), config)).code).toBe(
        'usage',
      );
  });

  test('rejects an ordered enum range with an unknown value', () =>
    expect(catchErr(() => checkPropFilter(parsePropFilter('severity>=urgent'), config)).code).toBe(
      'usage',
    ));

  test('rejects a non-numeric value on numeric and undeclared keys', () => {
    expect(catchErr(() => checkPropFilter(parsePropFilter('points>=x'), config)).code).toBe(
      'usage',
    );
    expect(catchErr(() => checkPropFilter(parsePropFilter('free>=x'), config)).code).toBe('usage');
  });

  test('accepts valid range, eq and has filters', () => {
    for (const e of ['severity>=medium', 'points<=3', 'estimate_h>=1.5', 'free>=2', 'k=a'])
      expect(() => checkPropFilter(parsePropFilter(e), config)).not.toThrow();
    expect(() => checkPropFilter(hasK, config)).not.toThrow();
  });
});

describe('propViolations', () => {
  test('reports an issue whose value no longer fits a tightened declaration', () => {
    const tightened = cfg({
      props: {
        severity: {
          type: 'enum',
          values: ['high', 'medium', 'low'],
          ordered: true,
          description: 'Schwere',
        },
      },
    });
    const s = snap({
      config: tightened,
      issues: [
        { id: I(2), props: { severity: 'critical', other: 1 } },
        { id: I(1), props: { severity: 'low' } },
      ],
    });
    const found = propViolations(s);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: I(2), key: 'severity' });
    expect(found[0]?.message).toContain('severity');
  });

  test('props_strict reports undeclared keys, ordered by id then key', () => {
    const s = snap({
      config: { props_strict: true },
      issues: [{ id: I(2), props: { b: 1, a: 1 } }, { id: I(1), props: { z: 1 } }, { id: I(3) }],
    });
    expect(propViolations(s).map((v) => `${v.id}:${v.key}`)).toEqual([
      `${I(1)}:z`,
      `${I(2)}:a`,
      `${I(2)}:b`,
    ]);
  });
});

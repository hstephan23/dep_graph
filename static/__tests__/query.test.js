/**
 * Tests for query.js — the query parser and regex utilities.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, setupDOM } from './helpers.js';

before(() => {
  setupDOM();
  loadModules('state.js', 'query.js');
});

// ----------------------------------------------------------------
// _escapeRegex
// ----------------------------------------------------------------
describe('_escapeRegex', () => {
  it('escapes all regex metacharacters', () => {
    const input = 'file.name+foo*bar?[baz]';
    const escaped = globalThis._escapeRegex(input);
    const re = new RegExp(escaped);
    assert.ok(re.test(input));
    assert.ok(!re.test('fileXname'));
  });

  it('returns plain strings unchanged', () => {
    assert.equal(globalThis._escapeRegex('hello'), 'hello');
  });
});

// ----------------------------------------------------------------
// _tryParseRegex
// ----------------------------------------------------------------
describe('_tryParseRegex', () => {
  it('parses explicit /regex/flags syntax', () => {
    const result = globalThis._tryParseRegex('/foo\\.js$/i');
    assert.equal(result.error, undefined);
    assert.ok(result.regex instanceof RegExp);
    assert.ok(result.regex.test('bar/foo.js'));
    assert.ok(!result.regex.test('foo.ts'));
  });

  it('returns error for invalid explicit regex', () => {
    const result = globalThis._tryParseRegex('/[invalid/');
    assert.ok(result.error);
    assert.ok(result.error.includes('Invalid regex'));
  });

  it('treats strings with regex chars as regex', () => {
    const result = globalThis._tryParseRegex('.*Controller.*');
    assert.ok(result.regex.test('UserController.ts'));
    assert.ok(!result.regex.test('model.ts'));
  });

  it('treats plain strings as case-insensitive substring match', () => {
    const result = globalThis._tryParseRegex('utils');
    assert.ok(result.regex.test('src/Utils.js'));
    assert.ok(!result.regex.test('src/helpers.js'));
  });
});

// ----------------------------------------------------------------
// parseQuery — top-level query types
// ----------------------------------------------------------------
describe('parseQuery', () => {
  it('parses "files in cycles"', () => {
    assert.equal(globalThis.parseQuery('files in cycles').type, 'cycles');
  });

  it('parses "file in cycle" (singular)', () => {
    assert.equal(globalThis.parseQuery('file in cycle').type, 'cycles');
  });

  it('parses "files with no downstream"', () => {
    assert.equal(globalThis.parseQuery('files with no downstream').type, 'no_downstream');
  });

  it('parses "files with no inbound"', () => {
    assert.equal(globalThis.parseQuery('files with no inbound').type, 'no_downstream');
  });

  it('parses "files with no upstream"', () => {
    assert.equal(globalThis.parseQuery('files with no upstream').type, 'no_upstream');
  });

  it('parses "files with no outbound"', () => {
    assert.equal(globalThis.parseQuery('files with no outbound').type, 'no_upstream');
  });

  it('parses "files matching <pattern>"', () => {
    const q = globalThis.parseQuery('files matching .*test.*');
    assert.equal(q.type, 'matching');
    assert.ok(q.regex.test('my_test_file.js'));
  });

  it('parses "files matching /regex/"', () => {
    const q = globalThis.parseQuery('files matching /\\.tsx$/');
    assert.equal(q.type, 'matching');
    assert.ok(q.regex.test('App.tsx'));
    assert.ok(!q.regex.test('App.ts'));
  });

  it('returns error for invalid regex in matching', () => {
    const q = globalThis.parseQuery('files matching /[bad/');
    assert.equal(q.type, 'error');
    assert.ok(q.message.includes('Invalid regex'));
  });

  it('parses "files in <directory>"', () => {
    const q = globalThis.parseQuery('files in src/components');
    assert.equal(q.type, 'in_dir');
    assert.equal(q.dir, 'src/components');
  });

  it('parses "files where <conditions>"', () => {
    const q = globalThis.parseQuery('files where inbound > 5');
    assert.equal(q.type, 'where');
    assert.equal(q.conditions.length, 1);
    assert.deepEqual(q.conditions[0], { type: 'metric', metric: 'inbound', op: '>', value: 5 });
  });

  it('parses bare metric conditions', () => {
    const q = globalThis.parseQuery('outbound >= 10');
    assert.equal(q.type, 'where');
    assert.equal(q.conditions[0].metric, 'outbound');
    assert.equal(q.conditions[0].op, '>=');
    assert.equal(q.conditions[0].value, 10);
  });

  it('returns error for unrecognized query', () => {
    assert.equal(globalThis.parseQuery('something random').type, 'error');
  });
});

// ----------------------------------------------------------------
// parseWhereConditions — compound conditions
// ----------------------------------------------------------------
describe('parseWhereConditions', () => {
  it('parses single metric condition', () => {
    const q = globalThis.parseWhereConditions('inbound > 3');
    assert.equal(q.type, 'where');
    assert.equal(q.conditions.length, 1);
    assert.deepEqual(q.conditions[0], { type: 'metric', metric: 'inbound', op: '>', value: 3 });
  });

  it('parses multiple AND conditions', () => {
    const q = globalThis.parseWhereConditions('inbound > 3 and outbound < 10');
    assert.equal(q.type, 'where');
    assert.equal(q.conditions.length, 2);
    assert.equal(q.conditions[0].metric, 'inbound');
    assert.equal(q.conditions[1].metric, 'outbound');
  });

  it('supports all comparison operators', () => {
    for (const op of ['>', '<', '>=', '<=', '=', '!=']) {
      const q = globalThis.parseWhereConditions(`depth ${op} 5`);
      assert.equal(q.conditions[0].op, op);
    }
  });

  it('supports "in cycles" as a condition', () => {
    const q = globalThis.parseWhereConditions('in cycles');
    assert.equal(q.conditions.length, 1);
    assert.equal(q.conditions[0].type, 'in_cycles');
  });

  it('supports "name matching <pattern>" condition', () => {
    const q = globalThis.parseWhereConditions('name matching .*Controller.*');
    assert.equal(q.conditions.length, 1);
    assert.equal(q.conditions[0].type, 'name');
    assert.ok(q.conditions[0].regex.test('UserController.ts'));
  });

  it('supports compound: metric AND name matching AND in cycles', () => {
    const q = globalThis.parseWhereConditions('inbound > 2 and name matching /utils/ and in cycles');
    assert.equal(q.conditions.length, 3);
    assert.equal(q.conditions[0].type, 'metric');
    assert.equal(q.conditions[1].type, 'name');
    assert.equal(q.conditions[2].type, 'in_cycles');
  });

  it('returns error for invalid condition', () => {
    const q = globalThis.parseWhereConditions('nonsense blah');
    assert.equal(q.type, 'error');
    assert.ok(q.message.includes('Invalid condition'));
  });

  it('supports stability metric with float value', () => {
    const q = globalThis.parseWhereConditions('stability > 0.7');
    assert.deepEqual(q.conditions[0], { type: 'metric', metric: 'stability', op: '>', value: 0.7 });
  });
});

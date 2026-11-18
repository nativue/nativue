// node test/statements.test.mjs
import assert from 'node:assert/strict'
import { splitStatements } from '../src/statements.ts'

assert.deepEqual(splitStatements('CREATE TABLE a (x); INSERT INTO a VALUES (1);\n'), [
  'CREATE TABLE a (x)',
  'INSERT INTO a VALUES (1)',
])

assert.deepEqual(
  splitStatements(`INSERT INTO a VALUES ('x;y', 'it''s;'); SELECT "b;c" FROM [d;e]`),
  [`INSERT INTO a VALUES ('x;y', 'it''s;')`, 'SELECT "b;c" FROM [d;e]'],
)

assert.deepEqual(splitStatements('SELECT 1; -- a; comment\nSELECT 2 /* ; */;'), [
  'SELECT 1',
  '-- a; comment\nSELECT 2 /* ; */',
])

const trigger = `CREATE TEMP TRIGGER t AFTER INSERT ON a BEGIN
  UPDATE b SET n = n + 1;
  DELETE FROM c;
END`
assert.deepEqual(splitStatements(`${trigger}; SELECT 1`), [trigger, 'SELECT 1'])

assert.deepEqual(splitStatements('  ;; '), [])

console.log('ok - splitStatements')

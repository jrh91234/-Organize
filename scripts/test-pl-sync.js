// Checks the employee copy to the Department P&L Database against in-memory Apps Script stand-ins.
// Run: node scripts/test-pl-sync.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'scr', 'backend.gs'), 'utf8');
const PL_ID = '1ZZKFLPCjv06TxUmtcMlZ7pvVZvyDpkZmM8FIWNq3xZQ';
const MAIN_ID = '1LxRYOtg0LL6_VSuNsaNuNuBUHal_T4eOYgy4tOrHNfE';

function fakeSheet(name, rows = []) {
  const grid = rows.map(r => r.slice());
  const sheet = {
    name, grid, frozen: 0, formats: new Set(),
    getLastRow: () => grid.length,
    getMaxColumns: () => 20,
    getDataRange: () => sheet.getRange(1, 1, Math.max(1, grid.length), Math.max(1, ...grid.map(r => r.length))),
    appendRow: row => { grid.push(row.slice()); },
    setFrozenRows: n => { sheet.frozen = n; },
    getRange(row, col, nRows = 1, nCols = 1) {
      const range = {
        getValues: () => Array.from({ length: nRows }, (_, i) => Array.from({ length: nCols }, (_, j) => (grid[row - 1 + i] || [])[col - 1 + j] ?? '')),
        setValues: values => { values.forEach((r, i) => r.forEach((v, j) => { (grid[row - 1 + i] ||= [])[col - 1 + j] = v; })); return range; },
        setValue: v => range.setValues([[v]]),
        getValue: () => range.getValues()[0][0],
        setNumberFormat: () => { sheet.formats.add(`${row},${col}`); return range; },
      };
      return range;
    },
  };
  return sheet;
}

function fakeSpreadsheet(sheets) {
  const map = new Map(sheets.map(s => [s.name, s]));
  return { sheets: map, getSheetByName: n => map.get(n) || null, insertSheet: n => { const s = fakeSheet(n); map.set(n, s); return s; } };
}

function load({ plSheets = [], failPl = false, orgData = [] } = {}) {
  const spreadsheets = {
    [MAIN_ID]: fakeSpreadsheet([fakeSheet('Data', [['Key', 'Value'], ['orgData', 'FILE_ID:file1']]), fakeSheet('Logs', [['Timestamp']])]),
    [PL_ID]: fakeSpreadsheet(plSheets),
  };
  const files = { file1: JSON.stringify(orgData) };
  const context = vm.createContext({
    console: { error() {}, log() {} },
    SpreadsheetApp: { openById: id => { if (failPl && id === PL_ID) throw new Error('No access'); return spreadsheets[id]; } },
    DriveApp: {
      getFileById: id => ({ getBlob: () => ({ getDataAsString: () => files[id] }), setContent: c => { files[id] = c; } }),
      getFolderById: () => ({ getFilesByName: () => ({ hasNext: () => false }), createFile: () => ({ getId: () => 'new' }) }),
    },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: () => 'stamp' }, Session: { getScriptTimeZone: () => 'Asia/Bangkok' }, MimeType: { PLAIN_TEXT: 'text' },
    Date, JSON, String, Array, Set, Map, Object, Error,
  });
  vm.runInContext(source, context);
  const call = code => vm.runInContext(code, context);
  return { context, spreadsheets, files, call, pl: () => spreadsheets[PL_ID].sheets.get('Employees') };
}

const emp = (id, extra = {}) => ({ id, name: 'Name ' + id, dept: 'H9', subDept: 'Line 1', shift: 'Day', position: 'Operator', type: 'Permanent', company: 'A', status: 'Active', startDate: '2026-10-01', exitDate: '', phone: '081-000-0000', image: 'data:...', lastModified: 'v1', ...extra });
const run = (env, updates, deletes = [], renames = []) => { env.context.__args = { updates, deletes, renames }; return env.call('syncEmployeesToPlSheet_(__args.updates, __args.deletes, __args.renames)'); };

test('first add creates the Employees tab with headers and one row, without private fields', () => {
  const env = load();
  run(env, [emp('60001')]);
  const grid = env.pl().grid;
  assert.equal(JSON.stringify(grid[0]), JSON.stringify(vm.runInContext('PL_EMPLOYEE_HEADERS', env.context)));
  assert.equal(grid.length, 2);
  assert.equal(JSON.stringify(grid[1].slice(0, 11)), JSON.stringify(['60001', 'Name 60001', 'H9', 'Line 1', 'Day', 'Operator', 'Permanent', 'A', 'Active', '2026-10-01', '']));
  assert.ok(!JSON.stringify(grid).includes('081-000-0000') && !JSON.stringify(grid).includes('data:...'));
  assert.equal(env.pl().frozen, 1);
});

test('editing or resigning updates the same row; a new employee is appended', () => {
  const env = load();
  run(env, [emp('60001'), emp('60002')]);
  run(env, [emp('60001', { position: 'Leader' }), emp('60002', { status: 'Resigned', exitDate: '2026-10-14' }), emp('60003')]);
  const grid = env.pl().grid;
  assert.equal(grid.length, 4);
  assert.equal(grid[1][5], 'Leader');
  assert.equal(JSON.stringify([grid[2][8], grid[2][10]]), JSON.stringify(['Resigned', '2026-10-14']));
  assert.equal(grid[3][0], '60003');
});

test('deleted employees stay with status Deleted; unknown ids are ignored', () => {
  const env = load();
  run(env, [emp('60001')]);
  run(env, [], ['60001', '99999']);
  const grid = env.pl().grid;
  assert.equal(grid.length, 2);
  assert.equal(grid[1][8], 'Deleted');
});

test('a renamed id keeps its row and the upsert updates it in place', () => {
  const env = load();
  run(env, [emp('60001')]);
  run(env, [emp('70001', { name: 'Renamed' })], [], [{ fromId: '60001', toId: '70001' }]);
  const grid = env.pl().grid;
  assert.equal(grid.length, 2);
  assert.equal(JSON.stringify([grid[1][0], grid[1][1]]), JSON.stringify(['70001', 'Renamed']));
});

test('ids are written as text so leading zeros survive', () => {
  const env = load();
  run(env, [emp('00123')]);
  assert.equal(env.pl().grid[1][0], '00123');
  assert.ok(env.pl().formats.size > 0);
});

test('a tab with another layout is never overwritten', () => {
  const env = load({ plSheets: [fakeSheet('Employees', [['something', 'else'], ['keep', 'me']])] });
  assert.throws(() => run(env, [emp('60001')]), /different header/);
  assert.equal(JSON.stringify(env.pl().grid), JSON.stringify([['something', 'else'], ['keep', 'me']]));
});

test('whole-roster sync updates everyone and marks people missing from the list as Deleted', () => {
  const env = load();
  run(env, [emp('1'), emp('2'), emp('3')]);
  env.context.__list = [emp('1', { position: 'Boss' }), emp('4')];
  env.call('syncAllEmployeesToPlSheet_(__list)');
  const byId = Object.fromEntries(env.pl().grid.slice(1).map(r => [r[0], r]));
  assert.equal(byId['1'][5], 'Boss');
  assert.equal(byId['2'][8], 'Deleted');
  assert.equal(byId['3'][8], 'Deleted');
  assert.equal(byId['4'][8], 'Active');
});

test('saving an employee through updateEmployees copies it to the P&L sheet and reports ok', () => {
  const env = load({ orgData: [emp('60001', { lastModified: 'v1' })] });
  env.context.__data = { updates: [emp('60002')], baseVersions: { 60002: '' }, deletes: [], renames: [] };
  const response = JSON.parse(env.call('batchUpdateEmployees(__data).text'));
  assert.equal(response.status, 'success');
  assert.equal(response.plSync, 'ok');
  assert.equal(JSON.parse(env.files.file1).length, 2);
  assert.equal(env.pl().grid[1][0], '60002');
});

test('if the P&L sheet cannot be written the save still succeeds and the failure is logged', () => {
  const env = load({ failPl: true, orgData: [] });
  env.context.__data = { updates: [emp('60001')], baseVersions: { 60001: '' }, deletes: [], renames: [] };
  const response = JSON.parse(env.call('batchUpdateEmployees(__data).text'));
  assert.equal(response.status, 'success');
  assert.match(response.plSync, /^failed: .*No access/);
  assert.equal(JSON.parse(env.files.file1).length, 1);
  const logs = env.spreadsheets[MAIN_ID].sheets.get('Logs').grid;
  assert.equal(logs[logs.length - 1][5], 'plSyncFailed');
});

test('an empty spreadsheet id switches the copy off', () => {
  const env = load();
  env.call("PL_SYNC.SPREADSHEET_ID = ''");
  env.context.__data = { updates: [emp('60001')], baseVersions: { 60001: '' }, deletes: [], renames: [] };
  const response = JSON.parse(env.call('batchUpdateEmployees(__data).text'));
  assert.equal(response.plSync, 'off');
  assert.equal(env.pl(), undefined);
});

test('a version conflict stops before anything is copied', () => {
  const env = load({ orgData: [emp('60001', { lastModified: 'v2' })] });
  env.context.__data = { updates: [emp('60001', { name: 'Stale' })], baseVersions: { 60001: 'v1' }, deletes: [], renames: [] };
  const response = JSON.parse(env.call('batchUpdateEmployees(__data).text'));
  assert.equal(response.status, 'conflict');
  assert.equal(env.pl(), undefined);
});

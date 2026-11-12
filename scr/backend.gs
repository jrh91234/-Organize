/**
 * HR Auto Organize - Backend Script (Version: V25 Verified Stable & Enhanced Logging)
 */
const CONFIG = {
  SPREADSHEET_ID: "1LxRYOtg0LL6_VSuNsaNuNuBUHal_T4eOYgy4tOrHNfE", 
  FOLDER_ID: "1K8g9ta30-ERitMBt_tGT2wr1ubtrv3df"
};

// Copy of the employee roster for the Department P&L Database (repo: department-pl-business-plan).
// Leave SPREADSHEET_ID empty to switch the copy off. See docs/pl-sheet-sync.md.
const PL_SYNC = {
  SPREADSHEET_ID: "1ZZKFLPCjv06TxUmtcMlZ7pvVZvyDpkZmM8FIWNq3xZQ",
  SHEET_NAME: "Employees"
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  // ป้องกันการยิงซ้ำซ้อนภายใน 30 วินาที
  if (!lock.tryLock(30000)) return createJSONOutput({ status: 'error', message: 'Server busy' });
  
  try {
    if (!e || !e.postData) return createJSONOutput({ status: 'error', message: 'No data received' });
    const data = JSON.parse(e.postData.contents);

    // [VERIFIED] จัดการการอัปโหลดไฟล์รูปภาพให้อยู่บนสุดเหมือนต้นฉบับ
    if (data.action === 'upload' || (data.file && data.mimetype)) return handleImageUpload(data);

    // [VERIFIED & IMPROVED] การดึงข้อมูล Executor (ผู้ดำเนินการ) แบบรัดกุม
    let executor = { username: 'System', name: '-', role: '-', dept: '-' };
    if (data.executor && typeof data.executor === 'object') {
        executor = {
            username: data.executor.username || 'System',
            name: data.executor.name || '-',
            role: data.executor.role || '-',
            dept: data.executor.dept || '-'
        };
    } else if (data.userContext) {
        // Fallback รองรับ Request จากหน้าบ้านแบบเก่า
        executor.username = data.userContext;
    }

    // [VERIFIED] Logging แบบใหม่ บันทึกละเอียดขึ้น ไม่บันทึกการ Read data
    if (data.action !== 'getData' && data.action !== 'getUsers' && data.action !== 'getAttendance' && data.action !== 'getAttendanceCounts' && data.action !== 'translateText' && data.action !== 'getSkillMatrix') {
      let detailStr = data.logDetail || '';
      
      // กรณี Update/Delete ให้บันทึกรายละเอียดพนักงานที่ถูกแก้ไข (ชื่อ, รหัส, แผนก, ตำแหน่ง)
      if (data.action === 'updateEmployees') {
        let updateList = (data.updates || []).map(emp => `[รหัส: ${emp.id}, ชื่อ: ${emp.name}, แผนก: ${emp.dept || '-'}, ตำแหน่ง: ${emp.position || '-'}]`);
        let deleteList = (data.deletes || []).map(id => `[รหัส: ${id}]`);
        
        detailStr = "";
        if (updateList.length > 0) detailStr += `แก้ไข/เพิ่ม: ${updateList.join(', ')} `;
        if (deleteList.length > 0) detailStr += `ลบ: ${deleteList.join(', ')}`;
        if (detailStr === "") detailStr = "ไม่มีการเปลี่ยนแปลง";
        
      } else if (data.action === 'saveUser' && data.user) {
        detailStr = `เพิ่ม/แก้ไขสิทธิ์: [User: ${data.user.username}, ชื่อ: ${data.user.name}, Role: ${data.user.role}, Dept: ${data.user.dept || 'ALL'}]`;
      } else if (data.action === 'deleteUser') {
        detailStr = `ลบสิทธิ์: [User: ${data.username}]`;
      } else if (data.action === 'recordAttendance') {
        detailStr = `เช็คชื่อ: ${data.type === 'ot' ? 'เริ่ม OT' : 'เข้างาน'}`;
      } else if (data.action === 'recordAttendanceBatch') {
        detailStr = `เช็คชื่อ ${Array.isArray(data.items) ? data.items.length : 0} รายการ${data.workDate ? ` · ย้อนหลังรอบวันที่ ${data.workDate} เวลา ${data.time || '08:00'}` : ''}`;
      } else if (data.action === 'saveSkillLevels') {
        detailStr = `Skill Matrix: บันทึกระดับทักษะ ${Array.isArray(data.items) ? data.items.length : 0} รายการ`;
      } else if (data.action === 'saveSkillCatalog') {
        detailStr = `Skill Matrix: รายการทักษะ ${data.dept || '-'} (${(Array.isArray(data.scopes) ? data.scopes : []).map(s => (s.subDept || 'ทั้งแผนก') + ' ' + ((s.skills || []).length) + ' ทักษะ').join(', ')})`;
      } else if (data.action === 'saveSkillMatrixDoc') {
        detailStr = `Skill Matrix: หัวเอกสาร ${(data.doc && data.doc.dept) || '-'} / ${(data.doc && data.doc.subDept) || 'ทั้งแผนก'} Rev.${(data.doc && data.doc.rev) || '-'}`;
      } else if (!detailStr && (data.user || data.updates)) {
        // Fallback ใส่รายละเอียดเท่าที่มี
        detailStr = JSON.stringify(data.user || data.updates || {});
      }
      
      saveLog(executor, data.action, detailStr);
    }

    // Routing การทำงาน
    switch (data.action) {
      case 'login': return loginUser(data);
      case 'getUsers': return getUsers();
      case 'saveUser': return saveUser(data);
      case 'deleteUser': return deleteUser(data);
      case 'updateEmployees': return batchUpdateEmployees(data);
      case 'saveData': return saveData(data);
      case 'getData': return getData();
      case 'getAttendance': return getAttendance(data);
      case 'getAttendanceCounts': return getAttendanceCounts();
      case 'translateText': return translateText(data);
      case 'recordAttendance': return recordAttendance(data);
      case 'recordAttendanceBatch': return recordAttendanceBatch(data);
      case 'recoverOrgData': return recoverOrgData(data);
      case 'getSkillMatrix': return getSkillMatrix();
      case 'saveSkillCatalog': return saveSkillCatalog(data);
      case 'saveSkillLevels': return saveSkillLevels(data);
      case 'saveSkillMatrixDoc': return saveSkillMatrixDoc(data);
      default: return createJSONOutput({ status: 'error', message: 'Unknown action' });
    }
  } catch (error) {
    return createJSONOutput({ status: 'error', error: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

// --- IMPROVED LOGGING ---
function saveLog(executor, action, detail) {
  try {
    const sheet = getSheet('Logs');
    // โครงสร้างคอลัมน์: [Timestamp, Username, Name, Role, Department, Action, Detail]
    sheet.appendRow([
      new Date(), 
      executor.username, 
      executor.name, 
      executor.role, 
      executor.dept, 
      action, 
      typeof detail === 'object' ? JSON.stringify(detail) : detail
    ]);
  } catch(e) {
    console.error("Failed to write log: " + e.toString());
  }
}

// --- CORE FUNCTIONS (Original Logic Preserved) ---
function batchUpdateEmployees(data) {
  const sheet = getSheet('Data');
  const rows = sheet.getDataRange().getValues();
  let fileId = null;
  
  // หาวิธีเก็บ orgData แบบไฟล์ใน Google Drive
  for(let i=1; i<rows.length; i++) { 
    if(rows[i][0] === 'orgData' && String(rows[i][1]).startsWith('FILE_ID:')) { 
      fileId = String(rows[i][1]).split('FILE_ID:')[1];
      break; 
    } 
  }

  let currentData = [];
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  
  if (fileId) {
    try {
      currentData = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
    } catch(e) {
      return createJSONOutput({ status: 'error', message: 'Failed to read current data from Drive. Aborting to prevent data loss: ' + e.toString() });
    }
  }

  const deletes = Array.isArray(data.deletes) ? data.deletes : [];
  const updates = Array.isArray(data.updates) ? data.updates : [];
  const baseVersions = data.baseVersions && typeof data.baseVersions === 'object' ? data.baseVersions : null;
  const renames = Array.isArray(data.renames) ? data.renames : [];
  const currentMap = new Map(currentData.map(item => [String(item.id), item]));
  const conflicts = [];
  const checkedIds = new Set();
  const renamedTargets = new Set();

  const hasBaseVersion = (id) => baseVersions && Object.prototype.hasOwnProperty.call(baseVersions, String(id));
  const expectedVersion = (id) => normalizeVersion_(baseVersions[String(id)]);
  const actualVersion = (id) => {
    const current = currentMap.get(String(id));
    return normalizeVersion_(current && current.lastModified);
  };
  const addConflict = (id, reason, expected, actual) => {
    conflicts.push({ id: String(id), reason, expected: expected || '', actual: actual || '' });
  };

  // Check every affected record against the version the client originally loaded.
  // This prevents a stale client from silently overwriting a newer cloud change.
  if ((deletes.length > 0 || updates.length > 0) && !baseVersions) {
    return createJSONOutput({
      status: 'conflict',
      message: 'This client does not support conflict detection. Please reload the page and try again.',
      conflicts: [{ id: '*', reason: 'missing-client-version' }]
    });
  }

  renames.forEach(rename => {
    const fromId = rename && rename.fromId;
    const toId = rename && rename.toId;
    if (fromId === null || fromId === undefined || toId === null || toId === undefined) return;

    const fromKey = String(fromId);
    const toKey = String(toId);
    checkedIds.add(fromKey);
    renamedTargets.add(toKey);

    if (!hasBaseVersion(fromId)) {
      addConflict(fromId, 'missing-base-version');
    } else if (expectedVersion(fromId) !== actualVersion(fromId)) {
      addConflict(fromId, 'stale-record', expectedVersion(fromId), actualVersion(fromId));
    }

    if (fromKey !== toKey && currentMap.has(toKey)) {
      addConflict(toId, 'id-already-exists', '', actualVersion(toId));
    }
  });

  deletes.forEach(id => {
    const key = String(id);
    if (checkedIds.has(key)) return;
    checkedIds.add(key);
    if (!hasBaseVersion(id)) {
      addConflict(id, 'missing-base-version');
    } else if (expectedVersion(id) !== actualVersion(id)) {
      addConflict(id, 'stale-record', expectedVersion(id), actualVersion(id));
    }
  });

  updates.forEach(item => {
    if (!item || item.id === null || item.id === undefined) {
      addConflict('', 'invalid-record');
      return;
    }

    const key = String(item.id);
    // A renamed record is checked against its old ID above.
    if (renamedTargets.has(key)) return;
    if (!hasBaseVersion(item.id)) {
      addConflict(item.id, 'missing-base-version');
    } else if (expectedVersion(item.id) !== actualVersion(item.id)) {
      addConflict(item.id, 'stale-record', expectedVersion(item.id), actualVersion(item.id));
    }
  });

  if (conflicts.length > 0) {
    return createJSONOutput({
      status: 'conflict',
      message: 'ข้อมูลบางรายการถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง',
      conflicts
    });
  }

  if (deletes.length > 0) {
    const deleteSet = new Set(deletes.map(String));
    currentData = currentData.filter(emp => !deleteSet.has(String(emp.id))); 
  }
  
  if (updates.length > 0) {
    const dataMap = new Map(currentData.map(item => [String(item.id), item]));
    updates.forEach(item => dataMap.set(String(item.id), item));
    currentData = Array.from(dataMap.values()); 
  }

  const newContent = JSON.stringify(currentData);
  if (fileId) { 
    DriveApp.getFileById(fileId).setContent(newContent);
    normalizeOrgDataFileNames_(fileId);
  } else { 
    const file = folder.createFile("orgData.json", newContent, MimeType.PLAIN_TEXT); 
    upsertDataKey(sheet, 'orgData', 'FILE_ID:' + file.getId());
    normalizeOrgDataFileNames_(file.getId());
  }
  // The save above is already final; the P&L copy must never turn it into an error.
  const plSync = syncEmployeesToPlSheetSafely_(() => syncEmployeesToPlSheet_(updates, deletes, renames));
  return createJSONOutput({ status: 'success', message: 'Synced', plSync });
}

// --- Employee roster copy for the Department P&L Database ---
// One row per employee id in the "Employees" tab, kept in step with every add / edit / resign / delete / rename.
// Phone numbers, photos, colours and reporting lines are deliberately left out.
const PL_EMPLOYEE_HEADERS = ['รหัส','ชื่อ','แผนก','แผนกย่อย','กะ','ตำแหน่ง','ประเภท','บริษัท','สถานะ','วันที่เริ่มงาน','วันที่ออก','ซิงก์ล่าสุด'];
const PL_STATUS_COL = 9;
const PL_SYNCED_COL = 12;

function syncEmployeesToPlSheetSafely_(work) {
  if (!PL_SYNC.SPREADSHEET_ID) return 'off';
  try {
    work();
    return 'ok';
  } catch (e) {
    console.error('P&L employee sync failed: ' + e.toString());
    try { saveLog({ username: 'System', name: '-', role: '-', dept: '-' }, 'plSyncFailed', e.toString()); } catch (ignore) {}
    return 'failed: ' + e.toString();
  }
}

function getPlEmployeeSheet_() {
  const ss = SpreadsheetApp.openById(PL_SYNC.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PL_SYNC.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PL_SYNC.SHEET_NAME);
    sheet.getRange(1, 1, 1, PL_EMPLOYEE_HEADERS.length).setValues([PL_EMPLOYEE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  const header = sheet.getRange(1, 1, 1, PL_EMPLOYEE_HEADERS.length).getValues()[0];
  if (header.join('|') !== PL_EMPLOYEE_HEADERS.join('|')) {
    // A tab with another layout is somebody's data: stop instead of overwriting it.
    throw new Error('Tab "' + PL_SYNC.SHEET_NAME + '" has a different header row; refusing to write');
  }
  return sheet;
}

function plEmployeeRow_(emp, syncedAt) {
  const text = (v) => (v === null || v === undefined ? '' : String(v));
  return [
    text(emp.id), text(emp.name), text(emp.dept), text(emp.subDept), text(emp.shift), text(emp.position),
    text(emp.type), text(emp.company), text(emp.status), text(emp.startDate), text(emp.exitDate), syncedAt
  ];
}

// upserts: employee objects to add or update; deleteIds: ids removed from the org chart; renames: [{fromId, toId}].
// Deleted employees stay in the sheet with status "Deleted" so headcount history is not lost.
function syncEmployeesToPlSheet_(upserts, deleteIds, renames) {
  const adds = (Array.isArray(upserts) ? upserts : []).filter(e => e && e.id !== null && e.id !== undefined);
  const dels = (Array.isArray(deleteIds) ? deleteIds : []).map(String);
  const moves = (Array.isArray(renames) ? renames : []).filter(r => r && r.fromId !== null && r.fromId !== undefined && r.toId !== null && r.toId !== undefined);
  if (!adds.length && !dels.length && !moves.length) return;

  const sheet = getPlEmployeeSheet_();
  const cols = PL_EMPLOYEE_HEADERS.length;
  const syncedAt = new Date();
  const lastRow = sheet.getLastRow();
  const rowById = new Map();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 1).setNumberFormat('@');
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach((r, i) => { if (String(r[0]) !== '') rowById.set(String(r[0]), i + 2); });
  }

  // A renamed employee keeps their row: change the id first so the upsert below updates it in place.
  moves.forEach(m => {
    const from = String(m.fromId), to = String(m.toId), row = rowById.get(from);
    if (row && !rowById.has(to)) {
      sheet.getRange(row, 1).setNumberFormat('@').setValue(to);
      rowById.delete(from);
      rowById.set(to, row);
    }
  });

  const appended = [];
  adds.forEach(emp => {
    const values = plEmployeeRow_(emp, syncedAt), row = rowById.get(String(emp.id));
    if (row) sheet.getRange(row, 1, 1, cols).setNumberFormat('@').setValues([values]);
    else appended.push(values);
  });
  if (appended.length) {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, appended.length, 1).setNumberFormat('@');
    sheet.getRange(start, 1, appended.length, cols).setValues(appended);
  }

  dels.forEach(id => {
    const row = rowById.get(id);
    if (!row) return;
    sheet.getRange(row, PL_STATUS_COL).setValue('Deleted');
    sheet.getRange(row, PL_SYNCED_COL).setValue(syncedAt);
  });
}

// Whole-roster sync for imports and the first fill. Employees missing from the list are marked "Deleted".
function syncAllEmployeesToPlSheet_(employees) {
  const list = Array.isArray(employees) ? employees : [];
  const ids = new Set(list.map(e => String(e && e.id)));
  const sheet = getPlEmployeeSheet_();
  const lastRow = sheet.getLastRow();
  const missing = [];
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, PL_STATUS_COL).getValues().forEach(r => {
      if (String(r[0]) !== '' && !ids.has(String(r[0])) && r[PL_STATUS_COL - 1] !== 'Deleted') missing.push(String(r[0]));
    });
  }
  syncEmployeesToPlSheet_(list, missing, []);
}

// Run once from the Apps Script editor to copy every current employee into the P&L sheet.
function backfillEmployeesToPlSheet() {
  const sheet = getSheet('Data');
  const rows = sheet.getDataRange().getValues();
  let fileId = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === 'orgData' && String(rows[i][1]).startsWith('FILE_ID:')) fileId = String(rows[i][1]).split('FILE_ID:')[1];
  }
  if (!fileId) throw new Error('orgData file not found');
  const employees = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
  syncAllEmployeesToPlSheet_(employees);
  return 'Synced ' + employees.length + ' employees';
}

function normalizeVersion_(value) {
  return value === null || value === undefined ? '' : String(value);
}

function handleImageUpload(data) {
  try {
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    if (data.oldFileUrl) deleteFileByUrl(data.oldFileUrl);
    const blob = Utilities.newBlob(Utilities.base64Decode(data.file), data.mimetype, data.filename);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return createJSONOutput({ status: 'success', url: "https://lh3.googleusercontent.com/d/" + file.getId() });
  } catch (e) { 
    return createJSONOutput({ status: 'error', message: e.toString() }); 
  }
}

function deleteFileByUrl(url) { 
  try { 
    const idMatch = url.match(/[-\w]{25,}/); 
    if (idMatch) DriveApp.getFileById(idMatch[0]).setTrashed(true);
  } catch (e) {} 
}

// --- UTILS (Verified & Safely Handled) ---
function getSheet(name) { 
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); 
  let sheet = ss.getSheetByName(name);
  if (!sheet) { 
    sheet = ss.insertSheet(name); 
    if(name === 'Users') sheet.appendRow(['Username','Password','Name','Role','Department']); 
    if(name === 'Data') sheet.appendRow(['Key','Value']); 
    if(name === 'Logs') sheet.appendRow(['Timestamp','Username','Name','Role','Department','Action','Detail']);
    if(name === 'Attendance') sheet.appendRow(['WorkDate','Timestamp','Username','Name','Department','Type','CheckedByUsername','CheckedByName','SubDepartment','Position','RecordedAt']);
  }
  if (name === 'Attendance') {
    if (sheet.getMaxColumns() < 11) sheet.insertColumnsAfter(sheet.getMaxColumns(), 11 - sheet.getMaxColumns());
    if (sheet.getRange(1, 7, 1, 2).getValues()[0].join('|') !== 'CheckedByUsername|CheckedByName') {
      sheet.getRange(1, 7, 1, 2).setValues([['CheckedByUsername', 'CheckedByName']]);
    }
    if (sheet.getRange(1, 9).getValue() !== 'SubDepartment') sheet.getRange(1, 9).setValue('SubDepartment');
    if (sheet.getRange(1, 10).getValue() !== 'Position') sheet.getRange(1, 10).setValue('Position');
    if (sheet.getRange(1, 11).getValue() !== 'RecordedAt') sheet.getRange(1, 11).setValue('RecordedAt');
  }
  return sheet; 
}

function loginUser(data) { 
  const rows = getSheet('Users').getDataRange().getValues();
  for(let i=1; i<rows.length; i++){ 
    if(String(rows[i][0]) === String(data.username) && String(rows[i][1]) === String(data.password)) {
      // [FIXED] ตัดช่องว่างซ้ายขวา (Trim) ป้องกันการพิมพ์เว้นวรรคเกินใน Google Sheet
      let rawRole = String(rows[i][3] || '').trim().toLowerCase();
      let rawDept = String(rows[i][4] || '').trim();
      
      // Fallback: หากลืมระบุแผนกในระบบ จะเซ็ตค่าเผื่อไว้ไม่ให้เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์
      let finalDept = rawDept;
      if (!finalDept) {
        finalDept = (rawRole === 'admin') ? 'ALL' : 'ASSEMBLY';
      }

      return createJSONOutput({
        status: 'success', 
        user: issueAttendanceSession_({
          username: String(rows[i][0]).trim(), 
          name: String(rows[i][2]).trim(), 
          role: rawRole, 
          dept: finalDept 
        })
      }); 
    }
  } 
  
  // System Admin Fallback: only for first-time setup, before any admin exists in the Users sheet.
  // Otherwise admin/password would keep working even after a real admin password is set.
  const hasAdmin = rows.slice(1).some(r => String(r[3] || '').trim().toLowerCase() === 'admin');
  if(!hasAdmin && data.username === 'admin' && data.password === 'password') {
    return createJSONOutput({
      status: 'success', 
      user: issueAttendanceSession_({ username: 'admin', name: 'System Admin', role: 'admin', dept: 'ALL' })
    });
  }
  return createJSONOutput({status:'error'}); 
}

function getUsers() { 
  return createJSONOutput({
    status: 'success', 
    users: getSheet('Users').getDataRange().getValues().slice(1).map(r => {
      const role = String(r[3]).trim().toLowerCase();
      return {
        username: String(r[0]).trim(), 
        password: String(r[1]).trim(), 
        name: String(r[2]).trim(), 
        role: role, 
        // Same default as loginUser; defaulting to ALL here would grant all-dept access when the user is re-saved from the Admin Panel.
        dept: String(r[4]).trim() || (role === 'admin' ? 'ALL' : 'ASSEMBLY')
      };
    })
  }); 
}

function saveUser(data) { 
  const sheet = getSheet('Users'); 
  const rows = sheet.getDataRange().getValues();
  let idx = -1; 
  for(let i=1; i<rows.length; i++) {
      if(String(rows[i][0]) === String(data.user.username)) idx = i + 1; 
  }
  
  // [FIXED] จัดการข้อมูลก่อนบันทึกให้สะอาด
  let safeRole = data.user.role ? String(data.user.role).trim().toLowerCase() : 'viewer';
  let safeDept = data.user.dept ? String(data.user.dept).trim() : (safeRole === 'admin' ? 'ALL' : 'ASSEMBLY');

  if(idx > 0) {
      sheet.getRange(idx, 2, 1, 4).setValues([[data.user.password, data.user.name, safeRole, safeDept]]); 
  } else {
      sheet.appendRow([data.user.username, data.user.password, data.user.name, safeRole, safeDept]); 
  }
  return createJSONOutput({status: 'success'}); 
}

function deleteUser(data) { 
  const sheet = getSheet('Users'); 
  const rows = sheet.getDataRange().getValues();
  for(let i=1; i<rows.length; i++) {
      if(String(rows[i][0]) === String(data.username)) { 
        sheet.deleteRow(i + 1); 
        return createJSONOutput({status: 'success'}); 
      }
  } 
  return createJSONOutput({status: 'error'}); 
}

function saveData(data) { 
  const sheet = getSheet('Data'); 
  const updates = {};
  
  // นำ orgData กลับมาจัดการเผื่อกรณีที่มีการ Import/Recovery
  // ตรวจ version ก่อนเขียนทับทั้งชุด เพื่อไม่ให้ไฟล์ backup เก่าทับข้อมูลใหม่ของผู้ใช้อื่น
  if (Array.isArray(data.orgData)) {
    const existingRef = getLatestDataKeyValue(sheet, 'orgData');
    const baseVersions = data.baseVersions && typeof data.baseVersions === 'object' ? data.baseVersions : null;
    if (!baseVersions) {
      return createJSONOutput({
        status: 'conflict',
        message: 'ไม่สามารถเขียนทับข้อมูลโดยไม่มี version ล่าสุด กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง',
        conflicts: [{ id: '*', reason: 'missing-client-version' }]
      });
    }

    let currentData = [];
    if (existingRef && String(existingRef).startsWith('FILE_ID:')) {
      try {
        currentData = JSON.parse(DriveApp.getFileById(String(existingRef).split('FILE_ID:')[1]).getBlob().getDataAsString());
        if (!Array.isArray(currentData)) currentData = [];
      } catch (e) {
        return createJSONOutput({ status: 'error', message: 'อ่านข้อมูลปัจจุบันไม่สำเร็จ ยกเลิกการ Import เพื่อป้องกันข้อมูลเสียหาย' });
      }
    }

    const currentMap = new Map(currentData.map(item => [String(item.id), item]));
    const conflicts = [];
    currentMap.forEach((item, id) => {
      if (!Object.prototype.hasOwnProperty.call(baseVersions, id)) {
        conflicts.push({ id: id, reason: 'record-added-after-load', expected: '', actual: normalizeVersion_(item.lastModified) });
      } else if (normalizeVersion_(baseVersions[id]) !== normalizeVersion_(item.lastModified)) {
        conflicts.push({ id: id, reason: 'stale-record', expected: normalizeVersion_(baseVersions[id]), actual: normalizeVersion_(item.lastModified) });
      }
    });
    Object.keys(baseVersions).forEach(id => {
      if (!currentMap.has(String(id))) {
        conflicts.push({ id: String(id), reason: 'record-deleted-after-load', expected: normalizeVersion_(baseVersions[id]), actual: '' });
      }
    });
    if (conflicts.length > 0) {
      return createJSONOutput({ status: 'conflict', message: 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อน Import', conflicts: conflicts });
    }

    // [FIX] ถ้ามี FILE_ID เดิม ให้เขียนทับไฟล์เดิมแทนการสร้างไฟล์ใหม่ทุกครั้ง
    const payload = JSON.stringify(data.orgData);
    let fileId = null;

    if (existingRef && String(existingRef).startsWith('FILE_ID:')) {
      fileId = String(existingRef).split('FILE_ID:')[1];
    }

    if (fileId) {
      try {
        DriveApp.getFileById(fileId).setContent(payload);
        updates['orgData'] = 'FILE_ID:' + fileId;
        normalizeOrgDataFileNames_(fileId);
      } catch (e) {
        const f = DriveApp.getFolderById(CONFIG.FOLDER_ID).createFile("orgData.json", payload, MimeType.PLAIN_TEXT);
        updates['orgData'] = 'FILE_ID:' + f.getId();
        normalizeOrgDataFileNames_(f.getId());
      }
    } else {
      const f = DriveApp.getFolderById(CONFIG.FOLDER_ID).createFile("orgData.json", payload, MimeType.PLAIN_TEXT);
      updates['orgData'] = 'FILE_ID:' + f.getId();
      normalizeOrgDataFileNames_(f.getId());
    }
  } 
  if(data.orgPositions) updates['orgPositions'] = JSON.stringify(data.orgPositions);
  if(data.orgDepartments) updates['orgDepartments'] = JSON.stringify(data.orgDepartments);
  if(data.orgSubDepartments) updates['orgSubDepartments'] = JSON.stringify(data.orgSubDepartments);

  // [FIX] อัปเดตแบบ Upsert ต่อ key พร้อมลบ row ซ้ำออก เพื่อไม่ให้ getData โดนทับค่าจาก row ล่าสุดแบบไม่ตั้งใจ
  for (let k in updates) {
    upsertDataKey(sheet, k, updates[k]);
  }

  // A full import replaces the roster, so mirror the whole list to the P&L sheet as well.
  const plSync = Array.isArray(data.orgData) ? syncEmployeesToPlSheetSafely_(() => syncAllEmployeesToPlSheet_(data.orgData)) : undefined;
  return createJSONOutput({status:'success', plSync}); 
}

function getData() { 
  const sheet = getSheet('Data');
  const rows = sheet.getDataRange().getValues(); 
  const res = {};
  
  // [FIX] ถ้ามี key ซ้ำ ให้ใช้ค่าจากแถวล่าสุดที่มีข้อมูล แล้วทำให้ key ไม่ซ้ำก่อนคืนข้อมูล
  const latestValues = {};
  rows.slice(1).forEach(r => {
    const key = r[0];
    const value = r[1];
    if (!key) return;
    if (value !== '' && value !== null && value !== undefined) latestValues[key] = value;
  });

  Object.keys(latestValues).forEach(key => {
    const val = latestValues[key];
    if(val && String(val).startsWith('FILE_ID:')) {
      try {
        res[key] = JSON.parse(DriveApp.getFileById(String(val).split('FILE_ID:')[1]).getBlob().getDataAsString());
      } catch(e) {
        console.error('Failed to read Drive file for key: ' + key + ' — ' + e.toString());
        // ไม่ set ค่า key นี้ เพื่อให้ frontend รู้ว่าอ่านไม่ได้ (ไม่ส่ง [] กลับ)
      }
    } else {
      try { res[key] = JSON.parse(val); } catch(e) { /* skip invalid JSON */ }
    }
  });

  cleanupDuplicateDataKeys(sheet);
  return createJSONOutput({status: 'success', data: res});
}

function recoverOrgData(data) {
  const result = recoverOrgDataFromAllFiles_(true);
  return createJSONOutput({
    status: result.status,
    message: result.message,
    recoveredCount: result.recoveredCount,
    scannedFiles: result.scannedFiles,
    savedFileId: result.savedFileId || null
  });
}

function recoverOrgDataFromAllFiles_(saveRecovered) {
  const sheet = getSheet('Data');
  const rows = sheet.getDataRange().getValues();
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const fileInfo = [];
  const seenFileIds = {};

  // 1) เก็บไฟล์จาก FILE_ID ที่เคยอ้างอิงในชีต Data
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== 'orgData') continue;
    const raw = String(rows[i][1] || '');
    if (!raw.startsWith('FILE_ID:')) continue;
    const fileId = raw.split('FILE_ID:')[1];
    if (!fileId || seenFileIds[fileId]) continue;

    try {
      const f = DriveApp.getFileById(fileId);
      fileInfo.push({ id: fileId, updated: f.getLastUpdated().getTime(), file: f, source: 'sheet' });
      seenFileIds[fileId] = true;
    } catch (e) {}
  }

  // 2) เก็บไฟล์กลุ่ม orgData ทั้งหมดในโฟลเดอร์ (รวม backup) กรณีเคยหลุดจากชีต
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = String(f.getName() || '');
    if (!/^orgData(\.json|_backup_.*\.json)$/.test(name)) continue;
    const fileId = f.getId();
    if (seenFileIds[fileId]) continue;
    fileInfo.push({ id: fileId, updated: f.getLastUpdated().getTime(), file: f, source: 'folder' });
    seenFileIds[fileId] = true;
  }

  if (fileInfo.length === 0) {
    return { status: 'error', message: 'No orgData files found for recovery', recoveredCount: 0, scannedFiles: 0 };
  }

  // ไล่จากเก่า -> ใหม่ เพื่อให้ข้อมูลล่าสุด overwrite รายการเดิมตามรหัสพนักงาน
  fileInfo.sort((a, b) => a.updated - b.updated);
  const mergedMap = new Map();

  for (let i = 0; i < fileInfo.length; i++) {
    try {
      const txt = fileInfo[i].file.getBlob().getDataAsString();
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr)) continue;

      arr.forEach(emp => {
        if (!emp || emp.id === null || emp.id === undefined || String(emp.id).trim() === '') return;
        mergedMap.set(String(emp.id), emp);
      });
    } catch (e) {}
  }

  const recovered = Array.from(mergedMap.values());
  if (!saveRecovered) {
    return { status: 'success', message: 'Recovery preview completed', recoveredCount: recovered.length, scannedFiles: fileInfo.length };
  }

  const payload = JSON.stringify(recovered);
  const existingRef = getLatestDataKeyValue(sheet, 'orgData');
  let targetFileId = null;
  if (existingRef && String(existingRef).startsWith('FILE_ID:')) {
    targetFileId = String(existingRef).split('FILE_ID:')[1];
  }

  if (targetFileId) {
    try {
      DriveApp.getFileById(targetFileId).setContent(payload);
    } catch (e) {
      const newFile = folder.createFile("orgData.json", payload, MimeType.PLAIN_TEXT);
      targetFileId = newFile.getId();
    }
  } else {
    const newFile = folder.createFile("orgData.json", payload, MimeType.PLAIN_TEXT);
    targetFileId = newFile.getId();
  }

  upsertDataKey(sheet, 'orgData', 'FILE_ID:' + targetFileId);
  normalizeOrgDataFileNames_(targetFileId);
  return {
    status: 'success',
    message: 'Recovered orgData from historical files',
    recoveredCount: recovered.length,
    scannedFiles: fileInfo.length,
    savedFileId: targetFileId
  };
}

function normalizeOrgDataFileNames_(activeFileId) {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const files = folder.getFilesByName("orgData.json");
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyyMMdd_HHmmss');
  let backupIdx = 1;

  while (files.hasNext()) {
    const f = files.next();
    if (f.getId() === activeFileId) continue;
    const newName = "orgData_backup_" + stamp + "_" + backupIdx + ".json";
    f.setName(newName);
    backupIdx++;
  }
}

function getLatestDataKeyValue(sheet, key) {
  const rows = sheet.getDataRange().getValues();
  let latest = null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(key)) latest = rows[i][1];
  }
  return latest;
}

function upsertDataKey(sheet, key, value) {
  const rows = sheet.getDataRange().getValues();
  const matchedRows = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(key)) matchedRows.push(i + 1);
  }

  if (matchedRows.length === 0) {
    sheet.appendRow([key, value]);
    return;
  }

  const keepRow = matchedRows[matchedRows.length - 1];
  sheet.getRange(keepRow, 2).setValue(value);

  // ลบ row ซ้ำโดยลบจากล่างขึ้นบน ป้องกัน index เพี้ยน
  for (let i = matchedRows.length - 2; i >= 0; i--) {
    sheet.deleteRow(matchedRows[i]);
  }
}

function cleanupDuplicateDataKeys(sheet) {
  const rows = sheet.getDataRange().getValues();
  const latestIndex = {};
  for (let i = 1; i < rows.length; i++) {
    const key = rows[i][0];
    if (key) latestIndex[String(key)] = i + 1;
  }

  const toDelete = [];
  for (let i = 1; i < rows.length; i++) {
    const key = rows[i][0];
    if (!key) continue;
    const rowNumber = i + 1;
    if (latestIndex[String(key)] !== rowNumber) toDelete.push(rowNumber);
  }

  for (let i = toDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(toDelete[i]);
  }
}

function createJSONOutput(obj) { 
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); 
}

function attendanceTokenSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty('ATTENDANCE_TOKEN_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    properties.setProperty('ATTENDANCE_TOKEN_SECRET', secret);
  }
  return secret;
}

function signAttendancePayload_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, attendanceTokenSecret_()));
}

function issueAttendanceSession_(user) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    // ASCII-only payload: Thai usernames are percent-encoded so the base64 round trip can't corrupt them.
    username: encodeURIComponent(String(user.username)),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    nonce: Utilities.getUuid()
  }));
  return Object.assign({}, user, { attendanceToken: payload + '.' + signAttendancePayload_(payload) });
}

function getAttendanceActor_(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expectedSignature = signAttendancePayload_(parts[0]);
  if (parts[1] !== expectedSignature) return null;

  let session;
  try {
    session = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (error) {
    return null;
  }
  let username = String(session.username || '').trim();
  try { username = decodeURIComponent(username); } catch (error) {}
  username = username.normalize('NFC');
  if (!username || Number(session.expiresAt) < Date.now()) return null;

  const rows = getSheet('Users').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().normalize('NFC') !== username) continue;
    const role = String(rows[i][3] || '').trim().toLowerCase();
    return {
      username: String(username),
      name: String(rows[i][2] || username).trim(),
      role: role,
      dept: String(rows[i][4] || (role === 'admin' ? 'ALL' : 'ASSEMBLY')).trim()
    };
  }

  const hasAdmin = rows.slice(1).some(row => String(row[3] || '').trim().toLowerCase() === 'admin');
  if (!hasAdmin && username === 'admin') {
    return { username: 'admin', name: 'System Admin', role: 'admin', dept: 'ALL' };
  }
  return null;
}

function getAttendanceDate_(date) {
  const reference = date ? new Date(date) : new Date();
  const shifted = new Date(reference.getTime() - 8 * 60 * 60 * 1000);
  return Utilities.formatDate(shifted, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getAttendanceWindow_(date) {
  const timezone = Session.getScriptTimeZone();
  const workDate = getAttendanceDate_(date);
  const start = Utilities.parseDate(workDate + ' 08:00:00', timezone, 'yyyy-MM-dd HH:mm:ss');
  return { date: workDate, start: start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

// Backdated attendance: Leader / Supervisor / Admin may view and record an earlier round.
// Non-admins are limited to the last ATTENDANCE_BACKDATE_DAYS rounds; nobody may record ahead.
const ATTENDANCE_BACKDATE_DAYS = 31;
const ATTENDANCE_BACKDATE_ROLES = ['admin', 'supervisor', 'leader'];

// Returns the round a request reads or writes. An empty date (or today's) means the current round.
function resolveAttendanceWindow_(actor, requestedDate) {
  const current = getAttendanceWindow_(new Date());
  const date = String(requestedDate || '').trim();
  if (!date || date === current.date) return { window: current, today: current.date, backdated: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  if (ATTENDANCE_BACKDATE_ROLES.indexOf(actor.role) === -1) {
    return { error: 'เฉพาะ Leader, Supervisor และ Admin ที่เช็คชื่อย้อนหลังได้' };
  }
  const timezone = Session.getScriptTimeZone();
  const start = Utilities.parseDate(date + ' 08:00:00', timezone, 'yyyy-MM-dd HH:mm:ss');
  if (isNaN(start.getTime()) || Utilities.formatDate(start, timezone, 'yyyy-MM-dd') !== date) return { error: 'วันที่ไม่ถูกต้อง' };
  if (date > current.date) return { error: 'ไม่สามารถเช็คชื่อล่วงหน้าได้' };
  const oldest = getAttendanceDate_(new Date(current.start.getTime() - ATTENDANCE_BACKDATE_DAYS * 24 * 60 * 60 * 1000 + 60 * 60 * 1000));
  if (actor.role !== 'admin' && date < oldest) {
    return { error: 'เช็คชื่อย้อนหลังได้ไม่เกิน ' + ATTENDANCE_BACKDATE_DAYS + ' วัน' };
  }
  return { window: { date: date, start: start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }, today: current.date, backdated: true };
}

// The time a backdated entry is filed under: HH:mm inside the round (00:00–07:59 = the next calendar morning).
function backdatedAttendanceTimestamp_(window, time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || '08:00').trim());
  if (!match) return null;
  const minutes = ((Number(match[1]) - 8 + 24) % 24) * 60 + Number(match[2]);
  return new Date(window.start.getTime() + minutes * 60 * 1000);
}

function isAttendanceTimestampInWindow_(value, window) {
  const timestamp = value instanceof Date ? value : new Date(value);
  return !isNaN(timestamp.getTime()) && timestamp >= window.start && timestamp < window.end;
}

function attendanceRecordFromRow_(row) {
  const timestamp = row[1] instanceof Date ? row[1] : new Date(row[1]);
  const timezone = Session.getScriptTimeZone();
  return {
    date: String(row[0]),
    timestamp: timestamp.toISOString(),
    time: Utilities.formatDate(timestamp, timezone, 'HH:mm'),
    username: String(row[2]),
    name: String(row[3]),
    dept: String(row[4] || ''),
    type: String(row[5]),
    checkedByUsername: String(row[6] || ''),
    checkedByName: String(row[7] || ''),
    subDept: String(row[8] || ''),
    position: String(row[9] || ''),
    recordedAt: row[10] instanceof Date ? row[10].toISOString() : String(row[10] || '')
  };
}

function getAttendanceOrgEmployees_() {
  const value = getLatestDataKeyValue(getSheet('Data'), 'orgData');
  if (value === null || value === undefined || value === '') return [];
  try {
    const content = String(value).indexOf('FILE_ID:') === 0
      ? DriveApp.getFileById(String(value).slice('FILE_ID:'.length)).getBlob().getDataAsString()
      : String(value);
    const employees = JSON.parse(content);
    return Array.isArray(employees) ? employees.filter(employee => employee && typeof employee === 'object') : [];
  } catch (error) {
    throw new Error('อ่านรายชื่อพนักงานสำหรับเช็คชื่อไม่สำเร็จ');
  }
}

function attendanceEmployeeId_(employee) {
  return employee && employee.id !== null && employee.id !== undefined
    ? String(employee.id).trim()
    : '';
}

function getAttendanceRoster_(actor) {
  const employees = getAttendanceOrgEmployees_();
  // Planned (future) hires are not on the roster until they actually start (status Active).
  const activeEmployees = employees.filter(employee => !['resigned', 'planned'].includes(String(employee.status || '').trim().toLowerCase()));
  const byId = new Map();
  const childrenByManager = new Map();
  employees.forEach(employee => {
    const id = attendanceEmployeeId_(employee);
    if (id) byId.set(id, employee);
    const managerId = String(employee.reportsTo || '').trim();
    if (id && managerId && managerId !== 'STAGING') {
      if (!childrenByManager.has(managerId)) childrenByManager.set(managerId, []);
      childrenByManager.get(managerId).push(employee);
    }
  });

  // Match the login account to the org chart by Name first (ignoring case and any whitespace),
  // then fall back to Username = employee id.
  const normalizeName = value => String(value || '').replace(/\s+/g, '').toLocaleLowerCase();
  let matchedSelf = null;
  if (actor.name) {
    const normalizedName = normalizeName(actor.name);
    const nameMatches = normalizedName
      ? employees.filter(employee => normalizeName(employee.name) === normalizedName)
      : [];
    if (nameMatches.length === 1) matchedSelf = nameMatches[0];
    else if (nameMatches.length > 1) {
      matchedSelf = nameMatches.find(employee => attendanceEmployeeId_(employee) === actor.username) || null;
    }
  }
  if (!matchedSelf) matchedSelf = byId.get(actor.username) || null;
  const selfIsResigned = Boolean(matchedSelf && String(matchedSelf.status || '').trim().toLowerCase() === 'resigned');
  const self = selfIsResigned ? null : matchedSelf;
  const selfId = matchedSelf ? attendanceEmployeeId_(matchedSelf) : actor.username;
  let allowed = [];
  let message = '';
  if (actor.role === 'admin') {
    allowed = activeEmployees;
  } else if (selfIsResigned) {
    message = 'บัญชีนี้เป็นพนักงานที่ลาออกแล้ว จึงไม่สามารถใช้ระบบเช็คชื่อได้';
  } else if (actor.role === 'supervisor') {
    allowed = activeEmployees.filter(employee => String(employee.dept || '').trim() === actor.dept);
  } else if (actor.role === 'leader') {
    if (!self) {
      message = 'ไม่พบพนักงานที่ตรงกับบัญชีหัวหน้า กรุณาตรวจชื่อ (Name) ในชีต Users ให้ตรงกับชื่อพนักงานในผังองค์กร';
    } else {
      const allowedIds = new Set([selfId]);
      const queue = [selfId];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const managerId = queue[cursor];
        (childrenByManager.get(managerId) || []).forEach(employee => {
          const id = attendanceEmployeeId_(employee);
          if (id && !allowedIds.has(id)) {
            allowedIds.add(id);
            queue.push(id);
          }
        });
      }
      allowed = activeEmployees.filter(employee => allowedIds.has(attendanceEmployeeId_(employee)));
    }
  } else if (self) {
    allowed = [self];
  } else {
    allowed = [{ id: actor.username, name: actor.name, dept: actor.dept, qrEnabled: false }];
    message = 'บัญชีนี้ยังไม่ตรงกับข้อมูลพนักงาน จึงใช้ QR ไม่ได้ กรุณาตั้ง User หรือชื่อให้ตรงกับผังองค์กร';
  }

  const roster = allowed.map(employee => ({
    id: attendanceEmployeeId_(employee),
    name: String(employee.name || employee.id || ''),
    dept: String(employee.dept || ''),
    subDept: String(employee.subDept || '').trim(),
    position: String(employee.position || ''),
    reportsTo: String(employee.reportsTo || '').trim(),
    type: String(employee.type || 'Permanent'),
    company: String(employee.company || '').trim(),
    order: Number.isFinite(Number(employee.order)) ? Number(employee.order) : 0,
    image: String(employee.image || ''),
    shift: ['A', 'B'].includes(String(employee.shift || '').trim().toUpperCase()) ? String(employee.shift).trim().toUpperCase() : '',
    qrEnabled: employee.qrEnabled !== false
  })).filter(employee => employee.id);
  const departments = Array.from(new Set(roster.map(employee => employee.dept).filter(Boolean))).sort();
  return { employees: roster, departments: departments, message: message, selfId: selfId };
}

// Thai <-> English machine translation for the Job Description editor (Apps Script's built-in LanguageApp, no API key).
// Same people who may edit a Job Description may use it: Engineer and above.
function translateText(data) {
  const actor = getAttendanceActor_(data && data.attendanceToken);
  if (!actor) return createJSONOutput({ status: 'error', code: 'session_expired', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  if (['admin', 'supervisor', 'engineer'].indexOf(actor.role) === -1) {
    return createJSONOutput({ status: 'error', message: 'เฉพาะระดับ Engineer ขึ้นไปที่ใช้การแปลได้' });
  }
  const from = String(data.from || '');
  const to = String(data.to || '');
  const text = String(data.text || '').trim();
  if (!((from === 'th' && to === 'en') || (from === 'en' && to === 'th'))) {
    return createJSONOutput({ status: 'error', message: 'รองรับเฉพาะการแปลไทย ⇄ อังกฤษ' });
  }
  if (!text) return createJSONOutput({ status: 'error', message: 'ไม่มีข้อความให้แปล' });
  if (text.length > 5000) return createJSONOutput({ status: 'error', message: 'ข้อความยาวเกิน 5,000 ตัวอักษร กรุณาแบ่งแปลทีละส่วน' });
  try {
    return createJSONOutput({ status: 'success', text: LanguageApp.translate(text, from, to) });
  } catch (error) {
    return createJSONOutput({ status: 'error', message: 'แปลไม่สำเร็จ: ' + (error.message || error) });
  }
}

// Public, aggregate-only attendance endpoint for the production dashboard.
// It exposes no employee names, IDs, or individual attendance rows.
function getAttendanceCounts() {
  try {
    const window = getAttendanceWindow_(new Date());
    const employees = getAttendanceOrgEmployees_().filter(employee =>
      !['resigned', 'planned'].includes(String(employee.status || '').trim().toLowerCase()) &&
      String(employee.dept || '').trim().toLowerCase() === 'assembly' &&
      String(employee.subDept || '').trim().toLowerCase() === 'h9'
    );
    const employeesById = new Map(employees.map(employee => [attendanceEmployeeId_(employee), employee]));
    const rows = getSheet('Attendance').getDataRange().getValues().slice(1);
    const checkedIn = new Set();
    const groups = new Map();
    rows.forEach(row => {
      const id = String(row[2] || '').trim();
      const timestamp = row[1] instanceof Date ? row[1] : new Date(row[1]);
      if (String(row[5] || '').trim() !== 'work' || !id || isNaN(timestamp.getTime()) ||
          timestamp < window.start || timestamp >= window.end || checkedIn.has(id)) return;
      const employee = employeesById.get(id);
      if (!employee) return;
      checkedIn.add(id);
      const dept = String(employee.dept || row[4] || '').trim();
      const subDept = String(employee.subDept || row[8] || '').trim();
      const rawShift = String(employee.shift || '').trim().toUpperCase();
      const shift = rawShift === 'A' || rawShift === 'B' ? rawShift : 'Unassigned';
      const key = [dept, subDept, shift].join('\u0000');
      if (!groups.has(key)) groups.set(key, { department: dept, team: subDept, shift: shift, count: 0 });
      groups.get(key).count++;
    });
    return createJSONOutput({
      status: 'success', date: window.date, scope: { department: 'Assembly', team: 'H9' },
      updatedAt: new Date().toISOString(), total: checkedIn.size,
      groups: Array.from(groups.values()).sort((a, b) => a.department.localeCompare(b.department) || a.team.localeCompare(b.team) || a.shift.localeCompare(b.shift))
    });
  } catch (error) {
    return createJSONOutput({ status: 'error', message: 'อ่านยอดรวมการเข้างานไม่สำเร็จ' });
  }
}

function getAttendance(data) {
  const actor = getAttendanceActor_(data && data.attendanceToken);
  if (!actor) return createJSONOutput({ status: 'error', code: 'session_expired', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });

  let roster;
  try {
    roster = getAttendanceRoster_(actor);
  } catch (error) {
    return createJSONOutput({ status: 'error', message: error.message || 'โหลดรายชื่อพนักงานไม่สำเร็จ' });
  }

  const resolved = resolveAttendanceWindow_(actor, data && data.workDate);
  if (resolved.error) return createJSONOutput({ status: 'error', message: resolved.error });
  const sheet = getSheet('Attendance');
  const window = resolved.window;
  const today = window.date;
  const rows = sheet.getDataRange().getValues().slice(1);
  const records = rows
    .filter(row => isAttendanceTimestampInWindow_(row[1], window))
    .map(attendanceRecordFromRow_)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const mine = {};
  records.filter(record => record.username === roster.selfId || record.username === actor.username).forEach(record => { mine[record.type] = record; });

  const allowedIds = new Set(roster.employees.map(employee => employee.id));
  let visibleRecords = records.filter(record => allowedIds.has(record.username) || record.username === actor.username);

  // Which shift(s) each team checked in on its most recent earlier work day. The Monitor uses this
  // to guess who is expected before anyone has checked in this round.
  const employeesById = new Map(roster.employees.map(employee => [employee.id, employee]));
  const latestByTeam = new Map();
  rows.forEach(row => {
    if (String(row[5] || '').trim() !== 'work') return;
    const employee = employeesById.get(String(row[2] || '').trim());
    if (!employee || (employee.shift !== 'A' && employee.shift !== 'B')) return;
    const timestamp = row[1] instanceof Date ? row[1] : new Date(row[1]);
    if (isNaN(timestamp.getTime()) || timestamp >= window.start) return;
    const workDate = getAttendanceDate_(timestamp);
    const key = [employee.dept, employee.subDept].join('\u0000');
    let entry = latestByTeam.get(key);
    if (!entry || workDate > entry.date) {
      entry = { dept: employee.dept, subDept: employee.subDept, date: workDate, shifts: new Set() };
      latestByTeam.set(key, entry);
    }
    if (workDate === entry.date) entry.shifts.add(employee.shift);
  });
  const previousShifts = Array.from(latestByTeam.values()).map(entry => ({
    dept: entry.dept, subDept: entry.subDept, date: entry.date, shifts: Array.from(entry.shifts).sort()
  }));

  return createJSONOutput({
    status: 'success', date: today, today: resolved.today, backdated: resolved.backdated,
    canBackdate: ATTENDANCE_BACKDATE_ROLES.indexOf(actor.role) !== -1,
    backdateDays: actor.role === 'admin' ? 0 : ATTENDANCE_BACKDATE_DAYS,
    mine: mine, records: visibleRecords,
    employees: roster.employees, departments: roster.departments, rosterMessage: roster.message,
    selfId: roster.selfId, actorUsername: actor.username, previousShifts: previousShifts
  });
}

function recordAttendance(data) {
  const result = recordAttendanceItems_(data, [{ employeeId: data && data.employeeId, type: data && data.type }], true);
  if (result.status !== 'success') return createJSONOutput(result);
  const item = result.items[0];
  return createJSONOutput({ status: item.status, date: result.date, record: item.record, mine: item.mine, message: item.message });
}

function recordAttendanceBatch(data) {
  return createJSONOutput(recordAttendanceItems_(data, data && data.items));
}

function recordAttendanceItems_(data, items, allowSelfFallback) {
  const actor = getAttendanceActor_(data && data.attendanceToken);
  if (!actor) return { status: 'error', code: 'session_expired', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  if (!Array.isArray(items) || items.length === 0) return { status: 'error', message: 'ไม่มีรายการเช็คชื่อให้บันทึก' };
  if (items.length > 500) return { status: 'error', message: 'บันทึกได้ไม่เกิน 500 รายการต่อครั้ง' };

  let roster;
  try {
    roster = getAttendanceRoster_(actor);
  } catch (error) {
    return { status: 'error', message: error.message || 'โหลดรายชื่อพนักงานไม่สำเร็จ' };
  }

  const resolved = resolveAttendanceWindow_(actor, data && data.workDate);
  if (resolved.error) return { status: 'error', message: resolved.error };
  const now = new Date();
  let entryTimestamp = now;
  if (resolved.backdated) {
    entryTimestamp = backdatedAttendanceTimestamp_(resolved.window, data && data.time);
    if (!entryTimestamp) return { status: 'error', message: 'รูปแบบเวลาไม่ถูกต้อง (HH:mm)' };
    if (entryTimestamp > now) return { status: 'error', message: 'เวลาที่เลือกยังมาไม่ถึง กรุณาเลือกเวลาที่ผ่านมาแล้ว' };
  }

  const sheet = getSheet('Attendance');
  const window = resolved.window;
  const today = window.date;
  const rows = sheet.getDataRange().getValues().slice(1);
  const todayRecords = rows.filter(row => isAttendanceTimestampInWindow_(row[1], window)).map(attendanceRecordFromRow_);
  const recordsByEmployee = new Map();
  todayRecords.forEach(record => {
    if (!recordsByEmployee.has(record.username)) recordsByEmployee.set(record.username, {});
    recordsByEmployee.get(record.username)[record.type] = record;
  });

  const allowedEmployees = new Map(roster.employees.map(employee => [employee.id, employee]));
  const outcomes = new Array(items.length);
  const writes = [];
  const orderedItems = items.map((item, index) => ({ item: item && typeof item === 'object' ? item : {}, index }))
    .sort((a, b) => (a.item.type === 'work' ? 0 : 1) - (b.item.type === 'work' ? 0 : 1));

  orderedItems.forEach(entry => {
    const type = String(entry.item.type || '');
    const requestedId = entry.item.employeeId;
    const targetId = String(requestedId === null || requestedId === undefined || requestedId === ''
      ? (allowSelfFallback ? roster.selfId || actor.username : '')
      : requestedId).trim();
    const target = allowedEmployees.get(targetId);
    if (type !== 'work' && type !== 'ot') {
      outcomes[entry.index] = { employeeId: targetId, type: type, status: 'error', message: 'ประเภทการเช็คชื่อไม่ถูกต้อง' };
      return;
    }
    if (!target) {
      outcomes[entry.index] = { employeeId: targetId, type: type, status: 'error', message: 'ไม่มีสิทธิ์เช็คชื่อพนักงานรายนี้' };
      return;
    }

    if (!recordsByEmployee.has(targetId)) recordsByEmployee.set(targetId, {});
    const mine = recordsByEmployee.get(targetId);
    if (mine[type]) {
      outcomes[entry.index] = { employeeId: targetId, name: target.name, type: type, status: 'duplicate', record: mine[type], mine: mine, message: 'เช็คชื่อรายการนี้แล้วในรอบนี้' };
      return;
    }
    if (type === 'ot' && !mine.work) {
      outcomes[entry.index] = { employeeId: targetId, name: target.name, type: type, status: 'error', code: 'work_required', message: 'กรุณาเช็คเข้างานก่อนเริ่ม OT' };
      return;
    }

    const row = [today, entryTimestamp, target.id, target.name, target.dept, type, actor.username, actor.name, target.subDept || '', target.position || '', now];
    const record = attendanceRecordFromRow_(row);
    writes.push(row);
    mine[type] = record;
    outcomes[entry.index] = { employeeId: targetId, name: target.name, type: type, status: 'success', record: record, mine: mine };
  });

  if (writes.length > 0) {
    const firstRow = sheet.getLastRow() + 1;
    sheet.getRange(firstRow, 1, writes.length, 11).setValues(writes);
  }
  return { status: 'success', date: today, backdated: resolved.backdated, items: outcomes };
}

// --- SKILL MATRIX (ISO 9001 / IATF 16949) ---
// Display board only: levels are entered here by Engineer/Supervisor/Admin for now.
// A training/exam system can later push levels with the same keys (EmployeeId + SkillId) and Source = 'system'.
const SKILL_EDIT_ROLES = ['admin', 'supervisor', 'engineer'];
const SKILL_SHEETS = {
  catalog: { name: 'SkillCatalog', headers: ['SkillId', 'Dept', 'SubDept', 'Category', 'Code', 'Name', 'WI', 'WIRev', 'Critical', 'TargetCount', 'TargetLevel', 'Required', 'Order', 'Active', 'UpdatedAt', 'UpdatedBy'] },
  levels: { name: 'SkillLevels', headers: ['EmployeeId', 'SkillId', 'Level', 'AssessedDate', 'Source', 'Note', 'UpdatedAt', 'UpdatedBy'] },
  history: { name: 'SkillLevelHistory', headers: ['Timestamp', 'EmployeeId', 'SkillId', 'OldLevel', 'NewLevel', 'AssessedDate', 'Source', 'By'] },
  docs: { name: 'SkillMatrixDocs', headers: ['Dept', 'SubDept', 'Title', 'DocNo', 'Rev', 'EffectiveDate', 'PreparedBy', 'CheckedBy', 'ApprovedBy', 'ReviewMonths', 'LastReviewDate', 'UpdatedAt', 'UpdatedBy'] }
};
const SKILL_CATEGORY_KEYS = ['process', 'machine', 'quality', 'safety', 'general'];

function getSkillSheet_(key) {
  const def = SKILL_SHEETS[key];
  const sheet = getSheet(def.name);
  if (sheet.getLastRow() === 0) {
    // Keep everything as text so IDs like "007" and dates are not re-typed by Sheets.
    sheet.getRange(1, 1, sheet.getMaxRows(), def.headers.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function skillRows_(key) {
  const sheet = getSkillSheet_(key);
  const width = SKILL_SHEETS[key].headers.length;
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, width).getValues();
}

function writeSkillRows_(key, rows) {
  const sheet = getSkillSheet_(key);
  const width = SKILL_SHEETS[key].headers.length;
  const last = sheet.getLastRow();
  if (last >= 2) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length > 0) {
    const range = sheet.getRange(2, 1, rows.length, width);
    range.setNumberFormat('@');
    range.setValues(rows);
  }
}

function skillText_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return value === null || value === undefined ? '' : String(value).trim();
}

function skillDate_(value) {
  const text = skillText_(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function skillLevel_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const level = Number(value);
  return Number.isInteger(level) && level >= 0 && level <= 4 ? level : null;
}

function skillInt_(value, fallback, min, max) {
  const number = Math.round(Number(value));
  if (value === '' || value === null || value === undefined || isNaN(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function skillSameDept_(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function canEditSkillDept_(actor, dept) {
  if (!actor || SKILL_EDIT_ROLES.indexOf(actor.role) < 0) return false;
  if (actor.role === 'admin' || String(actor.dept || '').toUpperCase() === 'ALL') return true;
  return skillSameDept_(actor.dept, dept);
}

function skillAuthError_(actor) {
  if (!actor) return createJSONOutput({ status: 'error', code: 'session_expired', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  return createJSONOutput({ status: 'error', code: 'forbidden', message: 'เฉพาะ Engineer / Supervisor / Admin ของแผนกนี้ที่แก้ Skill Matrix ได้' });
}

function getSkillMatrix() {
  const catalog = skillRows_('catalog').filter(r => skillText_(r[0])).map(r => {
    let required = {};
    try { required = JSON.parse(skillText_(r[11]) || '{}') || {}; } catch (e) { required = {}; }
    return {
      id: skillText_(r[0]), dept: skillText_(r[1]), subDept: skillText_(r[2]), category: skillText_(r[3]) || 'process',
      code: skillText_(r[4]), name: skillText_(r[5]), wi: skillText_(r[6]), wiRev: skillText_(r[7]), critical: skillText_(r[8]),
      targetCount: skillInt_(r[9], 0, 0, 99), targetLevel: skillInt_(r[10], 3, 1, 4), required: required,
      order: skillInt_(r[12], 0, 0, 100000), active: skillText_(r[13]).toUpperCase() !== 'FALSE',
      updatedAt: skillText_(r[14]), updatedBy: skillText_(r[15])
    };
  });
  const levels = skillRows_('levels').filter(r => skillText_(r[0]) && skillText_(r[1]) && skillLevel_(r[2]) !== null).map(r => ({
    employeeId: skillText_(r[0]), skillId: skillText_(r[1]), level: skillLevel_(r[2]), assessedDate: skillDate_(r[3]),
    source: skillText_(r[4]) || 'manual', note: skillText_(r[5]), updatedAt: skillText_(r[6]), updatedBy: skillText_(r[7])
  }));
  // Only recent history is needed for the dashboard ("Recent Skill Improvement").
  const since = Date.now() - 180 * 24 * 60 * 60 * 1000;
  const history = skillRows_('history').map(r => ({
    timestamp: skillText_(r[0]), employeeId: skillText_(r[1]), skillId: skillText_(r[2]),
    oldLevel: skillLevel_(r[3]), newLevel: skillLevel_(r[4]), assessedDate: skillDate_(r[5]), source: skillText_(r[6]), by: skillText_(r[7])
  })).filter(h => h.employeeId && h.skillId && new Date(h.timestamp).getTime() >= since).slice(-500);
  const docs = skillRows_('docs').filter(r => skillText_(r[0])).map(r => ({
    dept: skillText_(r[0]), subDept: skillText_(r[1]), title: skillText_(r[2]), docNo: skillText_(r[3]), rev: skillText_(r[4]),
    effectiveDate: skillDate_(r[5]), preparedBy: skillText_(r[6]), checkedBy: skillText_(r[7]), approvedBy: skillText_(r[8]),
    reviewMonths: skillInt_(r[9], 6, 1, 36), lastReviewDate: skillDate_(r[10]), updatedAt: skillText_(r[11]), updatedBy: skillText_(r[12])
  }));
  return createJSONOutput({ status: 'success', catalog: catalog, levels: levels, history: history, docs: docs, serverTime: new Date().toISOString() });
}

// data: { dept, scopes: [{ subDept, skills: [...] }] } — each scope is replaced as a whole; skills missing from it are deactivated (levels are kept).
function saveSkillCatalog(data) {
  const actor = getAttendanceActor_(data && data.attendanceToken);
  const dept = String((data && data.dept) || '').trim();
  if (!actor || !canEditSkillDept_(actor, dept)) return skillAuthError_(actor);
  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  if (!dept || scopes.length === 0) return createJSONOutput({ status: 'error', message: 'ข้อมูลรายการทักษะไม่ครบ' });

  const now = new Date().toISOString();
  const rows = skillRows_('catalog').filter(r => skillText_(r[0]));
  const indexById = new Map(rows.map((r, i) => [skillText_(r[0]), i]));
  let saved = 0;
  for (let s = 0; s < scopes.length; s++) {
    const subDept = String(scopes[s].subDept || '').trim();
    const skills = Array.isArray(scopes[s].skills) ? scopes[s].skills : [];
    const keep = new Set();
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i] || {};
      const id = String(skill.id || '').trim();
      const name = String(skill.name || '').trim();
      if (!id || !name) continue;
      if (indexById.has(id)) {
        const existing = rows[indexById.get(id)];
        if (!skillSameDept_(existing[1], dept) || skillText_(existing[2]) !== subDept) {
          return createJSONOutput({ status: 'error', message: 'รหัสทักษะ ' + id + ' เป็นของไลน์อื่น' });
        }
      }
      const required = {};
      if (skill.required && typeof skill.required === 'object') {
        Object.keys(skill.required).forEach(position => {
          const level = skillLevel_(skill.required[position]);
          if (level) required[String(position).trim()] = level;
        });
      }
      const row = [
        id, dept, subDept,
        SKILL_CATEGORY_KEYS.indexOf(skill.category) >= 0 ? skill.category : 'process',
        String(skill.code || '').trim(), name, String(skill.wi || '').trim(), String(skill.wiRev || '').trim(),
        ['CC', 'SC'].indexOf(skill.critical) >= 0 ? skill.critical : '',
        String(skillInt_(skill.targetCount, 0, 0, 99)), String(skillInt_(skill.targetLevel, 3, 1, 4)),
        JSON.stringify(required), String(i), 'TRUE', now, actor.name || actor.username
      ];
      if (indexById.has(id)) rows[indexById.get(id)] = row;
      else { indexById.set(id, rows.length); rows.push(row); }
      keep.add(id);
      saved++;
    }
    rows.forEach((r, index) => {
      if (skillSameDept_(r[1], dept) && skillText_(r[2]) === subDept && !keep.has(skillText_(r[0])) && skillText_(r[13]).toUpperCase() !== 'FALSE') {
        const updated = r.slice();
        updated[13] = 'FALSE';
        updated[14] = now;
        updated[15] = actor.name || actor.username;
        rows[index] = updated;
      }
    });
  }
  writeSkillRows_('catalog', rows.map(r => r.map(v => skillText_(v))));
  return createJSONOutput({ status: 'success', saved: saved });
}

// data: { items: [{ employeeId, skillId, level (0-4, or null to clear), note }], assessedDate }
function saveSkillLevels(data) {
  const actor = getAttendanceActor_(data && data.attendanceToken);
  if (!actor || SKILL_EDIT_ROLES.indexOf(actor.role) < 0) return skillAuthError_(actor);
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return createJSONOutput({ status: 'error', message: 'ไม่มีรายการที่ต้องบันทึก' });

  const employees = new Map(getAttendanceOrgEmployees_().map(e => [attendanceEmployeeId_(e), e]));
  const skills = new Map(skillRows_('catalog').map(r => [skillText_(r[0]), { dept: skillText_(r[1]) }]));
  const defaultDate = skillDate_(data.assessedDate) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const now = new Date().toISOString();
  const by = actor.name || actor.username;

  const rows = skillRows_('levels').filter(r => skillText_(r[0]) && skillText_(r[1]));
  const indexByKey = new Map(rows.map((r, i) => [skillText_(r[0]) + '|' + skillText_(r[1]), i]));
  const removed = new Set();
  const history = [];
  const errors = [];
  items.forEach(item => {
    const employeeId = String((item && item.employeeId) || '').trim();
    const skillId = String((item && item.skillId) || '').trim();
    const employee = employees.get(employeeId);
    const skill = skills.get(skillId);
    if (!employee || !skill) { errors.push(employeeId + '/' + skillId + ': ไม่พบพนักงานหรือทักษะ'); return; }
    if (!canEditSkillDept_(actor, employee.dept) || !skillSameDept_(skill.dept, employee.dept)) { errors.push((employee.name || employeeId) + ': ไม่มีสิทธิ์แก้แผนกนี้'); return; }
    const clear = item.level === null || item.level === '';
    const level = skillLevel_(item.level);
    if (!clear && level === null) { errors.push((employee.name || employeeId) + ': ระดับต้องเป็น 0-4'); return; }
    const key = employeeId + '|' + skillId;
    const index = indexByKey.has(key) ? indexByKey.get(key) : -1;
    const oldLevel = index >= 0 && !removed.has(index) ? skillLevel_(rows[index][2]) : null;
    if (clear) {
      if (index >= 0) removed.add(index);
    } else {
      const row = [employeeId, skillId, String(level), skillDate_(item.assessedDate) || defaultDate, 'manual', String(item.note || '').trim(), now, by];
      if (index >= 0) { rows[index] = row; removed.delete(index); }
      else { indexByKey.set(key, rows.length); rows.push(row); }
    }
    const newLevel = clear ? null : level;
    if (oldLevel !== newLevel) history.push([now, employeeId, skillId, oldLevel === null ? '' : String(oldLevel), newLevel === null ? '' : String(newLevel), clear ? '' : (skillDate_(item.assessedDate) || defaultDate), 'manual', by]);
  });

  writeSkillRows_('levels', rows.filter((r, i) => !removed.has(i)).map(r => r.map(v => skillText_(v))));
  if (history.length > 0) {
    const sheet = getSkillSheet_('history');
    const range = sheet.getRange(sheet.getLastRow() + 1, 1, history.length, SKILL_SHEETS.history.headers.length);
    range.setNumberFormat('@');
    range.setValues(history);
  }
  return createJSONOutput({ status: errors.length && history.length === 0 && errors.length === items.length ? 'error' : 'success', changed: history.length, errors: errors, message: errors.join(' · ') });
}

function saveSkillMatrixDoc(data) {
  const actor = getAttendanceActor_(data && data.attendanceToken);
  const doc = (data && data.doc) || {};
  const dept = String(doc.dept || '').trim();
  if (!actor || !canEditSkillDept_(actor, dept)) return skillAuthError_(actor);
  if (!dept) return createJSONOutput({ status: 'error', message: 'ไม่ระบุแผนก' });
  const subDept = String(doc.subDept || '').trim();
  const row = [
    dept, subDept, String(doc.title || '').trim(), String(doc.docNo || '').trim(), String(doc.rev || '').trim(),
    skillDate_(doc.effectiveDate), String(doc.preparedBy || '').trim(), String(doc.checkedBy || '').trim(), String(doc.approvedBy || '').trim(),
    String(skillInt_(doc.reviewMonths, 6, 1, 36)), skillDate_(doc.lastReviewDate), new Date().toISOString(), actor.name || actor.username
  ];
  const rows = skillRows_('docs').filter(r => skillText_(r[0])).map(r => r.map(v => skillText_(v)));
  const index = rows.findIndex(r => skillSameDept_(r[0], dept) && r[1] === subDept);
  if (index >= 0) rows[index] = row; else rows.push(row);
  writeSkillRows_('docs', rows);
  return createJSONOutput({ status: 'success' });
}

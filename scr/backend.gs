/**
 * HR Auto Organize - Backend Script (Version: V25 Verified Stable & Enhanced Logging)
 */
const CONFIG = {
  SPREADSHEET_ID: "1LxRYOtg0LL6_VSuNsaNuNuBUHal_T4eOYgy4tOrHNfE", 
  FOLDER_ID: "1K8g9ta30-ERitMBt_tGT2wr1ubtrv3df"
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
    if (data.action !== 'getData' && data.action !== 'getUsers' && data.action !== 'getAttendance' && data.action !== 'getAttendanceCounts' && data.action !== 'translateText') {
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
  return createJSONOutput({ status: 'success', message: 'Synced' });
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
    if(name === 'Attendance') sheet.appendRow(['WorkDate','Timestamp','Username','Name','Department','Type','CheckedByUsername','CheckedByName','SubDepartment','Position']);
  } 
  if (name === 'Attendance') {
    if (sheet.getMaxColumns() < 10) sheet.insertColumnsAfter(sheet.getMaxColumns(), 10 - sheet.getMaxColumns());
    if (sheet.getRange(1, 7, 1, 2).getValues()[0].join('|') !== 'CheckedByUsername|CheckedByName') {
      sheet.getRange(1, 7, 1, 2).setValues([['CheckedByUsername', 'CheckedByName']]);
    }
    if (sheet.getRange(1, 9).getValue() !== 'SubDepartment') sheet.getRange(1, 9).setValue('SubDepartment');
    if (sheet.getRange(1, 10).getValue() !== 'Position') sheet.getRange(1, 10).setValue('Position');
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
  
  return createJSONOutput({status:'success'}); 
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
    position: String(row[9] || '')
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
  const activeEmployees = employees.filter(employee => String(employee.status || '').trim().toLowerCase() !== 'resigned');
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
      String(employee.status || '').trim().toLowerCase() !== 'resigned' &&
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

  const sheet = getSheet('Attendance');
  const window = getAttendanceWindow_(new Date());
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
    status: 'success', date: today, mine: mine, records: visibleRecords,
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

  const sheet = getSheet('Attendance');
  const window = getAttendanceWindow_(new Date());
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

    const timestamp = new Date();
    const row = [today, timestamp, target.id, target.name, target.dept, type, actor.username, actor.name, target.subDept || '', target.position || ''];
    const record = attendanceRecordFromRow_(row);
    writes.push(row);
    mine[type] = record;
    outcomes[entry.index] = { employeeId: targetId, name: target.name, type: type, status: 'success', record: record, mine: mine };
  });

  if (writes.length > 0) {
    const firstRow = sheet.getLastRow() + 1;
    sheet.getRange(firstRow, 1, writes.length, 10).setValues(writes);
  }
  return { status: 'success', date: today, items: outcomes };
}

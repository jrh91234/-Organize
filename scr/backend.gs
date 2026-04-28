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
    if (data.action !== 'getData' && data.action !== 'getUsers') {
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
        currentData = []; 
    } 
  }

  if (data.deletes) { 
    const deleteSet = new Set(data.deletes.map(String));
    currentData = currentData.filter(emp => !deleteSet.has(String(emp.id))); 
  }
  
  if (data.updates) { 
    const dataMap = new Map(currentData.map(item => [String(item.id), item]));
    data.updates.forEach(item => dataMap.set(String(item.id), item)); 
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
        user: { 
          username: String(rows[i][0]).trim(), 
          name: String(rows[i][2]).trim(), 
          role: rawRole, 
          dept: finalDept 
        }
      }); 
    }
  } 
  
  // System Admin Fallback
  if(data.username === 'admin' && data.password === 'password') {
    return createJSONOutput({
      status: 'success', 
      user: { username: 'admin', name: 'System Admin', role: 'admin', dept: 'ALL' }
    });
  }
  return createJSONOutput({status:'error'}); 
}

function getUsers() { 
  return createJSONOutput({
    status: 'success', 
    users: getSheet('Users').getDataRange().getValues().slice(1).map(r => ({
      username: String(r[0]).trim(), 
      password: String(r[1]).trim(), 
      name: String(r[2]).trim(), 
      role: String(r[3]).trim().toLowerCase(), 
      dept: String(r[4]).trim() || 'ALL'
    }))
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
  
  // นำ orgData กลับมาจัดการเผื่อกรณีที่มีการ Save แบบเก่า
  // [FIX] ถ้ามี FILE_ID เดิม ให้เขียนทับไฟล์เดิมแทนการสร้างไฟล์ใหม่ทุกครั้ง
  if(data.orgData) {
    const existingRef = getLatestDataKeyValue(sheet, 'orgData');
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
      } catch(e) { res[key] = []; } 
    } else { 
      try { res[key] = JSON.parse(val); } catch(e) { res[key] = []; } 
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

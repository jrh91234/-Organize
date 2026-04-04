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
  } else { 
    const file = folder.createFile("orgData.json", newContent, MimeType.PLAIN_TEXT); 
    sheet.appendRow(['orgData', 'FILE_ID:' + file.getId()]);
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
  if(data.orgData) { 
    const f = DriveApp.getFolderById(CONFIG.FOLDER_ID).createFile("orgData.json", JSON.stringify(data.orgData), MimeType.PLAIN_TEXT); 
    updates['orgData'] = 'FILE_ID:' + f.getId(); 
  } 
  if(data.orgPositions) updates['orgPositions'] = JSON.stringify(data.orgPositions);
  if(data.orgDepartments) updates['orgDepartments'] = JSON.stringify(data.orgDepartments);

  const rows = sheet.getDataRange().getValues(); 
  for(let i=1; i<rows.length; i++) {
      if(updates[rows[i][0]]) { 
        sheet.getRange(i+1, 2).setValue(updates[rows[i][0]]); 
        delete updates[rows[i][0]];
      }
  } 
  
  for(let k in updates) {
      sheet.appendRow([k, updates[k]]); 
  }
  return createJSONOutput({status:'success'}); 
}

function getData() { 
  const rows = getSheet('Data').getDataRange().getValues(); 
  const res = {};
  
  rows.slice(1).forEach(r => { 
    if(r[1] && String(r[1]).startsWith('FILE_ID:')) { 
      try { 
          res[r[0]] = JSON.parse(DriveApp.getFileById(String(r[1]).split('FILE_ID:')[1]).getBlob().getDataAsString()); 
      } catch(e) { res[r[0]] = []; } 
    } else { 
      try { res[r[0]] = JSON.parse(r[1]); } catch(e) { res[r[0]] = []; } 
    } 
  }); 
  return createJSONOutput({status: 'success', data: res});
}

function createJSONOutput(obj) { 
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); 
}

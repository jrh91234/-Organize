# Auto deploy Apps Script (GitHub Actions)

ทุกครั้งที่ `scr/backend.gs` เปลี่ยนบน `main` workflow `.github/workflows/deploy-apps-script.yml` จะ:

1. ดึงโปรเจกต์ Apps Script ปัจจุบันมา เพื่อเก็บ `appsscript.json` (การตั้งค่า Web app) ไว้เหมือนเดิม
2. แทนที่โค้ดฝั่ง server ทั้งหมดด้วย `scr/backend.gs`
   - ไฟล์ `.gs` อื่นในโปรเจกต์ เช่น `Code.gs` จะถูกลบ
3. `clasp push` แล้ว `clasp deploy -i <deploymentId>` เพื่ออัปเดต deployment เดิม **URL `/exec` จึงไม่เปลี่ยน**

ถ้ายังไม่ได้ตั้งค่า secrets workflow จะข้ามการ deploy แสดงแค่ warning และไม่ fail

กด deploy เองได้ที่แท็บ **Actions → Deploy Apps Script → Run workflow**

## ตั้งค่าครั้งแรก

1. **เปิด Apps Script API** ด้วยบัญชี Google ที่เป็นเจ้าของสคริปต์: https://script.google.com/home/usersettings → เปิด *Google Apps Script API*
2. **สร้าง credential** บนเครื่องตัวเอง (ต้องมี Node.js):
   ```bash
   npm install -g @google/clasp@2.4.2
   clasp login
   ```
   จะได้ไฟล์ `~/.clasprc.json` (Windows: `C:\Users\<ชื่อ>\.clasprc.json`)
3. **หา Script ID**: เปิดโปรเจกต์ Apps Script → ⚙ Project Settings → *Script ID*
4. **ใส่ Secrets ใน GitHub**: repo → Settings → Secrets and variables → Actions → *New repository secret*
   - `CLASPRC_JSON` = เนื้อหาทั้งหมดของไฟล์ `.clasprc.json`
   - `APPS_SCRIPT_ID` = Script ID จากข้อ 3
5. (ถ้า URL ของ Web app ไม่ใช่ตัวที่อยู่ใน `index.html`) เพิ่ม **Variable** `APPS_SCRIPT_DEPLOYMENT_ID`
   - ค่าคือส่วนของ URL ระหว่าง `/s/` กับ `/exec`

> `CLASPRC_JSON` ให้สิทธิ์เข้าถึง Apps Script/Drive ของบัญชีนั้น
> - ห้ามแชร์หรือ commit ลง repo
> - ถ้าหลุด ให้เพิกถอนสิทธิ์ที่ https://myaccount.google.com/permissions (รายการ *clasp*)

## ยอดรวมเช็คชื่อสำหรับ dashboard ฝ่ายผลิต

Backend เปิด action `getAttendanceCounts` สำหรับอ่านจำนวนผู้เช็คเข้างานในรอบวันผลิตปัจจุบัน (08:00–08:00)
จำกัดเฉพาะแผนก Assembly ทีม H9 แล้วตอบกลับเฉพาะยอดรวมตามกะ ไม่ส่งชื่อ รหัสพนักงาน หรือรายการเช็คชื่อรายคน
นับเฉพาะรายการประเภท `work`; รายการ OT ไม่นับซ้ำเป็นคนอีกคน
Action นี้เรียกได้โดยไม่ต้องมี attendance token เพราะข้อมูลตอบกลับเป็นยอดรวมเท่านั้น

ตัวอย่างเรียกผ่าน POST `text/plain`:

```json
{"action":"getAttendanceCounts"}
```

การแก้ `scr/backend.gs` จะเปิด Auto deploy ที่ `/exec` เดิมตาม workflow ด้านบน

## Assembly Super App SSO (login ครั้งเดียวจาก Super App)

ผู้ใช้ที่ login ที่ [Assembly Super App](https://jrh91234.github.io/Assembly-super-app/) และได้รับสิทธิ์แอป **Organize (HR)**
จะเข้าระบบได้เลยโดยไม่ต้องกรอก Username/Password (action `ssoLogin` ใน `scr/backend.gs`)

- Username ของ Super App = Username ในชีต `Users` ถ้ายังไม่มีจะสร้างแถวให้ (รหัสผ่านสุ่ม = login ด้วยรหัสผ่านไม่ได้จนกว่า admin จะตั้งให้)
  ถ้ามีอยู่แล้ว ชื่อ, Role และแผนกจะอัปเดตตามที่ตั้งใน Super App ทุกครั้งที่ SSO login
- Role ที่รับ: `admin`, `supervisor`, `leader`, `viewer` และแผนกตั้งได้ในหน้า Admin ของ Super App
- login ด้วย Username/Password แบบเดิมยังใช้ได้

ตั้งค่าครั้งเดียวหลัง deploy:
1. Apps Script → Project Settings → Script Properties เพิ่ม `SUPERAPP_AUTH_URL` = URL `/exec` ของ auth กลาง
2. SSO ใช้ `UrlFetchApp` (scope `script.external_request`) เจ้าของสคริปต์ต้องเปิด Apps Script editor
   แล้วรันฟังก์ชัน `authorizeSuperAppSso` หนึ่งครั้งเพื่อกดอนุญาต
   ถ้า `appsscript.json` ในโปรเจกต์กำหนด `oauthScopes` ไว้เอง ต้องเพิ่ม `https://www.googleapis.com/auth/script.external_request` ด้วย

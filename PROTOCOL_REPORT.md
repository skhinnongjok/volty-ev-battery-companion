# รายงานประเมิน ANT-BLE24CACB-1272

อัปเดต: 1 ตุลาคม 2026

## ข้อสรุป

ความเป็นไปได้สูงว่า `ANT-BLE24CACB-1272 / 24CACB00-231213A` ใช้ ANT new protocol (2021+) ผ่าน BLE UART-like service:

| รายการ | ค่าใน MVP |
| --- | --- |
| BLE service | `0000FFE0-0000-1000-8000-00805F9B34FB` |
| Notify/write characteristic | `0000FFE1-0000-1000-8000-00805F9B34FB` |
| Write mode | write-with-response |
| New protocol header/trailer | `7E A1` / `AA 55` |
| Status request | `7E A1 01 00 00 BE 18 55 AA 55` |
| Device-info request | `7E A1 02 6C 02 20 58 C4 AA 55` |
| Status response function | `0x11` |
| CRC | CRC-16/Modbus, init `FFFF`, polynomial `A001`, low byte first |

ระดับความมั่นใจ: **ยืนยันกับฮาร์ดแวร์จริงแล้วสำหรับการอ่านข้อมูล** รุ่น `24CACB` เชื่อมผ่าน FFE0/FFE1, ตอบ device-info และส่ง status telemetry พร้อม CRC ถูกต้องต่อเนื่อง ส่วนคำสั่งเขียน/control ยังไม่ได้ทดสอบและอยู่นอกขอบเขต MVP

## ผลทดสอบฮาร์ดแวร์จริง 1 ตุลาคม 2026

- Device name: `ANT-BLE24CACB-1272`
- Device-info response: hardware `24ZHK0RCBG100A`, software `24CACB00-231213A`
- บันทึก status response 27 เฟรม; CRC ผ่าน 27/27 และไม่มี parse error
- Response function `0x11`; payload length ของ firmware นี้คือ `0xA8` (168 ไบต์) แม้ตัวอย่าง reverse-engineering รุ่นอื่นใช้ `0x8E` (142 ไบต์)
- จำนวนเซลล์ 20, temperature sensors 4
- ชุดข้อมูลขณะ idle: pack 80.56 V, current 0 A, SOC 92%, SOH 100%, full capacity 24 Ah, remaining 21.853 Ah
- ช่วง cell voltage 3.906–4.071 V, delta 165 mV, ค่าเฉลี่ยที่ BMS รายงาน 4.028 V
- max/min cell index เป็นเลขฐาน 1: max cell 17, min cell 2
- Decoder ใช้ตำแหน่งแบบ dynamic ตามจำนวนเซลล์/temperature จึงรองรับ payload `0xA8` ได้โดยไม่แก้ offset หลัก
- เก็บเฟรมจริงที่ตัดข้อมูลระบุตัวบุคคลออกแล้วเป็น regression fixture `tests/fixtures/24cacb-idle.hex`

## หลักฐานที่ใช้

1. หน้า Download ของผู้ผลิตมี official iOS, Android, Windows app, คู่มือ และ specification แต่ไม่มี public BLE API/protocol document
2. คู่มือทางการระบุให้เลือก Bluetooth name ที่ขึ้นต้นด้วย `ANT` และหน้า realtime แสดง SOC, total voltage, current, cell voltage, temperature และ protection/warning
3. การ reverse-engineer official Android APK รุ่น 2024 พบ FFE0/FFE1, status request `7E A1...`, device-info request และ payload layout ของ protocol 2021+
4. `syssi/esphome-ant-bms` มี BLE implementation และรายชื่อรุ่นใหม่ใกล้เคียง เช่น `ANT-BLE24BHUB` software ปี 2021 และ `ANT-BLE04DMUB` software ปี 2024 แต่ยังไม่มี `24CACB`
5. firmware ของเครื่องเป้าหมายลงท้าย `231213A` ซึ่งสอดคล้องกับวันที่ 13 ธันวาคม 2023 และอยู่หลังการเปลี่ยนไปใช้ new protocol หลายปี จึงทำให้ legacy `DB DB` มีโอกาสน้อยกว่า

## ผลจาก official Windows package รุ่น 2024-09-25

ตรวจไฟล์ที่ผู้ใช้ให้มาแบบ static โดยไม่รัน executable:

- `AntBMS.exe` เป็น .NET Framework 4.6 assembly; สำเนาในโฟลเดอร์หลักและ `app.publish` มี SHA-256 เดียวกัน: `5b6f69bf9da63eb5e16eec17ae234547bf305c88837a4f3c2020e86ee17a5d10`
- PDB เปิดเผยชื่อ source `MaYiSystem/Form1.cs` และเมธอด `CheckCrc16`, `ReadData`, `WriteData`, `AntProtocol_RxBufFindBmsPort`, `BMSControl_Response` ซึ่งตรงกับ architecture ที่ reverse-engineer จาก mobile app
- Windows app ใช้ `System.IO.Ports.SerialPort` และมีตัวเลือก baud rate จึงยืนยัน protocol ฝั่ง application/serial แต่ **ไม่ได้ยืนยัน BLE GATT UUID FFE0/FFE1 โดยตรง**; UUID ยังอาศัยหลักฐานจาก mobile APK และ BLE implementations
- `Languages/English.xml` มี protection mask 64 บิต, warning/state mask 64 บิต และสถานะ charge/discharge MOS; นำชื่อบิตมาเพิ่มใน decoder แล้ว
- ช่อง `WarningMack` ของโปรแกรมรวม normal state flags เช่น Charging, Discharging, MOS on และ Auto balance อยู่ด้วย แอปจึงต้องแยก status flags ออกจาก warning จริง ไม่เช่นนั้นจะรายงานคำเตือนผิดตลอดเวลา
- log ตัวอย่างระบุ software `24BHUBD0-220501A` และมีค่ารายเซลล์/กระแส แสดงว่า package รองรับตระกูล ANT 24S รุ่นใกล้เคียง แต่ยังไม่ใช่หลักฐานทดสอบ exact model `24CACB`

## แหล่งข้อมูลหลัก

- ผู้ผลิต: [ANT BMS Download](https://antbms.vip/download/)
- ผู้ผลิต: [ANT BMS App User Manual](https://antbms.vip/ant-bms-app-user-manual-download/)
- Reverse engineering official APK: [motormed-canbus/ANTBMS.md](https://github.com/snooplsm/motormed-canbus/blob/main/ANTBMS.md)
- Implementation ที่มีผู้ใช้งานจริง: [syssi/esphome-ant-bms](https://github.com/syssi/esphome-ant-bms)
- Python tools สำหรับสำรวจ BLE/UART: [tygv/antbms-python](https://github.com/tygv/antbms-python)
- Python implementation และเอกสาร serial protocol: [tygv/ANTbms-Python-Bluetooth-Interface](https://github.com/tygv/ANTbms-Python-Bluetooth-Interface)

## สิ่งที่ต้องทดสอบกับ BMS จริง

ทำตามลำดับนี้โดยจอดรถ ปลดโหลดกำลังสูง และเปิดแอป ANT BMS เดิมไว้สำหรับเทียบค่า (แต่อย่าเชื่อม Bluetooth พร้อมกันสองแอป):

1. ตรวจว่า service `FFE0` และ characteristic `FFE1` ถูกค้นพบ
2. ส่ง device-info request แล้วดูว่าได้ response `0x12` และ string hardware/software ตรงกับ `24ZHK0RCBG100A` / `24CACB00-231213A`
3. ส่ง status request แล้วต้องได้ frame `0x11`, payload length `0x8E`, CRC ถูก และ `N_cell = 20`
4. เทียบ pack voltage, SOC, cell 1–20 และอุณหภูมิกับ official app ขณะไม่มีโหลด
5. เปิดไฟ/โหลดต่ำเพื่อยืนยันสเกลและเครื่องหมาย current; คู่มือทางการบอกว่าชาร์จติดลบและคายประจุไม่ติดลบ
6. เสียบ charger เพื่อยืนยัน status code และ current direction
7. ตรวจ min/max cell index ว่า firmware ใช้เลขฐาน 0 หรือฐาน 1 (หน้าจอ MVP ใช้ค่าจาก array จริง จึงไม่พึ่ง index นี้)
8. เก็บ JSON log ใน 3 สถานะ: idle, discharge, charge เพื่อสร้าง regression fixtures
9. ถ้าไม่มี notification ให้ export raw log แล้วตรวจ GATT ด้วย nRF Connect; อาจต้องปรับ UUID, request length, MTU หรือเวลาเว้นระหว่างคำสั่ง
10. ถ้าพบ frame `DB DB` ให้เพิ่ม legacy decoder แยกต่างหาก ห้ามพยายามตีความด้วย 2021+ layout

## ทางไป production

หลังยืนยันสาม log ข้างต้นแล้ว สามารถย้าย decoder เดิมไปแอป native ได้โดยไม่เปลี่ยน UI model มากนัก สำหรับ Android ใช้ Capacitor BLE/React Native BLE/Flutter Blue Plus ได้ ส่วน iOS ต้องใช้ native BLE wrapper เพราะ Safari ไม่มี Web Bluetooth การเขียน parameter และ BMS control ควรเป็นเฟสหลังและต้องมี confirmation + permission guard แยกจาก read-only dashboard อย่างชัดเจน

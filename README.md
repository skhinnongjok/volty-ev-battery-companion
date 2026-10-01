# VOLTY — Your EV battery companion

ต้นแบบ dashboard แบบ read-only สำหรับอ่าน ANT BMS ผ่าน Bluetooth Low Energy (BLE) โดยเน้นรุ่น:

- Bluetooth name: `ANT-BLE24CACB-1272`
- Software: `24CACB00-231213A`
- Hardware: `24ZHK0RCBG100A`
- Battery pack: 20S

สถานะการรองรับ: **ยืนยันการเชื่อมต่อและอ่านข้อมูลจริงแล้ว** เมื่อ 1 ตุลาคม 2026 จากอุปกรณ์ชื่อและ version ตรงกัน โดยตรวจ CRC ผ่านต่อเนื่อง 27 เฟรม

แอปทำงานในเบราว์เซอร์ด้วย Web Bluetooth จึงไม่ต้องมี backend, account หรือ cloud และไม่มีคำสั่งแก้ parameter / เปิดปิด MOS ของ BMS

## เปิดใช้งาน

ต้องใช้ Chrome หรือ Edge บน Android, Windows, macOS หรือ Linux (Safari/iPhone ยังไม่รองรับ Web Bluetooth) และหน้าเว็บต้องมาจาก `localhost` หรือ HTTPS

```bash
npm run dev
```

เปิด `http://localhost:5173` แล้วกดปุ่ม Bluetooth ตรงกลางเมนูด้านล่างหรือปุ่ม **เลือกอุปกรณ์**

- อุปกรณ์ที่เคยอนุญาตไว้จะแสดงเป็นรายการในแอปและแตะเชื่อมต่อได้ทันที
- กด **ค้นหาอุปกรณ์ใหม่** เพื่อเปิดรายการ Bluetooth ของ Chrome แล้วเลือก `ANT-BLE24CACB-1272`
- แอปไม่มีโหมดจำลองอีกต่อไป ทุกค่าบน dashboard มาจาก BMS ที่เชื่อมต่อจริงเท่านั้น

ข้อจำกัดของ Web Bluetooth คือเว็บไซต์ไม่สามารถสแกนและแสดงอุปกรณ์ใหม่ทั้งหมดด้วยหน้าตาของตัวเองได้ การอนุญาตอุปกรณ์ใหม่ครั้งแรกจึงต้องทำผ่านหน้าต่างเลือกอุปกรณ์ของ Chrome

## สิ่งที่ MVP อ่านได้

- Battery / SOC และ SOH
- Pack voltage
- Current พร้อมแยกชาร์จ/คายประจุ
- อุณหภูมิ external sensors, MOS และ balancer (แสดงค่าร้อนสุด)
- Cell voltage สูงสุด 20 เซลล์ พร้อม min/max/delta/average
- Charge MOS, discharge MOS, balancer state
- Protection/warning แบบแยกรายการตาม bit map จาก official Windows app (พร้อมกัน normal state flags ออกจาก warning)
- Raw TX/RX log และ export เป็น JSON เพื่อช่วยตรวจ protocol กับเครื่องจริง
- Hardware/software version response (หาก firmware ตอบกลับ)
- Trip Tracking พร้อม GPS distance, elapsed time และ BMS snapshots ระหว่างทาง
- เริ่ม Trip Tracking อัตโนมัติเมื่อเชื่อมต่อ Bluetooth สำเร็จ และไม่จบทริปเมื่อสัญญาณหลุดชั่วคราว
- Trip Summary แสดง SOC/Ah/พลังงาน/Wh ต่อ km/อุณหภูมิ/cell delta และเก็บประวัติใน IndexedDB บนเครื่อง

## โครงสร้าง

- `src/protocol.js` — CRC, frame validation, fragmented-notification assembler และ decoder
- `src/ble.js` — Web Bluetooth transport สำหรับ FFE0/FFE1 และ polling
- `src/app.js` — UI state สำหรับข้อมูลจริง, ตัวเลือกอุปกรณ์ และ log export
- `src/trips.js` — GPS distance, Trip Summary และ local IndexedDB storage
- `tests/protocol.test.js` — test vector ของ CRC, 20S decoder, fragmentation และ corruption
- `PROTOCOL_REPORT.md` — หลักฐาน การประเมิน protocol และรายการทดสอบกับ BMS จริง

## ตรวจสอบโค้ด

```bash
npm test
npm run check
```

## ข้อจำกัดสำคัญ

- รุ่น `24CACB` ผ่านการทดสอบ BLE transport, device-info และ status telemetry กับฮาร์ดแวร์จริงแล้ว; control/write commands ยังไม่ได้ทดสอบและ MVP ไม่ได้เปิดใช้งาน
- ทิศทางเครื่องหมายกระแสในคู่มือทางการระบุว่าชาร์จเป็นค่าติดลบ แต่ต้องเทียบกับแอปเดิมบน BMS จริงอีกครั้ง
- Protection/warning bit map มาจาก official Windows app รุ่น 2024-09-25 แต่ยังต้องยืนยันลำดับบิตกับ notification ของ firmware `24CACB`
- Web Bluetooth ไม่รองรับ iOS Safari; รุ่น production สำหรับ iPhone ควรย้าย protocol module ไป Capacitor/React Native/Flutter BLE
- แอปไม่รองรับ legacy frame `DB DB` นอกจากตรวจพบจาก raw log; BMS เป้าหมายคาดว่าไม่ใช่รุ่น legacy

## ความปลอดภัย

แอปนี้อ่านอย่างเดียวและไม่ควรใช้แทนระบบป้องกันของ BMS ห้ามทดลองขณะขับขี่ และควรเทียบค่าทุกช่องกับแอป ANT BMS เดิมก่อนนำไปใช้งานจริง

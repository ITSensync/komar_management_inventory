# Kontrak Integrasi RFID Reader Orange Pi

> Versi kontrak: 0.3 — API configuration, acknowledgment, retry/idempotensi, resume, status
> reader, heartbeat, dan safety stop sudah didefinisikan.

Dokumen ini adalah kontrak integrasi antara **repository hardware Orange Pi**
dan project KOMAR. Source code gateway, driver reader, parser USB Serial, serta
service systemd berada di repository hardware terpisah dan tidak disimpan di
project ini.

Project KOMAR hanya menyediakan:

- WebSocket backend pada `/ws`;
- scan session dan validasi assignment RFID;
- penyimpanan ke MySQL;
- dashboard realtime.

## 1. Arsitektur

```text
RFID Reader USB Serial
        |
        | /dev/ttyUSB* atau /dev/ttyACM*
        v
Orange Pi Gateway (repository terpisah)
        |
        | WebSocket /ws
        v
KOMAR API (port 3000)
        |
        +--> MySQL: rfid_scan_sessions, rfid_scan_events, rfid_tags
        |
        +--> WebSocket dashboard
```

Orange Pi tidak boleh mengakses MySQL secara langsung. Backend KOMAR menjadi
satu-satunya pihak yang memvalidasi dan menyimpan assignment RFID.

## 2. Tanggung jawab repository hardware

Repository Orange Pi harus menangani:

1. membuka device USB Serial reader;
2. mengatur baud rate, data bits, stop bits, dan parity;
3. membaca serta mem-parsing frame sesuai dokumentasi vendor reader;
4. normalisasi UID menjadi string uppercase;
5. koneksi WebSocket ke backend KOMAR;
6. reconnect ketika koneksi backend atau reader terputus;
7. pengiriman `event_id` unik untuk setiap event;
8. penerimaan command start/stop reader;
9. debounce lokal bila reader mengirim UID berulang.

Parser tidak boleh menebak offset UID untuk protokol binary. Format frame dan
parameter serial harus disesuaikan dengan manual reader yang digunakan.

## 3. Konfigurasi yang diperlukan

Gateway hardware membutuhkan konfigurasi berikut:

```env
BACKEND_WS_URL=ws://192.168.18.16:3000/ws
RFID_GATEWAY_TOKEN=token_yang_sama_dengan_backend
RFID_READER_CODE=orangepi-reader-01
READER_DEVICE=/dev/serial/by-id/usb-ReaderVendor_RFID_123-if00
READER_BAUD_RATE=115200
READER_DATA_BITS=8
READER_STOP_BITS=1
READER_PARITY=none
```

Jika path stabil `/dev/serial/by-id` belum tersedia, gateway dapat memakai
`/dev/ttyUSB0`, tetapi nomor `ttyUSB` dapat berubah setelah reboot atau USB
reconnect. Path `/dev/serial/by-id` lebih disarankan.

Pastikan user yang menjalankan gateway memiliki akses serial:

```bash
sudo usermod -aG dialout orangepi
```

Logout/login atau reboot Orange Pi setelah mengubah group.

Untuk deployment HTTPS, gunakan `wss://` dan reverse proxy TLS.

### 3.1 Konfigurasi backend API

Backend KOMAR menggunakan konfigurasi berikut pada file `.env` server:

```env
# Port host Docker yang dipakai untuk mengekspos API.
API_PORT=3000
RFID_GATEWAY_TOKEN=ganti_dengan_token_acak_yang_panjang
RFID_READER_CODE=orangepi-reader-01

# Opsional untuk banyak gateway.
# RFID_READER_CODES=orangepi-reader-01,orangepi-reader-02

RFID_LOG_LEVEL=info
LOG_HEALTH_REQUESTS=false
```

Jika gateway berjalan di luar Docker, gunakan IP LAN server. Jangan gunakan
hostname Docker `api` dari Orange Pi:

```text
Benar: ws://192.168.18.16:3000/ws
Salah: ws://api:3000/ws
```

`api:3000` hanya dapat digunakan oleh container lain dalam network Docker.
Di dalam container, service API tetap listen pada port `3000`; `API_PORT` adalah
port host yang dipetakan oleh Docker Compose.

### 3.2 Konfigurasi frontend

Frontend memakai REST API melalui path `/api` dan WebSocket backend. Secara
default URL WebSocket dibentuk dari hostname browser dengan port `3000`.

Jika host/port backend berbeda, set saat build web:

```env
NEXT_PUBLIC_RFID_WS_URL=ws://192.168.18.16:3000/ws
NEXT_PUBLIC_RFID_READER_CODE=orangepi-reader-01
```

Frontend tidak mengirim token gateway. Token hanya digunakan oleh gateway
hardware saat handshake dengan backend.

## 4. REST API lifecycle scan

Gateway hardware tidak perlu memanggil REST API. Frontend membuat dan
menghentikan scan session, sedangkan backend mengirim command ke gateway melalui
WebSocket.

### Membuat scan session

```http
POST /api/po-session-items/{itemId}/rfid-scan-sessions
Content-Type: application/json
```

```json
{
  "reader_code": "orangepi-reader-01",
  "ttl_seconds": 600
}
```

`ttl_seconds` default `600`, minimum `30`, maksimum `3600`.

Response `201`:

```json
{
  "success": true,
  "data": {
    "id": "scan-session-uuid",
    "po_session_item_id": "item-uuid",
    "reader_code": "orangepi-reader-01",
    "status": "starting",
    "expires_at": "2026-11-17T10:30:00.000Z"
  }
}
```

Status HTTP yang mungkin:

| HTTP | Arti |
|---:|---|
| `201` | Scan session berhasil dibuat |
| `400` | Request tidak valid |
| `404` | Item tidak ditemukan |
| `409` | Item/reader sedang dipakai atau session tidak aktif |
| `503` | Gateway dengan `reader_code` belum terhubung |

### Melihat detail scan session

```http
GET /api/rfid-scan-sessions/{scanSessionId}
```

### Melihat progress RFID

```http
GET /api/po-session-items/{itemId}/rfid-progress
```

Contoh response:

```json
{
  "success": true,
  "data": {
    "po_session_item_id": "item-uuid",
    "required_rfid_count": 10,
    "assigned_rfid_count": 6,
    "remaining_rfid_count": 4,
    "status": "pending_tags"
  }
}
```

### Menghentikan scan session

```http
POST /api/rfid-scan-sessions/{scanSessionId}/stop
```

Backend mengubah session menjadi `stopped` dan mengirim `reader.stop` jika
gateway sedang terhubung.

### Endpoint scan manual/fallback

Jika hardware belum tersedia, frontend tetap dapat menggunakan:

```http
POST /api/po-session-items/{itemId}/rfid-scans
Content-Type: application/json
```

```json
{
  "rfid_tags": ["E2806894000040168D432183"]
}
```

## 5. Lifecycle end-to-end

```text
Gateway connect dan handshake
        ↓
Admin klik Scan RFID
        ↓
FE POST membuat scan session
        ↓
Backend menyimpan session status starting
        ↓
Backend mengirim reader.start
        ↓
Gateway membuka USB Serial
        ↓
Gateway mengirim reader.ready
        ↓
Backend mengubah session menjadi active
        ↓
Reader membaca UID
        ↓
Gateway mengirim rfid.detected
        ↓
Backend validasi + transaksi assignment
        ↓
Backend mengirim rfid.ack ke gateway
        ↓
Backend mengirim scan.result ke dashboard
        ↓
Semua tag lengkap → reader.stop
```

## 6. Urutan proses scan

```text
Admin klik Scan RFID
        ↓
FE membuat scan session ke API
        ↓
API mengirim reader.start ke gateway Orange Pi
        ↓
Gateway membuka device USB Serial reader
        ↓
Reader membaca UID
        ↓
Gateway mengirim rfid.detected ke API
        ↓
API memvalidasi dan menyimpan assignment ke DB
        ↓
API mengirim scan.result ke dashboard
        ↓
Semua tag lengkap → API mengirim reader.stop
```

## 7. Protokol WebSocket

### 7.1 Gateway → backend: handshake

```json
{
  "type": "hello",
  "role": "gateway",
  "reader_code": "orangepi-reader-01",
  "token": "..."
}
```

Backend membalas:

```json
{
  "type": "hello.accepted",
  "role": "gateway",
  "reader_code": "orangepi-reader-01"
}
```

### 7.2 Backend → gateway: mulai membaca

```json
{
  "type": "reader.start",
  "scan_session_id": "uuid",
  "item_id": "uuid",
  "expires_at": "2026-11-17T10:30:00.000Z"
}
```

Gateway membuka koneksi reader dan mengirim:

```json
{
  "type": "reader.ready",
  "status": "ready",
  "scan_session_id": "uuid"
}
```

### 7.3 Gateway → backend: UID terbaca

```json
{
  "type": "rfid.detected",
  "event_id": "uuid-baru-untuk-setiap-event",
  "scan_session_id": "uuid",
  "uid": "E2806894000040168D432183",
  "observed_at": "2026-11-17T10:00:00.000Z"
}
```

`event_id` digunakan backend untuk mencegah event yang sama diproses dua kali.
`uid` harus berupa string dan tidak boleh kosong.

Backend mengirim acknowledgment ke gateway setelah assignment dan pencatatan
event berhasil di-commit ke database:

```json
{
  "type": "rfid.ack",
  "event_id": "uuid-baru-untuk-setiap-event",
  "scan_session_id": "uuid",
  "reader_code": "orangepi-reader-01",
  "uid": "E2806894000040168D432183",
  "status": "stored",
  "processed_at": "2026-11-17T10:00:01.000Z",
  "pack_plan_id": "uuid",
  "pack_number": 1,
  "remaining_rfid_count": 4
}
```

Nilai `status` acknowledgment:

| Status | Arti |
|---|---|
| `stored` | UID berhasil di-assign dan disimpan. |
| `duplicate` | Event/UID sudah pernah diproses; tidak membuat assignment baru. |
| `rejected` | UID tidak dapat diproses. Lihat `code` dan `message`. |

Kode yang umum diterima pada acknowledgment:

```text
event_id_replayed
duplicate_read
invalid_uid
already_assigned
no_remaining_pack
scan_not_active
scan_expired
scan_session_not_found
scan_rejected
```

Contoh UID ditolak:

```json
{
  "type": "rfid.ack",
  "event_id": "uuid",
  "scan_session_id": "uuid",
  "reader_code": "orangepi-reader-01",
  "uid": "E280...",
  "status": "rejected",
  "code": "already_assigned",
  "message": "RFID UID sudah digunakan.",
  "processed_at": "2026-11-17T10:00:01.000Z"
}
```

Gateway harus retry dengan `event_id` yang sama jika acknowledgment belum
diterima. Backend menjamin event ID yang sama tidak membuat assignment kedua.

### 7.4 Backend → gateway: berhenti membaca

```json
{
  "type": "reader.stop",
  "scan_session_id": "uuid"
}
```

Gateway harus menghentikan pembacaan dan menutup device USB Serial reader untuk
scan session tersebut.

Command `reader.stop` bersifat idempotent. Gateway juga wajib menutup reader
secara lokal ketika `expires_at` terlewati sebagai safety timeout, karena
perintah stop tidak dapat dijamin sampai jika jaringan terputus.

### 7.5 Status reader

Gateway mengirim status dengan bentuk berikut:

```json
{
  "type": "reader.status",
  "reader_code": "orangepi-reader-01",
  "scan_session_id": "uuid",
  "status": "error",
  "code": "SERIAL_OPEN_FAILED",
  "message": "Device serial tidak dapat dibuka.",
  "occurred_at": "2026-11-17T10:00:01.000Z"
}
```

Status yang diterima:

```text
connecting, ready, reading, stopped, error, offline
```

`scan_session_id` boleh `null` untuk status gateway umum. Status error tidak
langsung membatalkan session; gateway boleh retry membuka serial sampai session
berhenti atau expired.

Jika serial gagal dibuka, gateway disarankan memakai backoff:

```text
1s, 2s, 4s, 8s, 16s, 30s
```

## 8. Kontrak dashboard

Dashboard membuka WebSocket yang sama dengan role `dashboard`:

```json
{
  "type": "hello",
  "role": "dashboard"
}
```

Setelah API mengembalikan scan session, dashboard melakukan subscribe:

```json
{
  "type": "subscribe",
  "scan_session_id": "SCAN_SESSION_UUID"
}
```

Backend mengirim event berikut:

- `reader.ready` — gateway siap membaca;
- `reader.status` — status gateway/reader berubah;
- `scan.result` — UID berhasil atau ditolak oleh backend;
- `scan.duplicate` — UID yang sama baru saja terbaca;
- `scan.error` — session atau event bermasalah.

### 8.1 Penolakan handshake

Jika token salah atau `reader_code` tidak terdaftar, backend mengirim:

```json
{
  "type": "hello.rejected",
  "code": "INVALID_TOKEN",
  "message": "Gateway token tidak valid."
}
```

Kemudian koneksi ditutup dengan WebSocket close code `1008`.

## 9. Status dan kegagalan koneksi

- Gateway terputus → status offline dikirim ke dashboard; session tetap dapat
  dilanjutkan selama belum expired.
- Gateway reconnect → backend mengirim ulang `reader.start` dengan
  `scan_session_id` yang sama.
- Session yang sudah expired → ditandai `expired` dan tidak dapat dilanjutkan.
- Reader tidak dapat dijangkau → gateway mengirim `reader.status` dengan status
  `error`.
- Scan session melewati `expires_at` → backend menghentikan session.
- UID duplikat → tidak membuat assignment baru.
- UID sudah digunakan proses lain → backend mengirim error ke dashboard.
- Semua RFID lengkap → item berubah menjadi `ready_to_print`.

## 10. Checklist integrasi hardware

- [ ] Reader terdeteksi sebagai `/dev/ttyUSB*` atau `/dev/ttyACM*`.
- [ ] Path `/dev/serial/by-id` sudah diperiksa dan dipakai bila tersedia.
- [ ] Baud rate, data bits, stop bits, dan parity sesuai manual reader.
- [ ] User gateway memiliki akses group `dialout`.
- [ ] Orange Pi dapat menjangkau `ws://<api-host>:3000/ws`.
- [ ] `RFID_GATEWAY_TOKEN` sama di kedua sisi.
- [ ] `RFID_READER_CODE` sama dengan konfigurasi backend.
- [ ] Parser sesuai protokol vendor reader.
- [ ] Setiap event memiliki `event_id` unik.
- [ ] Gateway melakukan reconnect dengan backoff.
- [ ] Gateway retry event menggunakan `event_id` yang sama sampai menerima ack.
- [ ] Gateway menutup reader lokal saat `expires_at` terlewati.
- [ ] Gateway tidak memiliki credential MySQL.
- [ ] Port API tidak diekspos ke internet.

## 11. Reliability dan keamanan

- Backend menggunakan WebSocket ping/pong setiap 30 detik untuk mendeteksi
  koneksi mati.
- `event_id` wajib unique dan tidak boleh berubah saat retry.
- `observed_at` dikirim dalam UTC ISO-8601; waktu server backend tetap menjadi
  acuan expiry dan waktu penerimaan.
- Untuk production gunakan `wss://`, bukan `ws://`.
- Token gateway harus unik, panjang, disimpan di environment, dan tidak boleh
  dicatat ke log atau dikirim ke chat.
- `RFID_READER_CODE` harus unik. Untuk beberapa gateway, backend dapat memakai
  daftar `RFID_READER_CODES` yang dipisahkan koma.

## 12. Database dan sumber kebenaran

Gateway tidak mengakses database. Backend menyimpan data melalui transaksi.

### `rfid_scan_sessions`

Menyimpan lifecycle sesi realtime:

```text
id
po_session_item_id
reader_code
status
started_at
stopped_at
expires_at
last_event_at
```

### `rfid_scan_events`

Menyimpan event UID dan hasil pemrosesannya:

```text
id
rfid_scan_session_id
event_id        UNIQUE
rfid_number
observed_at
status
error_code
result          JSON
```

`event_id` digunakan untuk idempotensi retry. Assignment RFID tetap menggunakan
tabel existing:

```text
rfid_tags
po_pack_plans
po_session_items
```

## 13. Retry, idempotensi, dan resume

### Retry event UID

Gateway dapat menyimpan outbox lokal dengan state:

```text
pending → sent → stored/duplicate/rejected
```

Jika koneksi terputus setelah event dikirim tetapi sebelum ACK diterima:

1. gateway reconnect;
2. gateway mengirim ulang payload yang sama;
3. `event_id` tetap sama;
4. backend tidak membuat assignment kedua;
5. backend mengirim ACK final.

Gateway tidak boleh membuat `event_id` baru untuk retry event yang sama.

### Resume session

Jika gateway disconnect sementara:

- backend mengirim status `offline` ke dashboard;
- session `starting`/`active` tetap valid selama belum expired;
- gateway handshake ulang;
- backend mengirim ulang `reader.start` dengan session ID yang sama;
- gateway membuka ulang USB Serial dan mengirim `reader.ready`.

Jika `expires_at` terlewati, session berubah menjadi `expired` dan event baru
untuk session tersebut ditolak.

### Backoff koneksi

Gunakan exponential backoff:

```text
1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
```

## 14. State machine

### Scan session

```text
starting → active → completed
    |         |
    |         +→ stopped
    +→ failed/expired
```

| Status | Arti |
|---|---|
| `starting` | Session dibuat, menunggu reader ready |
| `active` | Reader siap membaca |
| `completed` | Semua RFID item sudah terpasang |
| `stopped` | User/backend menghentikan scan |
| `failed` | Error fatal pemrosesan backend |
| `expired` | Melewati `expires_at` |

### Item PO

```text
pending_tags → ready_to_print → printed
```

### Pack plan

```text
pending_tag → tag_assigned → label_printed
```

## 15. Logging dan observability

Log integrasi backend ditulis ke stdout container:

```bash
docker compose logs -f --tail=0 api
```

Contoh log:

```text
[KOMAR][INFO] gateway.connected
[KOMAR][INFO] scan.started
[KOMAR][INFO] gateway.command_sent
[KOMAR][INFO] gateway.reader.ready
[KOMAR][INFO] rfid.event_received
[KOMAR][INFO] rfid.assigned
[KOMAR][INFO] scan.completed
```

Untuk log lebih detail:

```env
RFID_LOG_LEVEL=debug
```

Log hardware berada di repository/service Orange Pi. Token dan credential
database tidak boleh dicatat ke log.

## 16. Keamanan production

- Gunakan token gateway yang panjang dan acak.
- Gunakan token berbeda untuk setiap gateway jika jumlah reader bertambah.
- Jangan commit token ke repository.
- Jangan mengirim credential MySQL ke Orange Pi.
- Gunakan `wss://` pada production.
- Batasi port API dengan firewall/VPN/reverse proxy.
- Jangan mengandalkan CORS sebagai satu-satunya keamanan WebSocket.
- Pastikan `reader_code` unik.

## 17. Prosedur instalasi dan pengujian

### Verifikasi USB Serial

```bash
lsusb
dmesg | grep -E "ttyUSB|ttyACM"
ls -l /dev/serial/by-id/
```

Pastikan user gateway dapat membaca device:

```bash
stat "$READER_DEVICE"
```

### Verifikasi network

```bash
ping 192.168.18.16
nc -vz 192.168.18.16 3000
```

### Verifikasi backend

```bash
curl http://192.168.18.16:3000/health
```

Expected:

```json
{
  "status": "OK",
  "message": "Server is running"
}
```

### Verifikasi handshake

Expected log backend:

```text
[KOMAR][INFO] gateway.connected
```

Expected response gateway:

```json
{
  "type": "hello.accepted",
  "role": "gateway",
  "reader_code": "orangepi-reader-01"
}
```

### Verifikasi scan end-to-end

1. Buka dashboard.
2. Buka session PO aktif.
3. Klik **Scan RFID**.
4. Pastikan gateway menerima `reader.start`.
5. Pastikan gateway mengirim `reader.ready`.
6. Dekatkan satu tag RFID.
7. Pastikan backend menerima `rfid.detected`.
8. Pastikan gateway menerima `rfid.ack` status `stored`.
9. Pastikan dashboard menampilkan UID dan progress baru.
10. Kirim ulang event yang sama dan pastikan tidak ada assignment kedua.
11. Tutup scanner dan pastikan gateway menerima `reader.stop`.

## 18. Troubleshooting

| Gejala | Pemeriksaan |
|---|---|
| Gateway tidak mendapat `hello.accepted` | Cek token, `reader_code`, URL WS, dan log API |
| `INVALID_TOKEN` | Token gateway dan backend tidak sama |
| `UNKNOWN_READER` | `reader_code` tidak ada di allowlist backend |
| Reader tidak terbuka | Cek device, group `dialout`, baud rate, dan permission |
| Tidak ada UID | Cek parser frame dan konfigurasi serial vendor |
| ACK tidak diterima | Cek koneksi WS, event ID, dan log `rfid.event_received` |
| UID selalu duplicate | Periksa debounce dan retry `event_id` gateway |
| Session expired | Pastikan reader ready sebelum `expires_at` |
| Reconnect tidak resume | Pastikan gateway handshake ulang dan backend mengirim `reader.start` |
| Dashboard tidak update | Cek WebSocket browser dan subscription scan session |
| API log tidak update | Gunakan `docker compose logs -f api`, bukan hanya `web` |

## 19. Acceptance checklist

- [ ] Reader terdeteksi sebagai `/dev/ttyUSB*` atau `/dev/ttyACM*`.
- [ ] Path `/dev/serial/by-id` dipakai jika tersedia.
- [ ] Parameter serial sesuai manual reader.
- [ ] User gateway memiliki group `dialout`.
- [ ] Orange Pi dapat menjangkau API host pada port 3000.
- [ ] Gateway berhasil handshake.
- [ ] `reader_code` unik dan terdaftar.
- [ ] `reader.start` diterima gateway.
- [ ] `reader.ready` dikirim gateway.
- [ ] `rfid.detected` memiliki `event_id` unik.
- [ ] UID berhasil masuk database melalui backend.
- [ ] `rfid.ack` status `stored` diterima gateway.
- [ ] Retry memakai `event_id` yang sama.
- [ ] Duplicate event tidak membuat assignment kedua.
- [ ] `reader.status` error tampil di dashboard/log.
- [ ] Reconnect sebelum expiry melakukan resume.
- [ ] Expiry menutup reader secara lokal.
- [ ] `reader.stop` menutup USB Serial.
- [ ] `wss://` digunakan pada production.
- [ ] Token tidak tercetak di log.

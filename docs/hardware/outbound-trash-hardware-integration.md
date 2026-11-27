# Hardware Integration — Outbound dan Trash

Dokumen ini adalah panduan khusus untuk tim hardware yang mengintegrasikan
Orange Pi dan RFID reader untuk proses **outbound** dan **trash** KOMAR.

## 1. Batas tanggung jawab hardware

Hardware hanya bertugas untuk:

1. Terhubung ke WebSocket backend.
2. Melakukan handshake gateway.
3. Menerima perintah mulai/berhenti membaca.
4. Membaca UID RFID dari reader.
5. Mengirim UID ke backend.
6. Menerima acknowledgement dari backend.
7. Melakukan reconnect jika koneksi terputus.

Hardware **tidak** bertugas untuk:

- mengakses MySQL;
- menentukan apakah produk boleh outbound/trash;
- mengubah status stok;
- membuat inventory movement;
- melakukan preview produk;
- melakukan submit outbound/trash.

Semua aturan bisnis dan perubahan inventory dilakukan oleh backend dan web.

## 2. Identitas perangkat

Reader inbound/PO dan reader outbound/trash menggunakan perangkat berbeda:

| Fungsi | `reader_code` |
|---|---|
| Inbound/PO | `orangepi-reader-01` |
| Outbound/Trash | `orangepi-reader-02` |

Untuk dokumen ini, hardware harus menggunakan:

```text
orangepi-reader-02
```

Outbound dan trash boleh menggunakan reader fisik yang sama. Perbedaannya
hanya dikirim oleh backend pada `movement_type`.

## 3. Konfigurasi Orange Pi

Contoh konfigurasi lokal:

```json
{
  "api_ws_url": "ws://192.168.18.16:3000/ws",
  "reader_code": "orangepi-reader-02",
  "gateway_token": "SECRET_DARI_ADMIN",
  "reconnect": {
    "enabled": true,
    "initial_delay_ms": 1000,
    "max_delay_ms": 30000
  }
}
```

Untuk staging/production gunakan URL `wss://`:

```text
wss://api.example.com/ws
```

Jangan menggunakan:

```text
ws://localhost:3000/ws
ws://<web-host>:3001/ws
/api/ws
```

`localhost` pada Orange Pi menunjuk ke Orange Pi sendiri, bukan komputer yang
menjalankan backend.

## 4. Handshake WebSocket

Setelah terhubung ke `/ws`, pesan pertama wajib berupa:

```json
{
  "type": "hello",
  "role": "gateway",
  "token": "SECRET_DARI_ADMIN",
  "reader_code": "orangepi-reader-02"
}
```

Response berhasil:

```json
{
  "type": "hello.accepted",
  "role": "gateway",
  "reader_code": "orangepi-reader-02"
}
```

Jika token atau `reader_code` salah, backend mengirim `hello.rejected` lalu
menutup koneksi.

Contoh response ditolak:

```json
{
  "type": "hello.rejected",
  "code": "UNKNOWN_READER",
  "message": "reader_code tidak terdaftar di backend."
}
```

## 5. Flow outbound/trash

Flow lengkap:

```text
Operator membuka halaman web
        ↓
Web membuat terminal scan session
        ↓
Backend mengirim reader.start ke orangepi-reader-02
        ↓
Orange Pi mulai membaca UID
        ↓
Orange Pi mengirim rfid.detected
        ↓
Backend memvalidasi UID
        ↓
Backend mengirim rfid.ack
        ↓
Web menerima scan.result dan menampilkan produk
        ↓
Operator menghentikan reader
        ↓
Web meminta preview
        ↓
Operator melakukan submit outbound/trash
```

Hardware tidak perlu memanggil endpoint pembuatan session. Session dibuat oleh
web melalui backend.

## 6. Perintah `reader.start`

### Outbound

```json
{
  "type": "reader.start",
  "scan_session_id": "SESSION_UUID",
  "scan_type": "terminal_movement",
  "movement_type": "outbound",
  "expires_at": "2026-11-27T10:30:00.000Z"
}
```

### Trash

```json
{
  "type": "reader.start",
  "scan_session_id": "SESSION_UUID",
  "scan_type": "terminal_movement",
  "movement_type": "trash",
  "expires_at": "2026-11-27T10:30:00.000Z"
}
```

Perilaku reader untuk outbound dan trash sama. Hardware cukup membaca RFID dan
menggunakan `scan_session_id` yang diberikan backend.

## 7. Status reader

Hardware dapat mengirim status berikut:

```json
{
  "type": "reader.status",
  "reader_code": "orangepi-reader-02",
  "status": "ready",
  "scan_session_id": "SESSION_UUID"
}
```

Status yang didukung:

```text
connecting
ready
reading
stopped
error
offline
```

Saat reader siap membaca, gunakan status `ready`. Saat ada masalah pada reader,
gunakan `error` dan sertakan informasi error jika implementasi gateway memilikinya.

## 8. Event RFID

Setiap UID yang terbaca dikirim sebagai event:

```json
{
  "type": "rfid.detected",
  "reader_code": "orangepi-reader-02",
  "scan_session_id": "SESSION_UUID",
  "event_id": "READER-EVENT-UUID",
  "uid": "E2806894000040168D432183",
  "observed_at": "2026-11-27T10:30:01.000Z"
}
```

Field wajib:

| Field | Keterangan |
|---|---|
| `type` | Harus `rfid.detected` |
| `reader_code` | Harus `orangepi-reader-02` |
| `scan_session_id` | Diambil dari `reader.start` |
| `event_id` | ID unik untuk event RFID |
| `uid` | UID RFID hasil pembacaan |
| `observed_at` | Timestamp ISO-8601, direkomendasikan |

UID dikirim satu event per pembacaan. Backend akan melakukan normalisasi UID ke
uppercase.

## 9. Acknowledgement `rfid.ack`

### UID valid

```json
{
  "type": "rfid.ack",
  "event_id": "READER-EVENT-UUID",
  "scan_session_id": "SESSION_UUID",
  "reader_code": "orangepi-reader-02",
  "uid": "E2806894000040168D432183",
  "status": "stored",
  "processed_at": "2026-11-27T10:30:01.200Z",
  "movement_type": "outbound",
  "pack_plan_id": "PACK_PLAN_UUID",
  "pack_number": 1,
  "product_name": "Susu UHT 250 ml",
  "units": 5,
  "base_unit": "pcs"
}
```

Pada terminal movement, `stored` berarti UID masuk ke daftar preview. Status
inventory belum berubah sampai operator melakukan submit dari web.

### UID ditolak

```json
{
  "type": "rfid.ack",
  "event_id": "READER-EVENT-UUID",
  "scan_session_id": "SESSION_UUID",
  "reader_code": "orangepi-reader-02",
  "uid": "E2806894000040168D432183",
  "status": "rejected",
  "code": "RFID_NOT_REGISTERED",
  "message": "RFID tag is not registered.",
  "processed_at": "2026-11-27T10:30:01.200Z"
}
```

Status acknowledgement:

| Status | Arti |
|---|---|
| `stored` | UID valid untuk preview |
| `rejected` | UID tidak memenuhi validasi |
| `duplicate` | Event atau pembacaan sudah pernah diproses |

## 10. Validasi yang dilakukan backend

Untuk outbound/trash, backend memeriksa:

- UID sudah terdaftar;
- UID memiliki pack plan;
- pack plan bukan `cancelled`;
- `placement_status` saat ini adalah `placed`;
- paket memiliki lokasi rak aktif;
- UID belum berstatus `outbound` atau `trash`.

Hardware tidak perlu mengimplementasikan validasi tersebut.

## 11. Duplicate dan retry

`event_id` harus unik dan stabil.

Jika event belum mendapatkan response karena koneksi terputus, kirim ulang
payload yang sama dengan `event_id` yang sama. Jangan membuat `event_id` baru
untuk retry event yang sama.

Pembacaan UID yang sama dalam waktu singkat dapat diabaikan oleh backend sebagai
duplicate read. Gateway tidak perlu mengubah UID atau membuat event bisnis baru.

## 12. Stop dan expired session

Backend dapat mengirim:

```json
{
  "type": "reader.stop",
  "scan_session_id": "SESSION_UUID"
}
```

Reader harus menghentikan pembacaan untuk session tersebut.

Session juga dapat berhenti karena `expires_at`. Setelah menerima `reader.stop`
atau status session expired, jangan mengirim event baru menggunakan session lama.

## 13. Keamanan

- Gateway token hanya disimpan di Orange Pi dan backend.
- Jangan menaruh token di source code publik.
- Jangan mengirim token ke browser.
- Jangan menyimpan credential database di Orange Pi.
- Gunakan `wss://` di luar jaringan lokal.
- `reader_code` harus terdaftar pada `RFID_READER_CODES` backend.

Konfigurasi backend yang digunakan:

```env
RFID_READER_CODE=orangepi-reader-01
RFID_READER_CODES=orangepi-reader-01,orangepi-reader-02
```

## 14. Checklist testing hardware

Sebelum integrasi dinyatakan selesai, pastikan:

- [ ] Orange Pi dapat connect ke URL WebSocket backend.
- [ ] Handshake dengan `orangepi-reader-02` diterima.
- [ ] Token yang salah ditolak.
- [ ] `reader.start` diterima.
- [ ] Reader dapat mengirim status `ready`.
- [ ] UID dapat dikirim dengan `rfid.detected`.
- [ ] `rfid.ack` diterima untuk UID valid maupun invalid.
- [ ] Retry dengan `event_id` yang sama tidak menggandakan event.
- [ ] `reader.stop` menghentikan pembacaan.
- [ ] Reconnect otomatis berjalan setelah koneksi diputus.
- [ ] UID tampil di halaman web Outbound/Trash.
- [ ] Hardware tidak mengakses database secara langsung.

## 15. Troubleshooting

### `hello.rejected` dengan `UNKNOWN_READER`

Pastikan hardware menggunakan:

```text
orangepi-reader-02
```

dan backend memiliki:

```env
RFID_READER_CODES=orangepi-reader-01,orangepi-reader-02
```

### HTTP 503 saat web memulai reader

Artinya backend belum melihat gateway `orangepi-reader-02` terhubung. Periksa:

1. URL WebSocket pada Orange Pi.
2. Token gateway.
3. `reader_code`.
4. Port API `3000` dapat dijangkau dari Orange Pi.
5. Firewall dan koneksi jaringan.

### UID tidak tampil di web

Periksa bahwa:

1. `scan_session_id` sama dengan nilai pada `reader.start`.
2. `event_id` tidak kosong.
3. `uid` tidak kosong.
4. gateway sudah menerima `hello.accepted`.
5. browser sudah membuka halaman Outbound/Trash dan subscribe ke session.

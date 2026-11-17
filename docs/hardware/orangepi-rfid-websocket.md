# Kontrak Integrasi RFID Reader Orange Pi

Dokumen ini adalah kontrak integrasi antara **repository hardware Orange Pi**
dan project KOMAR. Source code gateway, driver reader, parser TCP/IP, serta
service systemd berada di repository hardware terpisah dan tidak disimpan di
project ini.

Project KOMAR hanya menyediakan:

- WebSocket backend pada `/ws`;
- scan session dan validasi assignment RFID;
- penyimpanan ke MySQL;
- dashboard realtime.

## 1. Arsitektur

```text
RFID Reader TCP/IP
        |
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

1. koneksi TCP/IP ke reader;
2. parser frame sesuai dokumentasi vendor reader;
3. normalisasi UID menjadi string uppercase;
4. koneksi WebSocket ke backend KOMAR;
5. reconnect ketika koneksi backend atau reader terputus;
6. pengiriman `event_id` unik untuk setiap event;
7. penerimaan command start/stop reader;
8. debounce lokal bila reader mengirim UID berulang.

Parser tidak boleh menebak offset UID untuk protokol binary. Format frame harus
disesuaikan dengan manual reader yang digunakan.

## 3. Konfigurasi yang diperlukan

Gateway hardware membutuhkan konfigurasi berikut:

```env
BACKEND_WS_URL=ws://192.168.1.10:3000/ws
RFID_GATEWAY_TOKEN=token_yang_sama_dengan_backend
RFID_READER_CODE=orangepi-reader-01
READER_HOST=192.168.1.20
READER_PORT=4001
```

Backend KOMAR menggunakan konfigurasi:

```env
RFID_GATEWAY_TOKEN=token_yang_sama_dengan_gateway
RFID_READER_CODE=orangepi-reader-01
```

Untuk deployment HTTPS, gunakan `wss://` dan reverse proxy TLS.

## 4. Urutan proses scan

```text
Admin klik Scan RFID
        ↓
FE membuat scan session ke API
        ↓
API mengirim reader.start ke gateway Orange Pi
        ↓
Gateway mengaktifkan reader TCP/IP
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

## 5. Protokol WebSocket

### 5.1 Gateway → backend: handshake

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

### 5.2 Backend → gateway: mulai membaca

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

### 5.3 Gateway → backend: UID terbaca

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

### 5.4 Backend → gateway: berhenti membaca

```json
{
  "type": "reader.stop",
  "scan_session_id": "uuid"
}
```

Gateway harus menghentikan pembacaan dan menutup koneksi TCP reader untuk scan
session tersebut.

## 6. Kontrak dashboard

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

## 7. Status dan kegagalan koneksi

- Gateway terputus → scan session aktif ditandai `failed`.
- Reader tidak dapat dijangkau → gateway mengirim `reader.status` dengan status
  `error`.
- Scan session melewati `expires_at` → backend menghentikan session.
- UID duplikat → tidak membuat assignment baru.
- UID sudah digunakan proses lain → backend mengirim error ke dashboard.
- Semua RFID lengkap → item berubah menjadi `ready_to_print`.

## 8. Checklist integrasi hardware

- [ ] Orange Pi dapat menjangkau IP dan port reader.
- [ ] Orange Pi dapat menjangkau `ws://<api-host>:3000/ws`.
- [ ] `RFID_GATEWAY_TOKEN` sama di kedua sisi.
- [ ] `RFID_READER_CODE` sama dengan konfigurasi backend.
- [ ] Parser sesuai protokol vendor reader.
- [ ] Setiap event memiliki `event_id` unik.
- [ ] Gateway melakukan reconnect dengan backoff.
- [ ] Gateway tidak memiliki credential MySQL.
- [ ] Port reader dan API tidak diekspos ke internet.

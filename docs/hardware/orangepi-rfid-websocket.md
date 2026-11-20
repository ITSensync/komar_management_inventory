# Orange Pi RFID Gateway — WebSocket Contract

Dokumen ini menjelaskan koneksi gateway Orange Pi ke API KOMAR. Gateway membaca RFID melalui USB Serial/UHF reader dan meneruskan event ke backend. Gateway tidak menulis langsung ke MySQL.

## Peran koneksi

```text
RFID reader USB Serial
  -> Orange Pi gateway
  -> WebSocket API /ws
  -> rfid_scan_sessions dan rfid_scan_events
```

## URL WebSocket

### Local/LAN development

```text
ws://192.168.18.16:3000/ws
```

### Cloudflare Quick Tunnel

Jalankan tunnel API pada host Docker:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

Gunakan URL WebSocket secure dari URL tunnel tersebut:

```text
wss://<api-tunnel>.trycloudflare.com/ws
```

Jangan gunakan URL tunnel FE port `3001` untuk gateway. Jangan gunakan `/api/ws`; path WebSocket adalah `/ws`.

Quick Tunnel bersifat sementara. URL berubah ketika tunnel dibuat ulang, sehingga konfigurasi gateway harus diperbarui dan gateway harus direstart. Untuk production gunakan Named Tunnel/domain tetap dan HTTPS/WSS yang stabil.

## Environment backend

```env
RFID_GATEWAY_TOKEN=secret-gateway-token
RFID_READER_CODE=orangepi-reader-01
```

`RFID_GATEWAY_TOKEN` hanya untuk koneksi gateway. Token ini tidak boleh dimasukkan ke aplikasi mobile, log, atau repository.

## Handshake gateway

Gateway harus mengirim pesan `hello` sebagai pesan pertama:

```json
{
  "type": "hello",
  "role": "gateway",
  "token": "secret-gateway-token",
  "reader_code": "orangepi-reader-01"
}
```

Response sukses:

```json
{
  "type": "hello.accepted",
  "role": "gateway",
  "reader_code": "orangepi-reader-01"
}
```

Jika token atau reader code salah, backend mengirim `hello.rejected` lalu menutup koneksi.

## Status reader

Setelah handshake, gateway dapat mengirim:

```json
{
  "type": "reader.ready",
  "reader_code": "orangepi-reader-01"
}
```

atau:

```json
{
  "type": "reader.status",
  "reader_code": "orangepi-reader-01",
  "status": "ready"
}
```

Status yang didukung:

```text
connecting, ready, reading, stopped, error, offline
```

## Perintah dari backend

Saat Admin memulai RFID scan session, backend mengirim:

```json
{
  "type": "reader.start",
  "scan_session_id": "SCAN_SESSION_UUID",
  "item_id": "PO_SESSION_ITEM_UUID",
  "expires_at": "2026-11-19T10:30:00.000Z"
}
```

Gateway mulai membaca tag dan menggunakan `scan_session_id` tersebut pada setiap event.

Saat scan selesai, dibatalkan, atau expired, backend dapat mengirim:

```json
{
  "type": "reader.stop",
  "scan_session_id": "SCAN_SESSION_UUID"
}
```

## Event RFID dari gateway

Setiap UID yang terbaca dikirim sebagai event unik:

```json
{
  "type": "rfid.detected",
  "reader_code": "orangepi-reader-01",
  "scan_session_id": "SCAN_SESSION_UUID",
  "event_id": "READER-EVENT-UUID",
  "uid": "E2806894000040168D432183",
  "observed_at": "2026-11-19T10:30:01.000Z"
}
```

`event_id` wajib unik dan stabil untuk retry event yang sama. Backend menggunakan `event_id` untuk mencegah assignment RFID ganda.

## Acknowledgement backend

UID berhasil disimpan:

```json
{
  "type": "rfid.ack",
  "event_id": "READER-EVENT-UUID",
  "scan_session_id": "SCAN_SESSION_UUID",
  "reader_code": "orangepi-reader-01",
  "uid": "E2806894000040168D432183",
  "status": "stored",
  "processed_at": "2026-11-19T10:30:01.200Z",
  "remaining_rfid_count": 9
}
```

UID duplicate atau ditolak akan memiliki `status` `duplicate` atau `rejected`, beserta `code` dan `message` bila tersedia.

## Arti HTTP 503 pada start scan

Endpoint berikut hanya dapat berhasil jika gateway sudah terhubung:

```text
POST /api/po-session-items/:itemId/rfid-scan-sessions
```

Response `503` berarti backend tidak menemukan gateway dengan `reader_code` yang diminta. Periksa:

1. Terminal `cloudflared` masih berjalan.
2. Gateway memakai URL API tunnel, bukan URL FE tunnel.
3. Gateway memakai `wss://` ketika melalui Cloudflare.
4. Path gateway adalah `/ws`.
5. `RFID_GATEWAY_TOKEN` sama dengan backend.
6. `reader_code` sama dengan `RFID_READER_CODE`.
7. Log API menampilkan `gateway.connected` dan tidak langsung `gateway.disconnected`.

## Reconnect

Gateway sebaiknya melakukan reconnect dengan backoff ketika koneksi putus. Setelah reconnect, gateway harus mengirim handshake `hello` lagi. Jika URL Quick Tunnel berubah, konfigurasi URL harus diperbarui sebelum reconnect.

## Batas keamanan

- REST placement saat ini belum memiliki login/JWT; hanya digunakan untuk development/testing.
- Gateway WebSocket memakai token bersama dan WSS saat melewati internet.
- Jangan menganggap Quick Tunnel sebagai kontrol akses production.
- Jangan mencatat token di log atau mengirim token ke mobile.

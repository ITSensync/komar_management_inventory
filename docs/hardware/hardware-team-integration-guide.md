# Hardware Team Integration Guide

## Konfigurasi environment

Backend:

```env
API_PUBLIC_URL=https://api.example.com
RFID_WS_PUBLIC_URL=wss://api.example.com/ws
RFID_GATEWAY_TOKEN=generate_a_long_random_secret
RFID_READER_CODE=orangepi-reader-01
RFID_READER_CODES=orangepi-reader-01,orangepi-reader-02
```

Frontend memakai `NEXT_PUBLIC_RFID_WS_URL` dan
`NEXT_PUBLIC_RFID_PO_READER_CODE` / `NEXT_PUBLIC_RFID_TERMINAL_READER_CODE`
saat image web dibangun. Token gateway tidak
pernah dimasukkan ke variabel `NEXT_PUBLIC_*`.

## Kontrak minimum

Hardware hanya membutuhkan WebSocket `WS /ws` dan tidak boleh mengakses MySQL.
Web/backend membuat scan session melalui:

```text
POST /api/mobile/placements/terminal-scan-sessions
```

Request outbound/trash:

```json
{
  "movement_type": "outbound",
  "reader_code": "orangepi-reader-02",
  "ttl_seconds": 600
}
```

Scan session mengembalikan `id`, yang kemudian digunakan browser untuk subscribe
dashboard dan oleh hardware pada setiap `rfid.detected`.

## Environment URL

| Environment | WebSocket URL |
|---|---|
| Local | `ws://<api-host>:3000/ws` |
| Cloudflare Tunnel | `wss://<api-tunnel>.trycloudflare.com/ws` |
| Production | `wss://api.example.com/ws` |

Health check API tersedia pada `GET /health`.

## Aturan keamanan dan retry

- Token handshake hanya disimpan di backend dan Orange Pi.
- `reader_code` harus termasuk allowlist backend.
- `event_id` wajib idempotent ketika event dikirim ulang.
- `rfid.ack` `stored` berarti UID diterima untuk preview, bukan inventory sudah berubah.
- `rfid.ack` `rejected` berarti UID ditolak dan tidak boleh dipaksa oleh client.
- Submit outbound/trash hanya dilakukan web/mobile setelah preview dan konfirmasi.

Panduan detail khusus implementasi hardware outbound/trash tersedia pada
`docs/hardware/outbound-trash-hardware-integration.md`.

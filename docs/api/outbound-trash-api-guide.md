# Outbound and Trash API Guide

## Flow

```text
start terminal scan
  -> reader.detected
  -> web menerima UID/product
  -> preview
  -> operator confirm
  -> submit movement
```

Scan tidak mengubah inventory. Preview juga read-only. Submit mengunci paket dan
RFID dalam satu transaction, lalu membuat satu `inventory_movements` per UID.

## Endpoints

```text
POST /api/mobile/placements/terminal-scan-sessions
POST /api/mobile/placements/outbound/preview
POST /api/mobile/placements/trash/preview
POST /api/mobile/placements/outbound
POST /api/mobile/placements/trash
POST /api/rfid-scan-sessions/:id/stop
```

Preview menerima:

```json
{ "rfid_numbers": ["E2806894000040168D432183"] }
```

Submit menerima payload yang sama ditambah `client_request_id`. Gunakan ID yang
sama ketika melakukan retry request yang sama. Jangan menggunakan ID tersebut
untuk daftar UID atau jenis movement yang berbeda.

Submit hanya menerima paket dengan `placement_status=placed`. Setelah berhasil,
status paket menjadi `outbound`/`trash`, lokasi aktif menjadi null, dan RFID
menjadi `available` untuk lifecycle berikutnya.

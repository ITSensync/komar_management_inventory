# Arsitektur KOMAR

## Layanan

| Layanan | Teknologi | Tanggung jawab | Port host lokal |
| --- | --- | --- | --- |
| `mysql` | MySQL 8 | Data persisten | Tidak diekspos |
| `migrate` | Node.js/Sequelize | Menyiapkan schema sebelum API hidup | Tidak ada |
| `api` | Express.js | Aturan bisnis, database, OpenAPI | 3000 |
| `web` | Next.js | Dashboard dan proxy browser `/api` | 3001 |

## Alur request web

```text
Browser -> http://localhost:3001/api/* -> Next.js rewrite -> http://api:3000/api/* -> MySQL
```

`api` adalah hostname jaringan Docker internal. Karena browser tidak dapat menjangkaunya, kode frontend hanya memakai path relatif `/api`. CORS tetap dikonfigurasi pada API untuk klien langsung seperti aplikasi mobile atau tooling lokal.

## Alur realtime RFID

```text
RFID reader USB Serial -> Orange Pi gateway -> WebSocket API /ws -> MySQL
                                               |
                                               +-> WebSocket dashboard
```

Orange Pi tidak menulis ke database. Backend membuat `rfid_scan_sessions`,
memproses `rfid.detected` secara idempotent melalui `event_id`, lalu memakai
transaksi assignment RFID yang sama dengan scan manual. Detail protokol hardware
berada di `docs/hardware/orangepi-rfid-websocket.md`.

## Startup Docker

1. MySQL harus lulus healthcheck.
2. Job `migrate` membuat atau menyesuaikan schema awal dan harus selesai sukses.
3. API dimulai dan lulus `/health`.
4. Web dimulai dan lulus `/health`.

## Keamanan dan batas saat ini

Implementasi aktif saat ini berfokus pada katalog produk, session PO, assignment RFID,
label, dan scan realtime. Schema aktif hanya terdiri dari tabel-tabel pada ERD current
scope. Autentikasi JWT, role/authorization, multi-site, mobile warehouse, receiving,
opname, relokasi, outbound, dan audit trail masih merupakan target fase berikutnya;
fitur tersebut tidak boleh dianggap tersedia hanya karena tercantum pada PRD.

API saat ini tidak boleh diekspos ke internet tanpa lapisan autentikasi dan otorisasi
yang sesuai.

## Sumber kebenaran

- Kontrak endpoint: `apps/api/docs/openapi.yaml`.
- Panduan integrasi: `docs/api/`.
- Konfigurasi stack: root `compose.yml` dan `.env.example`.
- Konfigurasi lokal rahasia: root `.env` (tidak pernah di-commit).

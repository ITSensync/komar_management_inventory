# Arsitektur KOMAR

## Layanan

| Layanan | Teknologi | Tanggung jawab | Port host lokal |
| --- | --- | --- | --- |
| `mysql` | MySQL 8 | Data persisten | Tidak diekspos |
| `migrate` | Node.js/Sequelize | Menyiapkan schema sebelum API hidup | Tidak ada |
| `api` | Express.js | Aturan bisnis, database, OpenAPI | 3000 |
| `web` | Next.js | Dashboard dan proxy browser `/api` | 3001 |

Pada development, Docker mem-publish API ke `127.0.0.1:3000` dan web ke
`127.0.0.1:3001`. Client di luar host tidak dapat memakai hostname Docker
`api`; gunakan alamat LAN atau Cloudflare Tunnel.

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

## Alur placement Site Employee

```text
Handheld React Native
  -> scan UID RFID
  -> POST /api/mobile/placements/preview
  -> semua item eligible
  -> GET /api/mobile/racks
  -> pilih rak active
  -> POST /api/mobile/placements
  -> transaction update pack plan + inventory movement
```

Preview hanya membaca data dan tidak mengubah inventory. Final placement
mengunci serta memvalidasi RFID dan pack plan di dalam satu transaksi, mengubah
`placement_status` dari `unplaced` menjadi `placed`, menyimpan `current_rack_id`,
dan membuat satu `inventory_movements` untuk setiap RFID. `client_request_id`
menjadi kunci idempotensi untuk retry timeout; request yang sama dapat
mengembalikan `reused: true` tanpa membuat movement baru.

RFID yang belum terdaftar, belum memiliki pack plan, sudah ditempatkan, atau
pack plan-nya dibatalkan tidak eligible. Mobile wajib menjalankan preview saat
user menekan **Validasi RFID** dan tidak boleh membuka pilihan rak atau submit
sebelum seluruh item eligible. Backend tetap melakukan validasi ulang pada
final placement.

## Akses development melalui Cloudflare

Quick Tunnel dijalankan di host Windows yang menjalankan Docker, bukan sebagai
hostname yang dipakai antar-container:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

Hasil URL `https://<api-tunnel>.trycloudflare.com` digunakan oleh mobile sebagai
`API_BASE_URL`. Orange Pi menggunakan endpoint WebSocket API yang sama dengan
skema secure:

```text
wss://<api-tunnel>.trycloudflare.com/ws
```

Jika dashboard web juga perlu diakses dari luar host, buat tunnel terpisah ke
port `3001`. URL FE tidak boleh digunakan untuk WebSocket hardware. Quick Tunnel
bersifat sementara, URL dapat berubah, tidak memiliki uptime guarantee, dan
endpoint REST saat ini belum memakai login/JWT; karena itu hanya untuk
development/testing, bukan production.

## Startup Docker

1. MySQL harus lulus healthcheck.
2. Job `migrate` membuat atau menyesuaikan schema awal dan harus selesai sukses.
3. API dimulai dan lulus `/health`.
4. Web dimulai dan lulus `/health`.

## Keamanan dan batas saat ini

Implementasi aktif saat ini berfokus pada katalog produk, session PO, assignment RFID,
label, scan realtime, master rack, dan placement awal Site Employee. Schema aktif
hanya terdiri dari tabel-tabel pada ERD current scope. Autentikasi JWT,
role/authorization, multi-site, mobile warehouse, receiving, opname, relokasi,
outbound, reuse RFID, trash workflow, dan audit trail masih merupakan target fase
berikutnya; fitur tersebut tidak boleh dianggap tersedia hanya karena tercantum pada
PRD.

API saat ini tidak boleh diekspos ke internet tanpa lapisan autentikasi dan otorisasi
yang sesuai. `RFID_GATEWAY_TOKEN` hanya mengamankan handshake WebSocket gateway
Orange Pi; token tersebut bukan autentikasi REST dan tidak boleh dikirim ke mobile.
Cloudflare Tunnel menyediakan transport HTTPS/WSS, bukan pengganti login,
authorization, atau audit akses.

## Sumber kebenaran

- Kontrak endpoint: `apps/api/docs/openapi.yaml`.
- Panduan integrasi: `docs/api/`.
- Konfigurasi stack: root `compose.yml` dan `.env.example`.
- Konfigurasi lokal rahasia: root `.env` (tidak pernah di-commit).

# Mobile React Native — Site Employee Placement

Dokumen ini adalah kontrak integrasi untuk repo mobile React Native. Mobile digunakan site employee pada handheld untuk menempatkan barang hasil repacking ke rak.

## Prioritas implementasi

- **P0 — Kerjakan sekarang:** flow placement pertama.
- **P1 — Pendukung:** hanya jika diperlukan untuk testing atau pengalaman integrasi.
- **P2 — Memory:** jangan dikerjakan sekarang; hanya pengingat roadmap.

## Base URL dan autentikasi

### Base URL fase development

Mobile mengakses API repo utama secara langsung melalui jaringan lokal. Untuk handheld yang berada pada jaringan yang sama dengan komputer backend, gunakan:

```env
# Akses langsung melalui LAN
API_BASE_URL=http://192.168.18.16:3000
```

Penyesuaian berdasarkan environment:

```env
# Android Emulator
API_BASE_URL=http://10.0.2.2:3000

# iOS Simulator
API_BASE_URL=http://localhost:3000

# Handheld/device fisik pada Wi-Fi yang sama
API_BASE_URL=http://192.168.18.16:3000

# Alternatif melalui Cloudflare Quick Tunnel
API_BASE_URL=https://<api-tunnel>.trycloudflare.com
```

Jangan gunakan `http://api:3000` dari mobile karena hostname tersebut hanya tersedia di dalam network Docker. Jangan gunakan `localhost` dari handheld fisik karena `localhost` menunjuk ke device itu sendiri.

Prasyarat koneksi handheld:

1. Handheld dan komputer backend berada pada Wi-Fi/LAN yang sama.
2. Docker API sedang berjalan dan port `3000` dipublish.
3. Windows Firewall mengizinkan koneksi masuk ke TCP port `3000`.
4. Endpoint dapat diuji melalui `http://192.168.18.16:3000/health`.
5. Jika platform mobile memblokir HTTP cleartext pada development, aktifkan konfigurasi development yang sesuai pada aplikasi mobile. Production nantinya wajib menggunakan HTTPS.

Cloudflare Quick Tunnel dijalankan dari host yang menjalankan Docker:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

Gunakan URL HTTPS yang dicetak `cloudflared` sebagai `API_BASE_URL`. URL Quick Tunnel bersifat sementara dan berubah ketika tunnel dibuat ulang. Tunnel tidak memiliki uptime guarantee dan endpoint REST saat ini belum memakai autentikasi, sehingga hanya untuk development/testing.

### Autentikasi fase sekarang

Pada fase placement ini, backend belum memiliki login, JWT, atau middleware autentikasi untuk REST API. Mobile **tidak perlu mengambil token dari repo FE/BE lain** dan tidak perlu mengirim header `Authorization`.

Contoh request:

```ts
fetch(`${API_BASE_URL}/api/mobile/racks?status=active`);
```

Untuk request `POST`, cukup gunakan header:

```http
Content-Type: application/json
```

`RFID_GATEWAY_TOKEN` hanya digunakan untuk autentikasi koneksi WebSocket gateway Orange Pi/RFID reader. Token tersebut tidak boleh dimasukkan ke aplikasi mobile.

Login, role site employee, access token, refresh token, dan pembatasan akses API adalah roadmap fase berikutnya. Jangan implementasikan auth pada flow placement saat ini.

## Flow P0

```text
Placement home
  -> scan RFID satu atau banyak barang
  -> lihat daftar RFID yang terbaca
  -> hapus hasil scan yang salah bila perlu
  -> tekan Validasi RFID
  -> preview semua RFID ke backend
  -> jika semua eligible, ambil daftar rak active dari API
  -> pilih rak
  -> review jumlah dan daftar barang
  -> submit placement
  -> tampilkan success/error
  -> tampilkan simple history
```

Repacking adalah aktivitas fisik. Mobile tidak mencatat status/action `REPACKED` dan tidak mendaftarkan RFID baru.

## Aturan integrasi

1. Mobile tidak mengakses database secara langsung.
2. Backend repo utama adalah source of truth.
3. Rak dibuat dan dikelola Admin web; mobile hanya memilih rak active.
4. RFID yang dikirim harus RFID yang benar-benar discan oleh handheld.
5. Scan tidak langsung mengubah status barang menjadi `placed`.
6. Backend yang mengubah status `unplaced` menjadi `placed` setelah final submit berhasil.
7. Mobile tidak boleh menganggap sukses hanya karena request terkirim.
8. Mobile tidak boleh membuat submission baru ketika request sebelumnya timeout.
9. User wajib menekan Validasi RFID sebelum pilihan rak dibuka.
10. User tidak boleh submit jika salah satu item hasil preview tidak eligible.
11. RFID berstatus `placed` tidak boleh diproses ulang dengan placement biasa.
12. RFID berstatus `placed` hanya boleh dipindahkan melalui action relocation.
13. RFID baru dapat digunakan ulang setelah action outbound atau trash berhasil.

## API contract

Base URL mengikuti environment mobile.

### 1. Daftar rak aktif

```http
GET /api/mobile/racks?status=active
```

Response:

```json
{
  "success": true,
  "data": [
    {
      "id": "RACK_UUID",
      "code": "RAK-01",
      "name": "Rak Susu",
      "description": "Area gudang A",
      "status": "active"
    }
  ]
}
```

Mobile tidak boleh mengirim `POST` atau `PATCH` rack.

### 2. Preview hasil scan

Preview tidak mengubah database.

```http
POST /api/mobile/placements/preview
Content-Type: application/json
```

Request:

```json
{
  "rfid_numbers": ["RFID-001", "RFID-002"]
}
```

Response aktual:

```json
{
  "success": true,
  "data": {
    "eligible": true,
    "items": [
      {
        "rfid_number": "RFID-001",
        "rfid_tag_id": 1,
        "pack_plan_id": "PACK_PLAN_UUID",
        "pack_number": 1,
        "label_code": "LBL-001",
        "product_id": "PRODUCT_UUID",
        "sku": "KMR-SUSU-250",
        "product_name": "Susu UHT 250 ml",
        "expires_on": null,
        "placement_status": "unplaced",
        "current_rack": null,
        "eligible": true
      }
    ]
  }
}
```

Jika RFID belum terdaftar, preview tetap dapat merespons HTTP `200`, tetapi item tersebut tidak eligible:

```json
{
  "success": true,
  "data": {
    "eligible": false,
    "items": [
      {
        "rfid_number": "RFID-UNKNOWN",
        "eligible": false,
        "error_code": "RFID_NOT_REGISTERED",
        "message": "RFID tag is not registered."
      }
    ]
  }
}
```

Mobile wajib memanggil preview setelah tombol **Validasi RFID** ditekan. Sebelum preview sukses dan semua `data.items[].eligible` bernilai `true`, pilihan rak dan submit harus disabled.

### 3. Final placement

```http
POST /api/mobile/placements
Content-Type: application/json
```

Request:

```json
{
  "rack_id": "RACK_UUID",
  "rfid_numbers": ["RFID-001", "RFID-002"],
  "client_request_id": "MOBILE-UUID"
}
```

`client_request_id` wajib dibuat sekali untuk satu submission. Jika request timeout, kirim ulang payload yang sama dengan ID yang sama.

Response sukses:

```json
{
  "success": true,
  "data": {
    "client_request_id": "MOBILE-UUID",
    "rack": {
      "id": "RACK_UUID",
      "code": "RAK-01",
      "name": "Rak Susu"
    },
    "total_placed": 2,
    "placed_at": "2026-11-19T10:30:00.000Z",
    "items": []
  }
}
```

### 4. Relocation, outbound, trash, dan reuse RFID

Placement awal bukan relocation. Jika RFID sudah `placed`, gunakan endpoint
relocation dan rak tujuan harus berbeda dari rak saat ini:

```http
POST /api/mobile/placements/relocation
Content-Type: application/json
```

```json
{
  "rack_id": "NEW_RACK_UUID",
  "rfid_numbers": ["RFID-001"],
  "client_request_id": "RELOCATION-UUID"
}
```

Relocation mempertahankan `placement_status: placed`, memperbarui rak aktif,
dan menulis movement `relocation`. Relocation ke rak yang sama ditolak.

Untuk menyelesaikan lifecycle barang:

```http
POST /api/mobile/placements/outbound
POST /api/mobile/placements/trash
Content-Type: application/json
```

```json
{
  "rfid_numbers": ["RFID-001"],
  "client_request_id": "TERMINAL-ACTION-UUID"
}
```

Action hanya menerima RFID yang sedang `placed`. Setelah berhasil, backend:

- mengubah `placement_status` menjadi `outbound` atau `trash`;
- menghapus rak aktif dari pack lama;
- mempertahankan movement history;
- membuat RFID kembali `available` untuk reuse.

Reuse tidak dilakukan dengan mendaftarkan UID baru. UID tetap satu record di
`rfid_tags`; Admin memasangkannya ke pack plan baru melalui flow assignment RFID.
Assignment RFID yang belum pernah didaftarkan akan ditolak dengan
`RFID_NOT_REGISTERED`, dan UID yang sudah terdaftar tidak boleh dibuat ulang.

Semua action memakai `client_request_id` yang idempotent. Jangan memakai ID
yang sama untuk placement, relocation, outbound, atau trash yang berbeda.

### 5. Simple history

```http
GET /api/mobile/placements/history?limit=20&offset=0
```

Response aktual:

```json
{
  "success": true,
  "data": {
    "total": 1,
    "limit": 20,
    "offset": 0,
    "items": [
      {
        "id": "MOVEMENT_UUID",
        "created_at": "2026-11-19T10:30:00.000Z",
        "movement_type": "placement",
        "client_request_id": "MOBILE-REQUEST-UUID",
        "rack": {
          "id": "RACK_UUID",
          "code": "RAK-01",
          "name": "Rak Susu"
        },
        "item": {
          "rfid_number": "RFID-001",
          "pack_plan_id": "PACK_PLAN_UUID",
          "pack_number": 1,
          "sku": "KMR-SUSU-250",
          "product_name": "Susu UHT 250 ml",
          "placement_status": "placed"
        }
      }
    ]
  }
}
```

Satu item history mewakili satu movement RFID/pack plan dan dapat berupa
`placement`, `relocation`, `outbound`, atau `trash`. Untuk menampilkan jumlah
satu batch, kelompokkan item berdasarkan `client_request_id` dan hitung jumlah
itemnya. Gunakan `created_at` untuk waktu, `from_rack` dan `rack` untuk asal/
tujuan, `movement_type` untuk label action, dan `item.placement_status` untuk
status barang saat ini.

## State mobile yang disarankan

- `scannedRfidNumbers`: UID unik yang dibaca handheld.
- `validatedItems`: detail hasil preview.
- `selectedRack`: rak yang dipilih user.
- `submitState`: `idle`, `loading`, `success`, atau `error`.
- `clientRequestId`: ID yang dibuat untuk satu submission.

RFID duplicate harus dihapus/dideduplikasi di mobile, tetapi validasi duplicate tetap wajib dilakukan backend.

## Perilaku error

Tampilkan pesan yang mudah dipahami site employee untuk kode berikut:

| Code | Arti |
|---|---|
| `RFID_NOT_REGISTERED` | RFID belum didaftarkan Admin. |
| `PACK_PLAN_NOT_FOUND` | RFID belum memiliki pack plan. |
| `RFID_ALREADY_PLACED` | Barang sudah pernah ditempatkan. |
| `RFID_NOT_PLACED` | RFID belum berada di rak sehingga tidak dapat direlokasi/ditutup. |
| `RFID_ACTION_ALREADY_COMPLETED` | RFID sudah outbound atau trash. |
| `RFID_LOCATION_NOT_FOUND` | RFID placed tidak memiliki rak aktif. |
| `SAME_RACK` | Relocation menuju rak yang sama ditolak. |
| `RFID_ALREADY_REGISTERED` | UID sudah ada; gunakan assignment/reuse, bukan registrasi ulang. |
| `RFID_REUSE_NOT_RELEASED` | Siklus RFID lama belum selesai atau belum dilepas. |
| `PACK_PLAN_CANCELLED` | Pack plan sudah dibatalkan. |
| `RACK_NOT_FOUND` | Rak tidak ditemukan. |
| `RACK_INACTIVE` | Rak sudah tidak aktif. |
| `DUPLICATE_RFID` / `duplicate_in_request` | RFID muncul lebih dari satu kali. |
| `IDEMPOTENCY_KEY_REUSED` | Request ID dipakai untuk payload berbeda. |
| `PLACEMENT_CONFLICT` | Barang sedang diproses oleh request lain. |

Jika final placement gagal, mobile tidak boleh mengubah status lokal menjadi `placed`.

Tidak semua object pada `errors[]` selalu memiliki `code`, tetapi setiap error memiliki `message`. Gunakan prioritas pesan berikut:

```text
businessMessageMap[errors[0].code]
  -> errors[0].message
  -> top-level message
  -> pesan umum
```

Error placement contoh:

```json
{
  "success": false,
  "message": "Placement validation failed.",
  "errors": [
    {
      "rfid_number": "RFID-UNKNOWN",
      "code": "RFID_NOT_REGISTERED",
      "message": "RFID tag is not registered."
    }
  ]
}
```

## Timeout, pending submission, dan retry

Mobile boleh menyimpan submission pending di AsyncStorage karena payload placement bukan token/secret. Simpan payload lengkap dan ID yang sama:

```json
{
  "client_request_id": "MOBILE-REQUEST-UUID",
  "rack_id": "RACK_UUID",
  "rfid_numbers": ["RFID-001", "RFID-002"],
  "created_at": "2026-11-19T10:30:00.000Z",
  "status": "pending"
}
```

Aturan:

1. Simpan pending sebelum request pertama dikirim.
2. Timeout pertama boleh melakukan satu retry otomatis dengan payload dan `client_request_id` yang sama.
3. Jika masih timeout, tampilkan tombol **Coba lagi**.
4. Tombol tersebut tetap memakai `client_request_id` yang sama.
5. Hapus pending hanya setelah menerima `201` sukses atau `200` dengan `reused: true`.
6. Jangan gunakan ID yang sama untuk payload berbeda. Jika user mengubah rak atau daftar RFID, buat submission baru dengan ID baru.
7. Untuk error `4xx` permanen, jangan retry otomatis; minta user memperbaiki data.

AsyncStorage tidak boleh digunakan untuk JWT/token ketika autentikasi mobile ditambahkan. Gunakan secure storage untuk credential pada fase auth mendatang.

## P0 checklist

- [ ] Screen placement tersedia.
- [ ] Handheld dapat memasukkan satu atau banyak RFID.
- [ ] RFID duplicate tidak menggandakan list.
- [ ] User dapat menghapus RFID sebelum submit.
- [ ] Tombol Validasi RFID tersedia setelah scan.
- [ ] Pilihan rak disabled sebelum validasi berhasil.
- [ ] Submit disabled sebelum semua item eligible.
- [ ] RFID belum terdaftar ditolak sebelum pemilihan rak.
- [ ] Rak active dapat dimuat dari API.
- [ ] Submit disabled jika RFID atau rak belum dipilih.
- [ ] Review jumlah dan ringkasan item tersedia.
- [ ] Submit mengirim `rack_id`, `rfid_numbers`, dan `client_request_id`.
- [ ] Tombol submit mencegah double tap.
- [ ] Timeout melakukan retry dengan request ID yang sama.
- [ ] Success membersihkan batch dan menampilkan konfirmasi.
- [ ] Error tidak mengubah status lokal menjadi placed.
- [ ] Simple history dapat ditampilkan.

## P1 — Pendukung, bukan blocker

- Search/filter pada hasil scan.
- Refresh rak manual.
- Cache read-only daftar rak dengan refresh sebelum submit.
- Cache simple history untuk tampilan, tanpa menjadikannya source of truth.

## Lifecycle reuse yang sudah tersedia

RFID yang sudah selesai pada barang lama (`OUTBOUND` atau `TRASH`) dapat
digunakan pada barang repack baru melalui assignment Admin. Mobile tidak boleh
menghapus histori atau mengasumsikan RFID hanya dapat dipakai sekali seumur
hidup.

## P2 — Roadmap berikutnya

### Fitur lain

Jangan implementasikan sekarang:

- opname mingguan;
- scan khusus proses repacking;
- status `REPACKED`;
- CRUD master rak;
- offline-first conflict resolution penuh.

## WebSocket hardware dan Cloudflare

Flow placement mobile tidak membutuhkan WebSocket gateway jika handheld dapat membaca UID melalui adapter mobile. WebSocket `/ws` digunakan oleh Orange Pi gateway dan dashboard realtime Admin.

Jika Orange Pi mengakses backend melalui Cloudflare Tunnel API:

```text
wss://<api-tunnel>.trycloudflare.com/ws
```

`RFID_GATEWAY_TOKEN` hanya untuk gateway Orange Pi dan tidak boleh dimasukkan ke aplikasi mobile. Detail handshake dan troubleshooting ada di `docs/hardware/orangepi-rfid-websocket.md`.

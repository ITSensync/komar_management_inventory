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
```

Jangan gunakan `http://api:3000` dari mobile karena hostname tersebut hanya tersedia di dalam network Docker. Jangan gunakan `localhost` dari handheld fisik karena `localhost` menunjuk ke device itu sendiri.

Prasyarat koneksi handheld:

1. Handheld dan komputer backend berada pada Wi-Fi/LAN yang sama.
2. Docker API sedang berjalan dan port `3000` dipublish.
3. Windows Firewall mengizinkan koneksi masuk ke TCP port `3000`.
4. Endpoint dapat diuji melalui `http://192.168.18.16:3000/health`.
5. Jika platform mobile memblokir HTTP cleartext pada development, aktifkan konfigurasi development yang sesuai pada aplikasi mobile. Production nantinya wajib menggunakan HTTPS.

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
  -> ambil daftar rak active dari API
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

Response berisi detail setiap RFID dan `eligible`. Preview dapat digunakan untuk memberi feedback sebelum user memilih rak atau submit.

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

### 4. Simple history

```http
GET /api/mobile/placements/history?limit=20&offset=0
```

Mobile cukup menampilkan waktu, jumlah barang, rak tujuan, dan status. Detail audit lengkap tetap berada di backend/Admin web.

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
| `PACK_PLAN_CANCELLED` | Pack plan sudah dibatalkan. |
| `RACK_NOT_FOUND` | Rak tidak ditemukan. |
| `RACK_INACTIVE` | Rak sudah tidak aktif. |
| `DUPLICATE_RFID` / `duplicate_in_request` | RFID muncul lebih dari satu kali. |
| `IDEMPOTENCY_KEY_REUSED` | Request ID dipakai untuk payload berbeda. |
| `PLACEMENT_CONFLICT` | Barang sedang diproses oleh request lain. |

Jika final placement gagal, mobile tidak boleh mengubah status lokal menjadi `placed`.

## P0 checklist

- [ ] Screen placement tersedia.
- [ ] Handheld dapat memasukkan satu atau banyak RFID.
- [ ] RFID duplicate tidak menggandakan list.
- [ ] User dapat menghapus RFID sebelum submit.
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

- Preview detail SKU/product/sequence sebelum submit.
- Search/filter pada hasil scan.
- Refresh rak manual.
- Cache read-only daftar rak dengan refresh sebelum submit.
- Cache simple history untuk tampilan, tanpa menjadikannya source of truth.

## P2 — Jangan dikerjakan sekarang

### Relocation

Nantinya:

```text
scan RFID placed -> pilih rak baru -> submit relocation
```

Jangan membuat mode atau screen relocation sekarang.

### Reuse RFID

RFID yang sudah selesai pada barang lama (`OUTBOUND` atau `TRASH`) nantinya dapat digunakan pada barang repack baru. Backend akan menyimpan assignment/usage cycle dan histori lintas barang. Mobile tidak boleh menghapus histori atau mengasumsikan RFID hanya dapat dipakai sekali seumur hidup.

Jangan membuat UI reuse RFID sekarang.

### Fitur lain

Jangan implementasikan sekarang:

- outbound scan;
- trash/expired action;
- opname mingguan;
- scan khusus proses repacking;
- status `REPACKED`;
- CRUD master rak;
- offline-first conflict resolution penuh.

# Mobile React Native — Site Employee Placement

Dokumen ini adalah kontrak integrasi untuk repo mobile React Native. Mobile digunakan site employee pada handheld untuk menempatkan barang hasil repacking ke rak.

## Prioritas implementasi

- **P0 — Kerjakan sekarang:** flow placement pertama, relocation, dan opname mobile dengan review sebelum submit.
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

### Flow P0 — Relocation

Relocation dilakukan setelah barang sudah `placed`. Mobile wajib meminta rak
tujuan terlebih dahulu, lalu mengumpulkan RFID dari satu atau beberapa rak asal.
Satu batch boleh memindahkan barang dari Rak A dan Rak B ke Rak C.

```text
Relocation home
  -> ambil daftar rak active
  -> pilih satu rak tujuan
  -> scan satu atau banyak RFID dari rak asal berbeda
  -> simpan UID unik di buffer lokal
  -> preview relocation ke backend (read-only)
  -> tampilkan detail setiap barang dan rak asalnya
  -> tampilkan summary per rak asal dan per produk
  -> user konfirmasi
  -> submit satu batch relocation
  -> tampilkan success/error
  -> refresh simple history
```

Selama scan dan preview belum selesai, database tidak berubah. Preview hanya
menilai kelayakan dan mengembalikan detail barang. Perubahan rak hanya terjadi
setelah final submit berhasil.

### Flow P0 — Opname mobile

Opname adalah report kondisi inventory, bukan placement dan bukan adjustment
stok. User dapat melakukan opname dari rak mana pun dalam satu sesi. Saat sesi
dibuat, backend mengambil snapshot semua RFID yang saat itu memenuhi syarat:

```text
RFID terdaftar Admin
  -> sudah di-assign ke pack plan
  -> label sudah dicetak
  -> PO sudah completed
  -> placement_status = placed
  -> memiliki current_rack
```

Mobile tidak perlu scan rak. Rak report diambil dari `current_rack` terakhir yang
tersimpan di backend, termasuk jika RFID sebelumnya sudah mengalami relocation.
Konsekuensinya, flow ini memeriksa lokasi sistem; flow ini belum dapat
mendeteksi barang yang secara fisik diletakkan di rak berbeda tanpa scan rak.

```text
Opname home
  -> tekan Buat sesi opname
  -> backend menyimpan session_date dan snapshot RFID placed
  -> scan satu atau banyak UID dari rak mana pun
  -> deduplicate UID pada buffer lokal
  -> kirim batch scan ke backend
  -> tampilkan preview yang dikelompokkan per current_rack
  -> buka detail rak untuk melihat produk, SKU, pack, unit, dan UID
  -> tampilkan kategori sesuai, belum terbaca, lifecycle berubah, dan ditolak
  -> user review hasil
  -> submit laporan opname
  -> tampilkan konfirmasi dan status submitted
```

UI mobile yang disarankan:

- halaman daftar sesi: nomor sesi, tanggal, status, dan ringkasan jumlah item;
- tombol `Buat sesi opname` dengan catatan opsional;
- halaman scan dengan jumlah UID buffer dan tombol `Proses scan`;
- kartu rak yang menampilkan `terbaca / ekspektasi` dan jumlah selisih;
- detail rak berbentuk accordion atau halaman detail;
- bagian khusus `Scan ditolak` agar UID invalid tidak tercampur dengan hasil sah;
- tombol `Submit laporan` hanya aktif pada sesi `draft`;
- dialog konfirmasi menyebutkan jumlah sesuai, belum terbaca, lifecycle berubah,
  dan scan ditolak.

Submit tidak mengubah `current_rack_id`, `placement_status`, atau saldo stok.
Sesi yang sudah `submitted` tidak boleh diedit; koreksi dilakukan dengan sesi
opname baru atau workflow adjustment supervisor pada fase berikutnya.

#### Syarat dan pesan validasi opname

Backend memvalidasi ulang saat scan dan submit. Gunakan pesan berdasarkan kode:

| Code | Pesan mobile |
|---|---|
| `RFID_NOT_REGISTERED` | RFID belum didaftarkan Admin. |
| `PACK_PLAN_NOT_FOUND` | RFID belum memiliki pack plan aktif. |
| `RFID_ADMIN_NOT_READY` | RFID belum selesai assignment, cetak label, atau penyelesaian PO. |
| `RFID_NOT_PLACED` | RFID belum melalui placement dan belum dapat diopname. |
| `RFID_LOCATION_NOT_FOUND` | RFID placed tetapi lokasi rak tidak ditemukan. |
| `RFID_ACTION_ALREADY_COMPLETED` | RFID sudah outbound/trash dan bukan stok aktif. |
| `RFID_NOT_IN_SNAPSHOT` | RFID belum ada ketika sesi dibuat; gunakan sesi opname baru. |
| `DUPLICATE_IN_SESSION` | RFID sudah pernah terbaca pada sesi ini. |

RFID yang ditolak dicatat sebagai scan event rejected untuk audit, tetapi tidak
masuk item report yang sah.

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
14. Flow relocation tidak boleh mendaftarkan RFID baru otomatis; RFID harus sudah
    terdaftar, memiliki pack plan, dan berstatus `placed`.
15. Target relocation dipilih sebelum scan dan harus satu rak active.
16. Item dari beberapa rak asal boleh dikirim ke satu rak tujuan dalam satu
    batch; `from_rack` setiap item tetap disimpan terpisah.
17. Duplicate scan di handheld diabaikan dan tidak boleh menggandakan buffer,
    preview item, atau submission.
18. Jika satu item pada preview tidak eligible, tombol submit disabled sampai
    item tersebut dihapus atau scan diperbaiki.
19. Opname hanya menerima RFID yang sudah `placed` dan memiliki `current_rack`.
20. Opname tidak boleh membuat RFID baru, mengubah rak, atau mengubah saldo stok.
21. Snapshot ekspektasi dibuat saat sesi opname dibuat; jangan mengganti hasil
    sesi lama dengan data lokasi terbaru setelah sesi berjalan.
22. UID yang sudah pernah scan dalam sesi opname dihitung satu kali; `scan_count`
    hanya untuk informasi jumlah pembacaan reader.

## API contract

Base URL mengikuti environment mobile.

Semua endpoint di bawah dipanggil langsung oleh aplikasi mobile ke API. Mobile
tidak memanggil database dan tidak menggunakan route Web Admin. Pada development
lokal, contoh konfigurasi yang dipakai:

```env
API_BASE_URL=http://192.168.18.16:3000
```

Health check sebelum memulai pekerjaan:

```http
GET /health
```

Request `POST` wajib mengirim `Content-Type: application/json`. Auth belum
diaktifkan pada fase ini, sehingga jangan mengirim `RFID_GATEWAY_TOKEN` dari
mobile; token tersebut hanya untuk gateway Orange Pi.

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
        "message": "RFID belum didaftarkan Admin. Pastikan RFID sudah di-assign ke pack plan, label sudah dicetak, dan session PO sudah diselesaikan."
      }
    ]
  }
}
```

Mobile wajib memanggil preview setelah tombol **Validasi RFID** ditekan. Sebelum preview sukses dan semua `data.items[].eligible` bernilai `true`, pilihan rak dan submit harus disabled.

### Syarat RFID siap dari Admin

Status `tag_assigned` saja belum membuat RFID eligible untuk placement. Backend
hanya mengizinkan placement jika seluruh syarat berikut terpenuhi:

1. RFID sudah terhubung ke pack plan;
2. status pack plan sudah `label_printed`;
3. item RFID sudah berstatus `printed`;
4. PO session sudah berstatus `completed`.

Jika RFID belum di-print atau session belum diselesaikan, preview mengembalikan
`eligible: false` dengan `error_code: RFID_ADMIN_NOT_READY`. Pesan mobile yang
ditampilkan:

> RFID belum didaftarkan Admin. Pastikan RFID sudah di-assign ke pack plan, label
> sudah dicetak, dan session PO sudah diselesaikan.

Response dapat menyertakan rincian berikut untuk kebutuhan debugging atau
indikator di UI:

```json
{
  "error_code": "RFID_ADMIN_NOT_READY",
  "admin_readiness": {
    "assigned": true,
    "label_printed": false,
    "session_completed": false
  }
}
```

Validasi yang sama dilakukan ulang pada submit final. Jadi RFID tidak dapat
melewati aturan hanya karena preview dilakukan sebelum Admin menyelesaikan
print atau session.

### 3. Relocation preview

Preview relocation tidak mengubah database. Gunakan endpoint ini setelah rak
tujuan dipilih dan sebelum menampilkan tombol submit.

```http
POST /api/mobile/placements/relocation/preview
Content-Type: application/json
```

Request:

```json
{
  "rack_id": "TARGET_RACK_UUID",
  "rfid_numbers": ["RFID-A-001", "RFID-B-001"]
}
```

`rack_id` adalah satu rak tujuan. RFID boleh berasal dari beberapa rak asal.
Backend membaca rak asal dari `current_rack` setiap pack plan.

Response eligible:

```json
{
  "success": true,
  "data": {
    "eligible": true,
    "target_rack": {
      "id": "TARGET_RACK_UUID",
      "code": "RAK-C",
      "name": "Rak Tujuan C"
    },
    "items": [
      {
        "rfid_number": "RFID-A-001",
        "rfid_tag_id": 1,
        "pack_plan_id": "PACK_PLAN_A_UUID",
        "pack_number": 1,
        "label_code": "LBL-A",
        "product_id": "PRODUCT_UUID",
        "sku": "KMR-SUSU-250",
        "product_name": "Susu UHT 250 ml",
        "units": 5,
        "base_unit": "pcs",
        "expires_on": "2026-12-31",
        "placement_status": "placed",
        "current_rack": {
          "id": "RACK-A_UUID",
          "code": "RAK-A",
          "name": "Rak A"
        },
        "target_rack": {
          "id": "TARGET_RACK_UUID",
          "code": "RAK-C",
          "name": "Rak Tujuan C"
        },
        "eligible": true
      }
    ]
  }
}
```

Jika ada item invalid, HTTP tetap dapat `200` agar mobile dapat menampilkan
seluruh hasil preview. Mobile wajib membaca `data.eligible` dan setiap
`items[].eligible`; submit harus disabled bila salah satunya `false`.

Contoh item invalid:

```json
{
  "rfid_number": "RFID-UNPLACED",
  "eligible": false,
  "error_code": "RFID_NOT_PLACED",
  "message": "Only a placed RFID can be relocated."
}
```

Kode preview relocation yang penting:

| Code | Arti |
|---|---|
| `RFID_NOT_REGISTERED` | UID belum terdaftar pada flow mobile. Mobile tidak boleh auto-register. |
| `PACK_PLAN_NOT_FOUND` | UID tidak memiliki pack plan. |
| `RFID_ADMIN_NOT_READY` | RFID sudah dikenal, tetapi assignment, print label, atau penyelesaian session Admin belum lengkap. |
| `RFID_NOT_PLACED` | UID belum berada di rak. |
| `RFID_ACTION_ALREADY_COMPLETED` | Lifecycle sudah outbound/trash dan tidak dapat direlokasi. |
| `RFID_LOCATION_NOT_FOUND` | Status placed tidak memiliki rak aktif. |
| `SAME_RACK` | Rak tujuan sama dengan rak asal. |
| `PACK_PLAN_CANCELLED` | Pack plan telah dibatalkan. |
| `RACK_NOT_FOUND` | Rak tujuan tidak ditemukan. |
| `RACK_INACTIVE` | Rak tujuan tidak active. |

### 4. Final placement

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

### 5. Relocation, outbound, trash, dan reuse RFID

Placement awal bukan relocation. Jika RFID sudah `placed`, gunakan endpoint
relocation dan rak tujuan harus berbeda dari rak saat ini:

```http
POST /api/mobile/placements/relocation
Content-Type: application/json
```

```json
{
  "rack_id": "NEW_RACK_UUID",
  "rfid_numbers": ["RFID-FROM-A", "RFID-FROM-B"],
  "client_request_id": "RELOCATION-UUID"
}
```

Mobile memilih `rack_id` tujuan sebelum scan. RFID boleh berasal dari Rak A,
Rak B, atau rak asal lain selama setiap RFID valid dan tidak berada di rak
tujuan. Sebelum request final, mobile wajib menjalankan
`POST /api/mobile/placements/relocation/preview` lalu menampilkan:

- UID dan nomor pack;
- SKU dan nama produk;
- jumlah unit dan expiry;
- rak asal setiap UID;
- rak tujuan yang dipilih;
- status eligibility setiap UID;
- summary jumlah item per rak asal dan per produk.

Contoh summary yang harus terlihat sebelum konfirmasi:

```text
Rak tujuan: RAK-C
Total RFID: 4

RAK-A -> RAK-C: 2 item
RAK-B -> RAK-C: 2 item

Susu UHT 250 ml: 3 pack
Creamer 300 ml: 1 pack
```

Preview tidak membuat movement. Submit final harus mengirim seluruh UID valid
yang sudah dikonfirmasi user. Backend memvalidasi ulang seluruh batch secara
atomic; jika satu UID berubah status, seluruh relocation ditolak dan tidak ada
perpindahan sebagian.

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
Pada flow mobile placement/relocation, UID yang belum terdaftar tetap ditolak
dengan `RFID_NOT_REGISTERED` dan tidak boleh auto-register. Auto-register hanya
berlaku pada flow Admin realtime PO, bukan pada handheld site employee.

Semua action memakai `client_request_id` yang idempotent. Jangan memakai ID
yang sama untuk placement, relocation, outbound, atau trash yang berbeda.

### 6. Opname session dan report

#### 6.1 Buat sesi opname

```http
POST /api/mobile/stocktakes
Content-Type: application/json
```

Request:

```json
{
  "notes": "Opname area gudang A"
}
```

`session_number` boleh dikirim jika mobile memiliki format nomor sendiri. Jika
tidak dikirim, backend membuat nomor `OPN-...` dan menyimpan `session_date`
berdasarkan waktu server. Pembuatan sesi sekaligus mengambil snapshot seluruh
RFID eligible yang sedang `placed`.

#### 6.2 Daftar dan detail sesi

```http
GET /api/mobile/stocktakes
GET /api/mobile/stocktakes/{stocktake_session_id}
```

Status sesi:

| Status | Arti |
|---|---|
| `draft` | Masih dapat menerima scan dan belum final. |
| `submitted` | Report sudah disubmit dan tidak dapat diedit. |
| `cancelled` | Sesi dibatalkan dan tidak digunakan sebagai report final. |

#### 6.3 Kirim hasil scan

```http
POST /api/mobile/stocktakes/{stocktake_session_id}/scans
Content-Type: application/json
```

Request:

```json
{
  "rfid_numbers": ["RFID-001", "RFID-002"],
  "client_request_id": "STOCKTAKE-SCAN-UUID"
}
```

`client_request_id` dibuat satu kali untuk satu batch scan. Jika request timeout,
retry dengan payload dan ID yang sama. Jangan membuat batch baru hanya karena
request belum menerima response.

Scan yang valid mengambil `current_rack` dari pack plan. Response mengembalikan
report terbaru pada field `report`, sehingga mobile dapat langsung merender
preview. Field `data` juga berisi report yang sama untuk kompatibilitas client
lama:

```json
{
  "success": true,
  "report": {
    "session": {
      "id": "STOCKTAKE_UUID",
      "session_number": "OPN-20261125-001",
      "session_date": "2026-11-25",
      "status": "draft"
    },
    "summary": {},
    "racks": [],
    "rejected_scans": []
  },
  "data": {
    "session": {
      "id": "STOCKTAKE_UUID",
      "session_number": "OPN-20261125-001",
      "session_date": "2026-11-25",
      "status": "draft"
    },
    "summary": {
      "expected_count": 5,
      "scanned_count": 4,
      "missing_count": 1,
      "changed_count": 0,
      "rejected_count": 1,
      "total_units_expected": 25,
      "total_units_scanned": 20
    },
    "racks": [
      {
        "rack": {
          "id": "RACK_UUID",
          "code": "RAK-A",
          "name": "Rak A"
        },
        "expected_count": 5,
        "scanned_count": 4,
        "missing_count": 1,
        "changed_count": 0,
        "items": [
          {
            "id": "STOCKTAKE_ITEM_UUID",
            "rfid_number": "RFID-001",
            "pack_plan_id": "PACK_PLAN_UUID",
            "pack_number": 1,
            "label_code": "LBL-001",
            "sku": "KMR-SUSU-250",
            "product_name": "Susu UHT 250 ml",
            "base_unit": "pcs",
            "units": 5,
            "expected_rack": {
              "id": "RACK_UUID",
              "code": "RAK-A",
              "name": "Rak A"
            },
            "observed_rack": {
              "id": "RACK_UUID",
              "code": "RAK-A",
              "name": "Rak A"
            },
            "scan_count": 1,
            "result": "matched"
          }
        ]
      }
    ],
    "rejected_scans": []
  },
  "results": [
    {
      "rfid_number": "RFID-001",
      "accepted": true,
      "result": "matched"
    }
  ]
}
```

Nilai `result` item:

| Result | Arti |
|---|---|
| `pending` | Belum terbaca. Biasanya terlihat pada sesi draft sebelum submit. |
| `matched` | RFID terbaca dan `current_rack` masih sama dengan snapshot awal. |
| `missing` | Tidak terbaca sampai sesi disubmit, tetapi lifecycle masih valid. |
| `lifecycle_changed` | RFID berubah lifecycle/lokasi setelah snapshot dibuat. |

Jika semua UID dalam satu batch ditolak, backend dapat mengembalikan HTTP `409`
dengan `success: false`, `errors`, `report`, dan `data` yang berisi report
terbaru. Mobile harus tetap menampilkan `result.report` tersebut dan hanya
menampilkan error pada UID terkait.

#### 6.3.1 Handler mobile setelah klik Proses scan

Mobile harus memperlakukan response `200` dan `409` sebagai response bisnis yang
dapat berisi report. Jangan langsung mengubah `409` menjadi alert `Internal
server error` sebelum membaca body response.

Gunakan fallback berikut agar kompatibel dengan response saat ini:

```ts
type StocktakeScanResponse = {
  success: boolean;
  report?: StocktakeReport;
  data?: StocktakeReport;
  results?: StocktakeScanResult[];
  message?: string;
  errors?: Array<{
    rfid_number?: string;
    code?: string;
    message: string;
  }>;
};

function reportFromResponse(response: StocktakeScanResponse) {
  return response.report ?? response.data ?? null;
}
```

Contoh alur ketika client memakai `fetch` langsung:

```ts
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rfid_numbers: stocktakeRfidNumbers,
    client_request_id: stocktakeScanRequestId,
  }),
});

const body = (await response.json()) as StocktakeScanResponse;
const report = reportFromResponse(body);

if (report) {
  setStocktakeReport(report);
}

if (response.status === 409) {
  // Ini business result, bukan otomatis masalah koneksi.
  showRejectedResults(body.results ?? body.errors ?? []);
  return;
}

if (!response.ok) {
  showGenericError(body.message ?? "Proses scan gagal.");
  return;
}
```

Jika API client melempar exception untuk HTTP `409`, ambil body dari lokasi
yang digunakan library tersebut, misalnya `error.response.data`, `error.body`,
atau `error.data`, lalu tetap jalankan:

```ts
const body = getErrorResponseBody(error);
const report = reportFromResponse(body);
if (report) setStocktakeReport(report);
```

Jangan membuat `client_request_id` baru ketika retry batch yang sama. Gunakan ID
yang sama agar backend mengembalikan hasil idempotent dan tidak menggandakan
event scan.

#### 6.3.2 Mapping kartu preview opname

Gunakan report yang sudah disimpan pada state mobile:

```ts
const items = report.racks.flatMap((rackGroup) => rackGroup.items);

const sesuai = items.filter((item) => item.result === "matched").length;
const lifecycleBerubah = items.filter(
  (item) => item.result === "lifecycle_changed",
).length;
const belumTerbacaDraft = items.filter(
  (item) => item.result === "pending",
).length;
const scanDitolak = report.rejected_scans.length;
```

Mapping kartu:

| Kartu UI | Sumber |
|---|---|
| `Sesuai` | `report.summary.scanned_count` atau jumlah item `matched`. |
| `Ekspektasi` | `report.summary.expected_count`. |
| `Belum terbaca` saat `draft` | Jumlah item dengan `result: "pending"`. |
| `Belum terbaca` setelah submit | `report.summary.missing_count`. |
| `Lifecycle berubah` | `report.summary.changed_count` atau jumlah item `lifecycle_changed`. |
| `Scan ditolak` | `report.summary.rejected_count` atau `report.rejected_scans.length`. |

Pada sesi `draft`, `missing_count` dapat bernilai `0` karena backend baru
menandai item sebagai `missing` saat submit. Karena itu, kartu `Belum terbaca`
harus memakai item `pending` selama user masih melakukan proses scan.

Detail per rak dirender dari:

```ts
report.racks.map((rackGroup) => (
  // rackGroup.rack.code
  // rackGroup.scanned_count / rackGroup.expected_count
  // rackGroup.items
));
```

Detail item minimal menampilkan `rfid_number`, `sku`, `product_name`,
`pack_number`, `units`, `expected_rack`, `observed_rack`, dan `result`.

#### 6.4 Submit report opname

```http
POST /api/mobile/stocktakes/{stocktake_session_id}/submit
```

Tidak ada payload wajib. Backend mengubah sesi dari `draft` menjadi `submitted`,
menandai item yang belum terbaca sebagai `missing` atau `lifecycle_changed`, lalu
mengembalikan report final. Request submit ulang pada sesi yang sama aman dan
mengembalikan `reused: true`.

```json
{
  "success": true,
  "data": {
    "session": {
      "id": "STOCKTAKE_UUID",
      "status": "submitted",
      "submitted_at": "2026-11-25T08:30:00.000Z"
    },
    "summary": {
      "expected_count": 5,
      "scanned_count": 4,
      "missing_count": 1,
      "changed_count": 0,
      "rejected_count": 1
    },
    "racks": []
  }
}
```

Mobile wajib mengosongkan buffer lokal hanya setelah response sukses diterima.
Submit tidak mengubah placement, rak, atau saldo inventory.

### 7. Simple history

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
- `relocationTargetRack`: satu rak tujuan untuk seluruh batch relocation.
- `relocationScannedItems`: daftar UID unik yang sudah discan sebelum preview.
- `relocationPreviewItems`: detail hasil preview, termasuk `current_rack` dan `target_rack`.
- `relocationSummary`: jumlah item per rak asal dan per produk.
- `stocktakeSession`: sesi opname draft/submitted yang sedang dibuka.
- `stocktakeRfidNumbers`: UID unik yang sudah terbaca pada sesi opname.
- `stocktakeReport`: summary dan grouping report per rak dari backend.
- `stocktakeRejectedScans`: UID yang ditolak beserta error code/message.
- `submitState`: `idle`, `loading`, `success`, atau `error`.
- `clientRequestId`: ID yang dibuat untuk satu batch scan atau submission.

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
| `RFID_NOT_IN_SNAPSHOT` | RFID belum ada saat sesi opname dibuat. |
| `DUPLICATE_IN_SESSION` | RFID sudah pernah terbaca pada sesi opname. |
| `RFID_ADMIN_NOT_READY` | Assignment, print label, atau penyelesaian PO belum lengkap. |
| `SAME_RACK` | Relocation menuju rak yang sama ditolak. |
| `RFID_ALREADY_REGISTERED` | UID sudah ada; gunakan assignment/reuse, bukan registrasi ulang. |
| `RFID_ALREADY_ASSIGNED_TO_PO` | RFID masih digunakan pada Session/PO lain. Lepas dari session lama terlebih dahulu sebelum digunakan pada session baru. |
| `RFID_DUPLICATE_IN_ITEM` | RFID sudah terpasang pada item yang sama. Jangan scan UID yang sama lagi. |
| `RFID_DUPLICATE_IN_SESSION` | RFID sudah digunakan pada item lain di session yang sama. |
| `RFID_REUSE_NOT_RELEASED` | Siklus RFID lama belum selesai atau belum dilepas. |
| `RFID_NOT_AVAILABLE` | RFID belum berstatus available untuk assignment baru. |
| `RFID_RETIRED` | RFID sudah retired dan tidak dapat digunakan kembali. |
| `RFID_ADMIN_NOT_READY` | Assignment, print label, atau penyelesaian session Admin belum lengkap. |
| `PACK_PLAN_CANCELLED` | Pack plan sudah dibatalkan. |
| `RACK_NOT_FOUND` | Rak tidak ditemukan. |
| `RACK_INACTIVE` | Rak sudah tidak aktif. |
| `DUPLICATE_RFID` / `duplicate_in_request` | RFID muncul lebih dari satu kali. |
| `IDEMPOTENCY_KEY_REUSED` | Request ID dipakai untuk payload berbeda. |
| `PLACEMENT_CONFLICT` | Barang sedang diproses oleh request lain. |

Jika final placement gagal, mobile tidak boleh mengubah status lokal menjadi `placed`.

### Kategori alert

Gunakan kategori berikut agar error bisnis tidak disalahartikan sebagai masalah
koneksi:

| Kategori | Kapan digunakan | Tindakan user |
|---|---|---|
| `BERHASIL` | RFID berhasil diproses atau seluruh batch valid | Lanjutkan ke tahap berikutnya |
| `DITOLAK` | RFID duplicate, masih dipakai session lain, placed, retired, atau lifecycle tidak valid | Perbaiki UID atau lakukan release melalui Admin |
| `SESSION AKTIF` | Scanner masih berjalan pada tab/perangkat lain | Tutup scanner yang lain |
| `KONEKSI TERPUTUS` | API, WebSocket, Orange Pi, atau jaringan benar-benar terputus | Periksa Orange Pi/jaringan, refresh, lalu hubungi Developer/Admin jika tetap gagal |

Untuk RFID yang masih berada pada Session A, jangan langsung memindahkannya ke
Session B. Admin harus melakukan release dari Session A terlebih dahulu. Setelah
status kembali `available` dan seluruh validasi lifecycle terpenuhi, RFID dapat
di-assign ke Session B.

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

Mobile boleh menyimpan submission atau batch scan pending di AsyncStorage karena
payload placement/opname bukan token/secret. Simpan payload lengkap dan ID yang sama:

```json
{
  "client_request_id": "MOBILE-REQUEST-UUID",
  "rack_id": "RACK_UUID",
  "rfid_numbers": ["RFID-001", "RFID-002"],
  "created_at": "2026-11-19T10:30:00.000Z",
  "status": "pending"
}
```

Untuk batch scan opname, payload pending minimalnya:

```json
{
  "stocktake_session_id": "STOCKTAKE_UUID",
  "client_request_id": "STOCKTAKE-SCAN-UUID",
  "rfid_numbers": ["RFID-001", "RFID-002"],
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
- [ ] Relocation memilih rak tujuan sebelum scan.
- [ ] Relocation dapat menggabungkan UID dari beberapa rak asal ke satu rak tujuan.
- [ ] Relocation memanggil preview sebelum submit final.
- [ ] Detail UID, produk, pack, expiry, rak asal, dan rak tujuan tampil sebelum konfirmasi.
- [ ] Summary relocation dikelompokkan per rak asal dan per produk.
- [ ] Submit relocation atomic; tidak ada perpindahan sebagian jika satu UID invalid.
- [ ] Tombol submit mencegah double tap.
- [ ] Timeout melakukan retry dengan request ID yang sama.
- [ ] Success membersihkan batch dan menampilkan konfirmasi.
- [ ] Error tidak mengubah status lokal menjadi placed.
- [ ] Simple history dapat ditampilkan.
- [ ] Screen daftar dan buat sesi opname tersedia di mobile.
- [ ] Sesi opname menyimpan tanggal pembuatan dari response backend.
- [ ] Scan opname hanya menerima RFID yang sudah placed.
- [ ] Preview opname dikelompokkan berdasarkan rak dari backend.
- [ ] Detail produk, SKU, pack, unit, UID, dan result tampil pada detail rak.
- [ ] Scan rejected ditampilkan terpisah dari item report yang sah.
- [ ] Submit opname disabled jika sesi bukan `draft`.
- [ ] Submit opname tidak mengubah placement atau saldo stok.
- [ ] Retry batch scan memakai `client_request_id` yang sama.
- [ ] Sesi submitted tidak dapat diedit dari mobile.
- [ ] Handler scan membaca `response.report` dengan fallback ke `response.data`.
- [ ] HTTP `409` proses scan tetap merender report dan tidak menjadi alert koneksi.
- [ ] `results` atau `errors` dari batch terakhir ditampilkan per UID.
- [ ] Kartu `Belum terbaca` saat draft menghitung item `result: "pending"`.
- [ ] Kartu `Belum terbaca` setelah submit memakai `summary.missing_count`.
- [ ] Kartu `Sesuai`, `Ekspektasi`, `Lifecycle berubah`, dan `Scan ditolak` terisi dari report.

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

### RFID history lintas cycle

Backend menyimpan lifecycle history RFID agar penggunaan ulang tetap dapat
ditelusuri. Endpoint detailnya:

```http
GET /api/rfid/{rfid_tag_id}/history
```

Response berisi `tag` dan daftar `events` berurutan:

```json
{
  "success": true,
  "data": {
    "tag": {
      "id": 1,
      "rfid_number": "RFID-001",
      "status": "available"
    },
    "events": [
      {
        "cycle_number": 1,
        "event_type": "registered",
        "created_at": "2026-11-19T08:00:00.000Z"
      },
      {
        "cycle_number": 1,
        "event_type": "placed",
        "po_pack_plan_id": "PACK_PLAN_UUID",
        "to_rack": {
          "code": "RAK-A",
          "name": "Rak A"
        },
        "created_at": "2026-11-19T10:00:00.000Z"
      },
      {
        "cycle_number": 1,
        "event_type": "outbound",
        "created_at": "2026-11-20T10:00:00.000Z"
      },
      {
        "cycle_number": 2,
        "event_type": "assigned_to_pack",
        "created_at": "2026-11-21T08:00:00.000Z"
      }
    ]
  }
}
```

Event penting yang dapat muncul adalah `registered`, `assigned_to_pack`,
`label_printed`, `po_completed`, `placed`, `relocated`, `stocktake_seen`,
`stocktake_submitted`, `outbound`, `trash`, dan `available_for_reuse`.
Mobile cukup menampilkan histori jika screen detail RFID dibutuhkan; mobile
tidak boleh mengubah atau menghapus event history.

## P2 — Roadmap berikutnya

### Fitur lain

Jangan implementasikan sekarang:

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

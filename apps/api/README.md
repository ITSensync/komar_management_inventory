# KOMAR API

Express.js API untuk katalog produk, session PO, RFID, dan job label. Aplikasi ini dijalankan bersama dashboard dan MySQL dari root monorepo.

## Menjalankan

Gunakan [README root](../../README.md) untuk menjalankan seluruh stack:

```bash
docker compose up --build -d
```

Untuk pengembangan API tanpa Docker, root `.env` dibaca otomatis. Pastikan `DB_HOST=localhost` dan MySQL lokal tersedia, kemudian jalankan:

```bash
npm install
npm run db:sync
npm run dev
```

`db:sync:alter` hanya untuk development atau database uji; lakukan backup sebelum memakainya.

## Kontrak API

- Swagger: `http://localhost:3000/docs`
- OpenAPI: [docs/openapi.yaml](docs/openapi.yaml)
- Health: `GET /health`

Dokumentasi implementasi lintas aplikasi berada pada [docs/api](../../docs/api/).

## Database Models

Model Sequelize di `models/index.js` mencakup katalog, RFID, session PO admin, item PO, rencana paket RFID, job label, serta fondasi operasi gudang lainnya. Session PO, scan/assignment RFID, dan job label telah memiliki endpoint; penerimaan barang dan operasi gudang lanjutan belum tersedia sebagai API.

## API Endpoints

Dokumentasi interaktif Swagger tersedia pada `http://localhost:3000/docs`. File OpenAPI dapat diambil pada `http://localhost:3000/docs/openapi.yaml`.

### 1. Health Check
```
GET http://localhost:3000/health
```

### 2. Products

```text
GET    /api/products
POST   /api/products
GET    /api/products/:id
PUT    /api/products/:id
DELETE /api/products/:id
```

Contoh membuat produk:

```json
{
  "sku": "SUSU-250",
  "name": "Susu 250 ml",
  "base_unit": "pcs",
  "supplier_pack_units": 12,
  "supplier_pack_label": "pack",
  "min_outbound_units": 5,
  "expiry_required": true
}
```

`supplier_pack_units` adalah isi kemasan yang dibeli dari supplier; `min_outbound_units` adalah ukuran pack hasil repack gudang yang menerima satu RFID dan satu label. Kedua nilai tidak harus kelipatan satu sama lain. Produk yang sudah dipakai pada lot, penerimaan, outbound, atau item session PO tidak dapat dihapus; gunakan `PUT` dengan `status: "inactive"`.

### 3. Get All RFID Tags
```
GET http://localhost:3000/api/rfid
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "rfid_number": "E2806894000040168D432183",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 4. Insert Multiple RFID Tags
```
POST http://localhost:3000/api/rfid
Content-Type: application/json

{
  "rfid_tags": [
    "E2806894000040168D432183",
    "E2806894000040168D43218C",
    "E2806894000040168D432180"
  ]
}
```

UID akan di-trim dan diubah ke huruf besar. UID yang sudah tersimpan atau muncul dua kali dalam satu submit dikembalikan pada `errors`, tetapi UID baru yang valid disimpan dengan status `available`. Registrasi master tidak pernah menggandakan UID; reuse dilakukan melalui assignment ke pack plan baru setelah lifecycle lama berstatus `outbound` atau `trash`.

Response:
```json
{
  "success": true,
  "total_requested": 3,
  "total_inserted": 3,
  "total_errors": 0,
  "results": [
    {
      "rfid_number": "E2806894000040168D432183",
      "success": true,
      "id": 1,
      "status": "available"
    },
    {
      "rfid_number": "E2806894000040168D43218C",
      "success": true,
      "id": 2
    },
    {
      "rfid_number": "E2806894000040168D432180",
      "success": true,
      "id": 3
    }
  ]
}
```

### 5. Get RFID Tag by ID
```
GET http://localhost:3000/api/rfid/1
```

### 6. Delete RFID Tag
```
DELETE http://localhost:3000/api/rfid/1
```

### 7. PO preparation session dan label RFID

Satu session dapat berisi banyak item PO. Saat item dibuat, backend menghitung total base unit dari jumlah pack supplier, lalu membuat satu rencana paket repack per RFID. Contoh `50 pack × 12 pcs = 600 pcs`, dengan `min_outbound_units: 5`, membuat `120` rencana paket RFID.

```text
GET    /api/po-sessions
POST   /api/po-sessions
GET    /api/po-sessions/:id
PATCH  /api/po-sessions/:id
POST   /api/po-sessions/:id/cancel
POST   /api/po-sessions/:id/complete

POST   /api/po-sessions/:id/items
PATCH  /api/po-session-items/:id
DELETE /api/po-session-items/:id
POST   /api/po-session-items/:id/rfid-scans
GET    /api/po-session-items/:id/rfid-progress
POST   /api/po-session-items/:id/print-jobs

DELETE /api/po-pack-plans/:id/rfid
POST   /api/po-pack-plans/:id/reprint
POST   /api/mobile/placements/relocation
POST   /api/mobile/placements/outbound
POST   /api/mobile/placements/trash
GET    /api/print-jobs/:id
POST   /api/print-jobs/:id/mark-printed
```

Buat session:

```json
{
  "session_number": "PO-2026-001",
  "reference_number": "PO-SUPPLIER-001",
  "notes": "Persiapan penerimaan barang"
}
```

Tambahkan susu 250 ml ke session:

```json
{
  "product_id": "UUID_PRODUK",
  "ordered_supplier_pack_quantity": 50,
  "expires_on": "2026-12-31"
}
```

`supplier_pack_units` dan `min_outbound_units` dibaca dari katalog produk.
PO Session tidak lagi menerima `min_outbound_units`; nilai tersebut tetap
disimpan sebagai snapshot pada item PO untuk menjaga histori dan menghitung
jumlah pack/RFID secara konsisten.

Scan UID untuk satu item menggunakan `rfid_tags`. Pada alur Admin realtime PO,
UID baru yang belum ada di master akan didaftarkan dan langsung dipasangkan
secara atomik. UID yang masih dipakai, sudah placed, atau duplikat akan ditolak.

Aturan reuse UID: UID yang belum pernah masuk session boleh dipakai; UID yang
sudah `unplaced`, `placed`, atau `relocation` tidak boleh dipakai pada pack
lain; UID boleh dipakai kembali setelah assignment dilepas atau lifecycle
berhasil menjadi `outbound`/`trash`. Pembacaan duplicate dari reader diabaikan
tanpa alert frontend dan tidak membuat assignment kedua.

```json
{
  "rfid_tags": [
    "E2806894000040168D432183",
    "E2806894000040168D43218C"
  ]
}
```

Setelah semua UID yang dibutuhkan terpasang, buat job label dengan `{ "format": "pdf" }` atau `{ "format": "zpl" }`. Respons job berisi snapshot label (SKU, produk, expiry, jumlah per paket, nomor paket, UID RFID, dan `label_code`) yang dapat dirender/dikirim oleh frontend atau print bridge. Endpoint `mark-printed` hanya dipanggil setelah printer menyelesaikan cetak.

### 8. Site employee placement

Rak dibuat oleh Admin melalui endpoint berikut:

```text
GET    /api/racks
POST   /api/racks
GET    /api/racks/:id
PATCH  /api/racks/:id
```

Mobile hanya mengambil rak active, memvalidasi RFID yang discan, lalu submit placement batch:

```text
GET  /api/mobile/racks?status=active
POST /api/mobile/placements/preview
POST /api/mobile/placements
GET  /api/mobile/placements/history
```

Contoh final placement:

```json
{
  "rack_id": "RACK_UUID",
  "rfid_numbers": ["E2806894000040168D432183", "E2806894000040168D43218C"],
  "client_request_id": "MOBILE-UUID"
}
```

Backend hanya menerima RFID yang sudah terdaftar dan pack plan yang masih `unplaced`. Proses final bersifat atomik: setiap pack plan berubah menjadi `placed`, `current_rack_id` diisi, dan satu histori `inventory_movement` dibuat per RFID. `client_request_id` harus dipakai ulang ketika mobile melakukan retry setelah timeout.

Status session PO adalah `active`, `completed`, atau `cancelled`. Label yang tercetak hanya menyelesaikan item terkait; session tetap `active` dan admin masih dapat menambahkan item baru. Admin memakai `POST /api/po-sessions/:id/complete` untuk menutup session secara manual setelah seluruh item memiliki label tercetak.

## Project Structure
```
apps/api/
├── config/
│   ├── database.js          # Konfigurasi Sequelize
│   └── env.js               # Memuat root .env monorepo
├── controllers/             # Handler HTTP produk, RFID, session PO
├── models/                  # Model dan relasi Sequelize
├── routes/                  # Route produk, RFID, session PO
├── services/                # Aturan bisnis dan akses database
├── utils/                   # Validasi dan normalisasi domain
├── middleware/              # Respons error tak terduga
├── scripts/syncDatabase.js  # Job schema untuk service migrate
├── docs/openapi.yaml        # Sumber kebenaran kontrak API
└── server.js                # Entry point
```

## Database Schema

Tabel `rfid_tags`:
- `id` (INT, PRIMARY KEY, AUTO INCREMENT)
- `rfid_number` (VARCHAR 255, UNIQUE, NOT NULL)
- `createdAt` (DATETIME)
- `updatedAt` (DATETIME)

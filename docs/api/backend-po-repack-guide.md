# Panduan Backend — PO Supplier, Repack Gudang, RFID, dan Label

> **Status:** Kontrak target untuk menggantikan aturan lama `units_per_pack` ↔ `min_outbound_units`.
>
> **Tujuan:** membedakan kemasan pembelian dari supplier dengan pack hasil repack gudang yang menerima RFID, label, dan menjadi minimum outbound.

---

## 1. Model bisnis

Contoh utama:

```text
Produk: Susu UHT 250 ml

Kemasan supplier: 1 pack = 12 pcs
Order supplier: 50 pack
Total fisik: 50 × 12 = 600 pcs

Repack gudang: 1 pack = 5 pcs
Minimum outbound: 5 pcs

Kebutuhan: 600 ÷ 5 = 120 pack plan, 120 RFID, 120 label
```

Satu `pack plan` selalu berarti satu pack hasil repack gudang:

```text
5 pcs + 1 RFID + 1 label
```

## 2. Istilah dan rumus resmi

| Field | Arti | Contoh |
|---|---|---:|
| `base_unit` | Satuan fisik paling kecil. | `pcs` |
| `supplier_pack_units` | Jumlah base unit dalam satu pack supplier. | `12` |
| `ordered_supplier_pack_quantity` | Jumlah pack supplier pada PO. | `50` |
| `ordered_quantity` | Total base unit hasil kalkulasi backend. | `600` |
| `min_outbound_units` | Isi satu pack repack; satu RFID dan label. | `5` |
| `required_rfid_count` | Jumlah pack plan/RFID/label. | `120` |

```text
ordered_quantity = ordered_supplier_pack_quantity × supplier_pack_units_snapshot
required_rfid_count = ordered_quantity ÷ min_outbound_units
```

Backend adalah sumber kebenaran kedua hasil tersebut. Frontend hanya boleh menampilkan preview.

---

## 3. Perubahan skema data

### 3.1 Produk

Gantikan makna ambigu `units_per_pack` dengan field baru berikut.

```text
products
  base_unit                 varchar not null
  supplier_pack_units       integer not null check (supplier_pack_units > 0)
  supplier_pack_label       varchar null
  min_outbound_units        integer not null check (min_outbound_units > 0)
```

`supplier_pack_label` bersifat opsional, dengan default aplikasi `pack`. Contoh isi: `pack`, `dus`, atau `karton`.

**Hapus validasi lama:**

```text
min_outbound_units harus kelipatan units_per_pack
```

Nilai `12` untuk kemasan supplier dan `5` untuk repack gudang harus valid.

### 3.2 Item session

Tambahkan snapshot agar perubahan produk tidak merusak histori PO.

```text
po_session_items
  ordered_supplier_pack_quantity  integer not null check (> 0)
  supplier_pack_units_snapshot    integer not null check (> 0)
  supplier_pack_label_snapshot    varchar null
  ordered_quantity                integer not null check (> 0)
  min_outbound_units              integer not null check (> 0)
  required_rfid_count             integer not null check (> 0)
```

`ordered_quantity`, `required_rfid_count`, serta seluruh `pack_plans` harus dibuat oleh service backend di dalam transaksi yang sama.

---

## 4. API katalog produk

### POST `/api/products`

```json
{
  "sku": "KMR-SUSU-250ML",
  "name": "Susu UHT 250 ml",
  "base_unit": "pcs",
  "supplier_pack_units": 12,
  "supplier_pack_label": "pack",
  "min_outbound_units": 5,
  "expiry_required": false
}
```

Validasi:

- SKU unik;
- `supplier_pack_units` integer positif;
- `min_outbound_units` integer positif;
- tidak ada validasi kelipatan antara dua field tersebut.

### GET `/api/products` dan GET `/api/products/:id`

```json
{
  "success": true,
  "data": {
    "id": "PRODUCT_UUID",
    "sku": "KMR-SUSU-250ML",
    "name": "Susu UHT 250 ml",
    "base_unit": "pcs",
    "supplier_pack_units": 12,
    "supplier_pack_label": "pack",
    "min_outbound_units": 5,
    "expiry_required": false,
    "status": "active"
  }
}
```

`PUT /api/products/:id` memakai field yang sama. Produk yang telah dipakai tetap sebaiknya diubah menjadi `inactive`, bukan dihapus.

---

## 5. API item di dalam Session PO

### POST `/api/po-sessions/:sessionId/items`

```json
{
  "product_id": "PRODUCT_UUID",
  "ordered_supplier_pack_quantity": 50,
  "min_outbound_units": 5,
  "expires_on": "2026-12-31",
  "notes": "Repack untuk gudang"
}
```

`min_outbound_units` tetap dikirim pada item agar admin dapat memakai ukuran repack berbeda dari default produk, selama belum ada RFID yang terpasang.

### Algoritme wajib backend

Lakukan seluruh langkah berikut dalam satu transaksi database.

```text
1. Pastikan PO session berstatus active.
2. Ambil produk berstatus active.
3. Salin supplier_pack_units dan supplier_pack_label ke snapshot item.
4. ordered_quantity = ordered_supplier_pack_quantity × supplier_pack_units_snapshot.
5. Tolak bila ordered_quantity % min_outbound_units !== 0.
6. required_rfid_count = ordered_quantity ÷ min_outbound_units.
7. Buat tepat required_rfid_count pack plan kosong.
8. Set setiap pack plan.units = min_outbound_units.
9. Simpan item, snapshot, dan seluruh pack plan.
```

Contoh:

```text
50 × 12 = 600 pcs
600 ÷ 5 = 120 pack plan
```

### Respons

```json
{
  "success": true,
  "data": {
    "id": "ITEM_UUID",
    "product_id": "PRODUCT_UUID",
    "product_name_snapshot": "Susu UHT 250 ml",
    "base_unit_snapshot": "pcs",
    "ordered_supplier_pack_quantity": 50,
    "supplier_pack_units_snapshot": 12,
    "supplier_pack_label_snapshot": "pack",
    "ordered_quantity": 600,
    "min_outbound_units": 5,
    "required_rfid_count": 120,
    "expires_on": "2026-12-31",
    "status": "pending_tags"
  },
  "required_rfid_count": 120,
  "message": "120 RFID pack plans were created."
}
```

### PATCH `/api/po-session-items/:itemId`

Payload memakai bentuk yang sama dengan `POST`. Endpoint hanya boleh berhasil jika item belum mempunyai RFID. Backend menghapus pack plan kosong lama, menghitung ulang, lalu membuat pack plan baru.

### Error validasi contoh

```json
{
  "success": false,
  "message": "Validation failed.",
  "errors": [
    {
      "field": "min_outbound_units",
      "message": "Total 12 pcs from 1 supplier pack cannot be evenly divided into repack units of 5 pcs."
    }
  ]
}
```

---

## 6. Detail session, RFID, dan label

`GET /api/po-sessions/:id` harus mengembalikan seluruh snapshot item di atas, selain `packPlans`, RFID, dan ringkasan print job.

Kontrak berikut tidak berubah:

- satu RFID hanya untuk satu pack plan aktif;
- `POST /api/po-session-items/:id/rfid-scans` memasangkan UID ke pack plan kosong secara berurutan;
- `GET /api/po-session-items/:id/rfid-progress` memakai `required_rfid_count` hasil kalkulasi backend;
- print job hanya dapat dibuat setelah semua RFID terpasang;
- satu label tetap mewakili satu pack plan;
- label menampilkan `units` dari pack plan, yaitu `min_outbound_units`;
- session hanya dapat selesai bila semua item berstatus `printed`.

Informasi supplier pada `label_snapshot` bersifat opsional dan hanya diperlukan bila ingin dicetak sebagai informasi tambahan. Isi pack label tetap harus menunjukkan pack repack, contoh `5 pcs`.

---

## 7. Migrasi data

1. Tambahkan `supplier_pack_units` pada produk dalam keadaan nullable.
2. Isi nilai per SKU melalui keputusan bisnis. Produk loose memakai nilai `1`.
3. Setelah backfill selesai, jadikan `NOT NULL` dan tambahkan check constraint positif.
4. Tambahkan snapshot baru ke item session.
5. Untuk histori lama, gunakan:

```text
ordered_supplier_pack_quantity = ordered_quantity
supplier_pack_units_snapshot = 1
supplier_pack_label_snapshot = null
```

6. Jangan menghitung ulang atau mengubah jumlah pack plan pada item lama.
7. Deprecate `units_per_pack` lama setelah semua klien memakai `supplier_pack_units`.

> Jangan otomatis menyalin nilai `units_per_pack` lama menjadi `supplier_pack_units` tanpa audit SKU. Nilai lama bisa saja merepresentasikan ukuran repack, bukan kemasan supplier.

---

## 8. Konsistensi dan operasional

- Semua kalkulasi dan pembuatan pack plan wajib atomik.
- Gunakan transaksi dan rollback bila salah satu pack plan gagal dibuat.
- Gunakan lock/transaksi yang sudah dipakai pada proses assignment RFID agar satu UID tidak dapat dipasang paralel.
- Perubahan `supplier_pack_units` produk hanya berlaku untuk item baru; item lama memakai snapshot.
- Development API harus mengizinkan origin frontend melalui CORS:

```text
http://localhost:3001
http://127.0.0.1:3001
```

---

## 9. QA wajib

| Skenario | Hasil |
|---|---|
| Produk supplier `12`, repack `5` | Berhasil dibuat. |
| Item `50 × 12`, repack `5` | `ordered_quantity: 600`, `required_rfid_count: 120`. |
| Item `1 × 12`, repack `5` | Ditolak karena tersisa 2 pcs. |
| Produk loose `supplier_pack_units: 1`, order `600`, repack `5` | Berhasil dengan 120 pack plan. |
| Scan 120 UID unik | UID dipasang berurutan ke pack 1–120. |
| Print job | Memuat 120 label dengan `units: 5`. |
| Ubah item setelah RFID dipasang | Ditolak `409`. |
| Ubah produk setelah item dibuat | Snapshot item lama tidak berubah. |

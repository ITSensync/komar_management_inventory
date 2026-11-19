# ERD KOMAR — Current Admin PO/RFID/Label Scope

> Dokumen ini menggambarkan schema yang aktif saat ini. Scope yang didukung adalah
> katalog produk, persiapan session PO, assignment RFID, pencetakan label, dan scan
> realtime melalui Orange Pi. Receiving gudang, lokasi/rak, opname, relokasi,
> outbound, autentikasi, dan multi-site belum termasuk dalam schema aktif.

## Tabel aktif

| Tabel | Fungsi sederhana |
|---|---|
| `products` | Katalog produk dan konfigurasi kemasan supplier/repack. |
| `po_sessions` | Wadah satu pekerjaan persiapan PO. |
| `po_session_items` | Produk yang dimasukkan ke dalam session PO. |
| `po_pack_plans` | Rencana paket fisik; satu paket memiliki maksimal satu RFID aktif. |
| `rfid_tags` | Inventaris UID RFID. Primary key tetap integer untuk kompatibilitas hardware/API. |
| `label_print_jobs` | Satu pekerjaan cetak awal atau cetak ulang. |
| `label_print_items` | Snapshot setiap label di dalam print job. |
| `rfid_scan_sessions` | Satu sesi pembacaan RFID realtime dari reader. |
| `rfid_scan_events` | Log setiap event UID dari reader, termasuk hasil dan error. |

## Relasi

```mermaid
erDiagram
    PRODUCTS ||--o{ PO_SESSION_ITEMS : "dipilih dalam"
    PO_SESSIONS ||--o{ PO_SESSION_ITEMS : "memiliki"
    PO_SESSION_ITEMS ||--o{ PO_PACK_PLANS : "membuat"
    RFID_TAGS ||--o| PO_PACK_PLANS : "dipasangkan ke"

    PO_SESSIONS ||--o{ LABEL_PRINT_JOBS : "memiliki"
    PO_SESSION_ITEMS ||--o{ LABEL_PRINT_JOBS : "dicetak sebagai"
    LABEL_PRINT_JOBS ||--o{ LABEL_PRINT_ITEMS : "berisi"
    PO_PACK_PLANS ||--o{ LABEL_PRINT_ITEMS : "memiliki snapshot"

    PO_SESSION_ITEMS ||--o{ RFID_SCAN_SESSIONS : "dipindai melalui"
    RFID_SCAN_SESSIONS ||--o{ RFID_SCAN_EVENTS : "mencatat"

    PRODUCTS {
        uuid id PK
        string sku UK
        string name
        int supplier_pack_units
        int min_outbound_units
        enum status
    }
    PO_SESSIONS {
        uuid id PK
        string session_number UK
        enum status
    }
    PO_SESSION_ITEMS {
        uuid id PK
        uuid po_session_id FK
        uuid product_id FK
        int ordered_quantity
        int required_rfid_count
        enum status
    }
    PO_PACK_PLANS {
        uuid id PK
        uuid po_session_item_id FK
        int rfid_tag_id FK
        int sequence_number
        enum status
    }
    RFID_TAGS {
        int id PK
        string rfid_number UK
        enum status
    }
    LABEL_PRINT_JOBS {
        uuid id PK
        uuid po_session_id FK
        uuid po_session_item_id FK
        enum job_type
        enum status
    }
    LABEL_PRINT_ITEMS {
        uuid id PK
        uuid label_print_job_id FK
        uuid po_pack_plan_id FK
        int print_version
        json label_snapshot
    }
    RFID_SCAN_SESSIONS {
        uuid id PK
        uuid po_session_item_id FK
        string reader_code
        enum status
    }
    RFID_SCAN_EVENTS {
        uuid id PK
        uuid rfid_scan_session_id FK
        string event_id UK
        string rfid_number
        enum status
    }
```

## Alur data utama

```text
products
  → po_sessions
  → po_session_items
  → po_pack_plans
  → rfid_tags
  → label_print_jobs
  → label_print_items
```

Saat hardware digunakan, alurnya adalah:

```text
po_session_items
  → rfid_scan_sessions
  → rfid_scan_events
  → assignment ke po_pack_plans dan rfid_tags
```

## Catatan print job

`label_print_jobs` menyimpan riwayat pekerjaan cetak. Job awal yang sudah `generated`
atau `printed` digunakan kembali jika endpoint yang sama dipanggil ulang. Cetak ulang
yang disengaja membuat job baru dengan `job_type = reprint`.

`label_print_items.label_snapshot` adalah salinan data label pada saat job dibuat,
bukan data katalog yang selalu berubah.

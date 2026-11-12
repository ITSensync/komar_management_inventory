# RFID Inventory Backend

Express.js backend untuk RFID inventory management system dengan Sequelize ORM.

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Database
Edit file `.env` dengan konfigurasi database Anda:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=password_anda
DB_NAME=rfid_inventory
DB_PORT=3306
NODE_ENV=development
PORT=3000
```

### 3. Jalankan Server
```bash
npm start
```

Atau untuk development dengan hot reload:
```bash
npm run dev
```

### 4. Buat schema database
```bash
npm run db:sync
```

Untuk memperbarui database lokal lama yang sudah memiliki tabel `rfid_tags`, gunakan:

```bash
npm run db:sync:alter
```

`db:sync:alter` hanya untuk development atau database uji. Jangan jalankan pada production tanpa backup dan review perubahan schema.

## Docker di VPS

Compose ini menjalankan API dan job schema `migrate`. MySQL berada di luar Compose dan tidak ada port database yang dibuka oleh project ini.

```bash
cp .env.example .env
# Isi DB_HOST, DB_NAME, DB_USER, dan DB_PASSWORD sesuai MySQL VPS.
docker compose up --build -d
docker compose ps
docker compose logs -f api
```

Service `migrate` menjalankan `npm run db:sync` sekali. API hanya berjalan bila job tersebut berhasil. API dipublikasikan pada `127.0.0.1:${API_PORT}`, sehingga gunakan Nginx atau Caddy sebagai reverse proxy HTTPS.

Jika MySQL berada pada VPS yang sama tetapi tidak berada dalam Compose, gunakan `DB_HOST=host.docker.internal`. Jika berada pada host lain, gunakan hostname atau IP privat host tersebut. Buat user MySQL khusus aplikasi, bukan user `root`.

Untuk rollout versi baru:

```bash
docker compose up --build -d
```

Jalankan backup database sebelum rollout yang dapat mengubah schema. `db:sync` hanya membuat tabel yang belum ada; perubahan tabel yang sudah ada memerlukan migration versioned tersendiri.

## Database Models

Model Sequelize di `models/index.js` mengikuti ERD gudang tunggal: user dan sesi login, supplier, produk, lot, penerimaan, pack RFID, lokasi, ledger stok, opname, outbound, serta audit. Model ini hanya membuat schema, belum menambahkan endpoint atau logika API baru.

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
  "units_per_pack": 5,
  "min_outbound_units": 5,
  "expiry_required": true
}
```

`min_outbound_units` harus merupakan kelipatan `units_per_pack`. Produk yang sudah dipakai pada lot, penerimaan, atau outbound tidak dapat dihapus, gunakan `PUT` dengan `status: "inactive"`.

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

UID akan di-trim dan diubah ke huruf besar. UID yang sudah tersimpan atau muncul dua kali dalam satu submit dikembalikan pada `errors`, tetapi UID valid lain tetap disimpan dengan status `available`.

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

## Project Structure
```
be-rfid-inventory/
├── config/
│   └── database.js          # Konfigurasi Sequelize
├── controllers/
│   ├── productController.js # HTTP request dan response produk
│   └── rfidController.js    # HTTP request dan response RFID
├── models/
│   ├── index.js             # Model dan relasi Sequelize
│   └── RfidTag.js           # Export model RFID tag
├── routes/
│   ├── productRoutes.js     # Product API routes
│   └── rfidRoutes.js        # RFID API routes
├── services/
│   ├── productService.js    # Aturan bisnis dan akses database produk
│   └── rfidService.js       # Aturan bisnis dan akses database RFID
├── utils/
│   ├── products.js          # Validasi dan normalisasi produk
│   └── rfidTags.js          # Normalisasi UID RFID
├── middleware/
│   └── errorHandler.js      # Respons error tak terduga
├── server.js                # Entry point
├── package.json
├── .env                     # Environment variables
└── .gitignore
```

## Database Schema

Tabel `rfid_tags`:
- `id` (INT, PRIMARY KEY, AUTO INCREMENT)
- `rfid_number` (VARCHAR 255, UNIQUE, NOT NULL)
- `createdAt` (DATETIME)
- `updatedAt` (DATETIME)

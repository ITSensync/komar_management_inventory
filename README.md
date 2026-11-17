# KOMAR Inventory Management

Monorepo untuk dashboard web, API RFID, database MySQL, dan dokumentasi operasional KOMAR.

## Struktur

```text
apps/
  api/                 Express.js + Sequelize + MySQL
  web/                 Next.js dashboard
docs/
  api/                 Kontrak dan panduan integrasi
  hardware/             Kontrak integrasi hardware eksternal
  database/            ERD
  ARCHITECTURE.md       Batas layanan dan alur request
  PRD_KOMAR_Inventory_Management.md
compose.yml            Stack lokal: MySQL, migrate, API, web
```

## Menjalankan seluruh stack

Prasyarat: Docker Compose v2 dan Docker Engine. Node.js 22+ serta pnpm diperlukan hanya untuk menjalankan aplikasi tanpa Docker.

```bash
cp .env.example .env
# Ganti DB_PASSWORD dan MYSQL_ROOT_PASSWORD sebelum menjalankan pada lingkungan bersama.
docker compose up --build -d
docker compose ps
```

- Dashboard: http://localhost:3001
- API: http://localhost:3000
- Swagger/OpenAPI: http://localhost:3000/docs
- Health API: http://localhost:3000/health
- Health web: http://localhost:3001/health

Browser selalu mengakses API melalui `http://localhost:3001/api/...`. Next.js meneruskan request tersebut ke service API internal; nama Docker `api` tidak pernah dikirim ke browser.

Untuk menghentikan stack tanpa menghapus data:

```bash
docker compose down
```

Reset data lokal secara sengaja:

```bash
docker compose down -v
```

## Perintah pengembangan

```bash
npm run dev:api
npm run dev:web
npm run test:api
npm run test:web
npm run lint:web
npm run build:web
npm run check:api
npm run docker:config
```

API menggunakan `npm` dan web menggunakan `pnpm`; masing-masing lockfile dipertahankan agar perubahan dependency tidak bercampur. Versi Node yang diuji tercatat pada `.nvmrc` (22).

## Dokumentasi

- [Arsitektur dan batas layanan](docs/ARCHITECTURE.md)
- [PRD](docs/PRD_KOMAR_Inventory_Management.md)
- [Kontrak frontend PO/RFID](docs/api/frontend-po-rfid-guide.md)
- [Panduan backend repack](docs/api/backend-po-repack-guide.md)
- [OpenAPI](apps/api/docs/openapi.yaml) — sumber kebenaran endpoint yang juga disajikan oleh Swagger.
- [ERD](docs/database/ERD_KOMAR_Inventory_Management.md)
- [Integrasi Orange Pi RFID TCP/IP](docs/hardware/orangepi-rfid-websocket.md)

## Git

Repository ini mempertahankan riwayat backend lama. Remote `legacy-backend` hanya merupakan referensi historis dan **bukan** target push monorepo. Tambahkan remote monorepo baru sebelum melakukan push pertama.

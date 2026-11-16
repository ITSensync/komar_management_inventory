# KOMAR Web

Dashboard Next.js untuk katalog, Session PO, assignment RFID, dan label. Jalankan seluruh aplikasi melalui [README root](../../README.md).

## Menjalankan lokal

```bash
pnpm install
pnpm dev
```

Dashboard berjalan pada `http://localhost:3001`. Request browser ke `/api/*` diteruskan Next.js ke API internal. Untuk menjalankan Next.js di luar Docker dengan API pada host yang berbeda, atur `INTERNAL_API_BASE_URL`; jangan memakai hostname jaringan Docker pada `NEXT_PUBLIC_API_BASE_URL`.

## Fitur

- CRUD katalog produk.
- Daftar, pembuatan, metadata, pembatalan, dan penyelesaian manual Session PO.
- Tambah, ubah, dan hapus item sebelum RFID dipasangkan.
- Buffer, deduplikasi, penyimpanan, progres, dan pelepasan scan RFID.
- Inventaris RFID umum.
- Pembuatan preview label PDF/ZPL, browser print, konfirmasi hasil cetak, dan cetak ulang per paket.

## Pemeriksaan

```bash
pnpm lint
pnpm test
pnpm build
```

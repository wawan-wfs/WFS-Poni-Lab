# Kemajuan Poni Rust

Pembaruan: 22 November 2026. Acuan inventaris adalah 23 modul yang mendaftarkan diri melalui `N.register` dalam aset frontend Poni 1.8.1 yang disediakan pengguna. Modul diperlakukan sama untuk hitungan ini, meskipun ukuran dan tingkat kerumitannya berbeda. Ini bukan daftar lengkap fitur: Home, Shelf, Stats, Dock, pengaturan, integrasi sistem, dan perilaku lainnya berada di luar 23 modul tersebut.

| Status | Jumlah | Persentase dari 23 modul |
| --- | ---: | ---: |
| Sudah dimulai, masih sebagian | 5 | 21,7% |
| Belum diimplementasikan sebagai modul | 18 | 78,3% |
| Terbukti setara penuh | 0 | 0% |

Kategori pertama tidak berarti modul sudah selesai. Belum ada ukuran yang cukup untuk menghitung persentase kesamaan seluruh aplikasi; 21,7% bukan persentase penyelesaian keseluruhan. Modul dinyatakan setara hanya setelah fitur, tampilan, penyimpanan, integrasi, serta perilaku kesalahan dibandingkan dengan aplikasi asli dan diuji.

## Modul yang sudah dimulai

- **Todo:** tambah, ubah, hapus, selesaikan, tanggal jatuh tempo dan pengingat dasar. Pengulangan, subtask, dan fitur lain belum setara.
- **Notes:** tambah, ubah, hapus dan simpan catatan dasar. Fitur catatan asli lainnya belum setara.
- **Weather:** pencarian kota, cuaca saat ini dan prakiraan tujuh hari. Belum diverifikasi seluruh pengaturan dan tampilan asli.
- **World clock:** lokasi, zona waktu, pengurutan dan perencanaan waktu dasar. Belum diverifikasi seluruh perilaku dan tampilan asli.
- **Day progress:** progres hari, minggu, bulan dan tahun dengan jam bangun 07.00, tidur 23.00 dan awal minggu Senin. Pengaturan waktu, agenda, dan tugas selesai pada linimasa belum tersedia.

## Modul yang belum diimplementasikan

AI usage, Bluetooth, Bookmarks, Calendar, Chat, Control, Currency, Dashboard, GitHub, Health, Notifications, Pomodoro, Prayer, Radio, Screen time, Support, Teleprompter dan Translate. Kalender tujuh hari pada Home sudah ada, tetapi bukan modul Calendar lengkap.

Di luar inventaris modul, sudah ada sebagian perilaku Home/notch, pemutaran media Windows, stopwatch, timer, statistik CPU/memori dan installer. Semuanya masih memerlukan perbandingan lebih lanjut. Pengingat OS telah diimplementasikan, tetapi tampilan notifikasi pada instalasi Windows belum diverifikasi. Belum dilakukan audit keamanan; audit menyeluruh direncanakan setelah kesetaraan fitur tercapai.

Pengujian Windows pada commit `d42ad2471935f7ad6fef21e293b820f5c57d9635` lulus: tes Rust, build release, installer, dan pengamatan aplikasi native. Pengujian browser menggunakan backend tiruan dan tidak membuktikan seluruh integrasi Windows. Perubahan setelah commit tersebut harus diuji kembali.

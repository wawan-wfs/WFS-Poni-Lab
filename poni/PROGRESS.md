# Kemajuan Poni Rust

Pembaruan: 22 November 2026. Acuan inventaris adalah 23 modul yang mendaftarkan diri melalui `N.register` dalam aset frontend Poni 1.8.1 yang disediakan pengguna. Modul diperlakukan sama untuk hitungan ini, meskipun ukuran dan tingkat kerumitannya berbeda. Ini bukan daftar lengkap fitur: Home, Shelf, Stats, Dock, pengaturan, integrasi sistem, dan perilaku lainnya berada di luar 23 modul tersebut.

| Status | Jumlah | Persentase dari 23 modul |
| --- | ---: | ---: |
| Sudah dimulai, masih sebagian | 6 | 26,1% |
| Belum diimplementasikan sebagai modul | 17 | 73,9% |
| Terbukti setara penuh | 0 | 0% |

Kategori pertama tidak berarti modul sudah selesai. Belum ada ukuran yang cukup untuk menghitung persentase kesamaan seluruh aplikasi; 26,1% bukan persentase penyelesaian keseluruhan. Modul dinyatakan setara hanya setelah fitur, tampilan, penyimpanan, integrasi, serta perilaku kesalahan dibandingkan dengan aplikasi asli dan diuji.

## Modul yang sudah dimulai

- **Todo:** tambah, ubah, hapus, selesaikan, tanggal jatuh tempo dan pengingat dasar. Pengulangan, subtask, dan fitur lain belum setara.
- **Notes:** tambah, ubah, hapus dan simpan catatan dasar. Fitur catatan asli lainnya belum setara.
- **Weather:** pencarian kota, cuaca saat ini dan prakiraan tujuh hari. Belum diverifikasi seluruh pengaturan dan tampilan asli.
- **World clock:** lokasi, zona waktu, pengurutan dan perencanaan waktu dasar. Belum diverifikasi seluruh perilaku dan tampilan asli.
- **Day progress:** progres hari, minggu, bulan dan tahun dengan pengaturan jam bangun dan tidur yang tersimpan; awal minggu masih Senin. Agenda dan tugas selesai pada linimasa belum tersedia.
- **Calendar:** kalender bulanan, tanggal dan rentang bulan Hijriah dengan koreksi −2 hingga +2 hari, tugas berdasarkan tanggal jatuh tempo, serta tambah/ubah/hapus acara lokal dengan durasi, lokasi, dan pengulangan harian/mingguan/bulanan/tahunan; acara lokal juga muncul di Home. Sinkronisasi Google/Outlook dan pengingat acara belum tersedia. Perilaku pengulangan dan tampilan Hijriah tetap perlu dibandingkan dengan aplikasi asli, termasuk zona waktu dan tanggal yang tidak ada.

## Modul yang belum diimplementasikan

AI usage, Bluetooth, Bookmarks, Chat, Control, Currency, Dashboard, GitHub, Health, Notifications, Pomodoro, Prayer, Radio, Screen time, Support, Teleprompter dan Translate.

Di luar inventaris modul, sudah ada sebagian perilaku Home/notch, pemutaran media Windows, stopwatch, timer, statistik CPU/memori dan installer. Semuanya masih memerlukan perbandingan lebih lanjut. Pengingat OS telah diimplementasikan, tetapi tampilan notifikasi pada instalasi Windows belum diverifikasi. Belum dilakukan audit keamanan; audit menyeluruh direncanakan setelah kesetaraan fitur tercapai.

Pengujian Windows pada commit `d8d6fa94d91b8483454b2d76e25a1b2e7fb567f4` lulus: tes Rust, build release, installer, dan pengamatan aplikasi native. Pengujian browser menggunakan backend tiruan dan tidak membuktikan seluruh integrasi Windows. Perubahan setelah commit tersebut harus diuji kembali.

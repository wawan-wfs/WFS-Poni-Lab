# Verifikasi kesetaraan Poni 1.8.1

Targetnya adalah kesetaraan fungsi, tampilan, dan perilaku dengan Poni 1.8.1 untuk Windows x64. Inventaris modul dan capaian implementasi ada di [PROGRESS.md](PROGRESS.md). **Baseline kesetaraan penuh yang terverifikasi adalah 0 dari 23 modul.** Kesetaraan aplikasi juga memerlukan kelulusan komponen di luar inventaris tersebut.

[Inventaris Settings](SETTINGS-PARITY.md) mendata 32 bagian yang terlihat, wizard Setup, dan 201 kontrol standar yang tersedia dalam build asli. Daftar juga mencatat renderer khusus yang belum dapat dihitung per kontrol dengan metode yang sama.

## Acuan dan bukti yang tersedia

- Acuan eksekusi adalah `poni.exe` dengan SHA-256 `8f3f62d41e11210c5524fda430aa12171bbe6e56b578db7ff5dbfc299e71eb43`. Pengamatan native lama mencakup pemasangan awal, pilihan pengaturan bawaan, dan Home saat kursor diarahkan ke notch. Arsip lokal pengamatan asli ada di `/workspace/work/poni-observation2.zip`. Tiga tangkapan berukuran 1024 × 768 dan metadata mencatat Windows NT 10.0.20348.0.
- Baseline Rust adalah commit `0860f3624ba295de2b9b926e0b07f7deed6e7016`. Artefak pengamatan mencakup `desktop.png` untuk panel terbuka melalui Alt+N serta `chat.png`, `bluetooth.png`, dan `ai-usage.png`. Saat itu runner tidak mendeteksi adaptor Bluetooth. [GitHub Actions 45092220705](https://github.com/wawan-wfs/WFS-Poni-Lab/actions/runs/45092220705)
- Tangkapan `03-hover.png` dari aslinya dan `desktop.png` dari build Rust memperlihatkan dua keadaan Home tanpa media atau kalender aktif. Poni asli memperlihatkan tombol Mirror, sambungan Google/Outlook, kontrol header yang berbeda, serta Buddy di sekitar layar. Kondisi waktu, latar, dan cara membuka panel berbeda. Pasangan ini menunjukkan selisih yang terlihat dan belum dapat dipakai untuk pengukuran piksel.
- Tangkapan `reference-observation/03-hover.png` dan `native-observation/home-hover.png` dari pengujian 45182552367 dikumpulkan pada desktop Windows Server yang sama, 1024 × 768, en-US dan UTC, dengan profil terpisah. Hash aplikasi referensi cocok. Pada keadaan tanpa media, panel Rust masih berbeda dalam susunan navigasi, kontrol media, kalender, Mirror dan Buddy. Pengamatan ini menetapkan status Home **berbeda**. Jam dan latar bervariasi, sehingga perbandingannya bersifat visual. [Tangkapan kedua aplikasi](https://github.com/wawan-wfs/WFS-Poni-Lab/actions/runs/45182552367/artifacts/14822616986)
- Commit `f411d0689509b25bc3820547a0b653f063ca9ae4` lulus tes Rust dan browser untuk pengulangan dan langkah Todo, penyimpanan otomatis dan kartu Notes, perencana World Clock, serta konversi Currency. Kesetaraan modul secara penuh masih memerlukan skenario tambahan pada kedua aplikasi. [Hasil pengujian](https://github.com/wawan-wfs/WFS-Poni-Lab/actions/runs/45182552367)

## Cara mencatat hasil

1. Jalankan kedua build pada Windows dan WebView2 dengan versi, bahasa, tema, zona waktu, DPI, resolusi, dan data uji yang sama. Pakai profil terpisah. Ulangi dengan profil baru, data terisi, dan sesudah menutup serta membuka ulang aplikasi.
2. Catat konfigurasi, tindakan, hasil asli, hasil Rust, dan bukti. Ambil tangkapan layar dari posisi dan kondisi yang sama. Saat membandingkan gambar, tandai konten dinamis seperti jam atau judul media. Periksa ukuran, tata letak, teks, ikon, fokus, tema, animasi dan pengoperasian dengan keyboard.
3. Uji jalur utama, keadaan kosong dan gagal, pengaturan terkait, serta penyimpanan saat mulai ulang. Untuk perangkat atau layanan, catat hasil nyata atau tandai prasyarat yang belum tersedia. Tes browser dengan perintah tiruan membuktikan alur antarmuka. Pengujian layanan dan perangkat dilakukan terpisah.
4. Tandai masing-masing hasil sebagai **setara**, **berbeda**, **belum diuji**, atau **terhalang**. Sebuah modul dihitung setara setelah semua skenario relevan lulus dengan pasangan bukti. Persentase modul adalah jumlah modul setara dibagi 23. Item terhalang tetap berada dalam penyebut. Aplikasi baru dinyatakan setara penuh setelah seluruh modul dan kelompok tambahan lulus.

## Daftar uji modul

Skenario di bawah dirangkum dari aset asli di `poni-frontend/modules` dan laporan implementasi Rust. Setiap baris memerlukan verifikasi berdampingan.

| Modul | Jalankan dan bandingkan | Selisih atau prasyarat yang diketahui |
| --- | --- | --- |
| AI Usage | Tampilkan batas Claude dan Codex, laju, waktu reset, penyedia yang terakhir dibuka, lalu segarkan akun yang kedaluwarsa | Rust mengimpor snapshot manual. Pembaruan langsung perlu akun uji dan CLI yang sesuai |
| Bluetooth | Tampilkan perangkat klasik dan LE, baterai, sambung/putuskan audio, aktifkan radio, gabung Wi-Fi, jalankan uji kecepatan saat diminta | Rust menampilkan perangkat dan status yang diberikan Windows. Kontrol langsung, baterai, Wi-Fi dan uji kecepatan perlu dituntaskan dan diuji pada perangkat |
| Bookmarks | Tambah dari ketikan dan clipboard, muat judul dan favicon, pindah kategori, cari, buka, ubah dan hapus | Saran clipboard dan metadata situs belum tersedia |
| Calendar | Buka bulan, periksa Hijriah dan penanda tugas, tambah/edit/hapus acara dan uji pengulangan pada zona waktu berbeda, lalu uji jadwal Google/Outlook, pengingat, dan detail acara | Settings dan pengingat lokal tersedia. Verifikasi toast Windows, kesamaan pengulangan, dan langganan kalender masih diperlukan |
| Chat | Buka chat baru/riwayat, ganti penyedia, kirim teks dan lampiran, periksa Markdown, memori, Buddy dan hasil tindakan yang aman | Rust mengandalkan Ollama lokal dan teks. Inferensi nyata serta penyedia lain, lampiran dan integrasi perlu diuji |
| Control | Ubah volume, mikrofon, keluaran audio, kecerahan, Wi-Fi/Bluetooth, lalu uji Keep Awake dan ketiadaan perangkat | Rust menyediakan kontrol audio dasar, Keep Awake dan tautan Settings. Radio, kecerahan dan pemilihan perangkat audio perlu dibandingkan |
| Currency | Cocokkan pasangan bawaan sesuai wilayah, konversi saat mengetik, tukar pasangan, favorit, format angka lokal, dan kurs terakhir saat offline | Rust memakai ECB dan ExchangeRate-API. Bandingkan kurs pada hari yang sama, kasus penyedia gagal, menu pilihan, serta format dan tampilan |
| Dashboard | Atur empat slot dan coba pilihan widget, kontrol dan peluncur, perubahan konfigurasi, lalu mulai ulang | Pilihan widget, peluncur dan kontrol cepat belum lengkap |
| Day Progress | Uji jam mulai/selesai, jadwal lewat tengah malam, acara dan tugas, kemajuan minggu/bulan/tahun serta awal minggu berbeda | Awal minggu kini mengikuti preferensi Calendar. Bandingkan format dan perilakunya dengan Windows asli |
| GitHub | Siapkan akun uji, lihat permintaan review dan PR sendiri termasuk draft, segarkan, buka PR, lalu uji izin salah | Rust memakai pencarian publik. Jalur terautentikasi dan akses langsung perlu diverifikasi |
| Health | Uji target dan reset harian, pengingat minum/gerak/mata, peregangan, napas, dan overlay jeda mata | Target Rust tetap, jeda mata di dalam panel, pengingat terjadwal belum ada |
| Notes | Ketik judul dan isi, tunggu penyimpanan otomatis, pilih kembali sesudah restart, lalu buat dan ulas kartu `pertanyaan :: jawaban` | Uji perilaku catatan dan kartu, termasuk pintasan di editor dan pemulihan saat keluar |
| Notifications | Picu toast uji, tahan saat Do Not Disturb, filter per aplikasi dan hari, buka detail, tandai baca, hapus, dan atur pop-up senyap | Rust mencatat pengingat Poni. Integrasi notifikasi aplikasi lain, Do Not Disturb, dan aktivasi toast perlu Windows interaktif |
| Pomodoro | Atur siklus dan durasi, jeda/lewati/reset, gunakan timer dan stopwatch dengan lap, tutup lalu buka ulang, dan periksa audio fokus serta aktivitas notch | Settings mengatur sesi, preset Timer, durasi terakhir, jeda otomatis setelah Timer, dan audio fokus. Bandingkan keluaran audio dan toast pada instalasi Windows. Aktivitas pada notch tertutup dan sakelar bunyi penyelesaian belum tersedia |
| Prayer | Uji kota/daerah dan metode, Hijriah, imsak/terbit, kiblat, hitung mundur dan azan sesuai jadwal | Rust memakai AlAdhan. Jadwal resmi per kabupaten, azan dan pengingat latar belum tersedia |
| Radio | Cari nama/genre dan negara, simpan favorit, putar/berhenti, ubah volume, buka riwayat dan putar saat panel ditutup | Perlu stream uji yang tersedia, hasil metadata lagu dan perilaku notch tertutup |
| Screen Time | Ukur dua aplikasi aktif dan interval menganggur dengan ambang berbeda, kecualikan satu aplikasi, serta cocokkan ringkasan hari/jam, kategori, ikon dan penghapusan data | Settings mengatur pelacakan, ambang idle, dan pengecualian. Pengambilan sampel aplikasi aktif dan hasil pencatatan perlu dibandingkan dalam sesi Windows interaktif. Kategori dan ikon belum tersedia |
| Support | Buka dari ikon header, periksa QRIS, PayPal, GitHub dan panel ucapan terima kasih. Berhenti sebelum transaksi | Build publik Rust memakai tautan. Publikasi QRIS belum disetujui secara khusus |
| Teleprompter | Ketik dan tarik file TXT, atur kecepatan/ukuran, mulai hitung mundur, jeda serta pindah teks dengan hotkey saat aplikasi lain fokus, uji mode minim dan perekaman | Strip terpisah, hotkey global dan pengecualian rekaman belum tersedia |
| Todo | Tambah tugas melalui teks dan tanggal, ubah langkah dan tautan catatan, ulangi menurut hari, centang, hapus/pulihkan, tunggu pengingat saat notch ditutup | Settings mengatur penyelesaian saat terlambat, snooze, dan retensi Trash. Parser lokal Indonesia dan Inggris mengisi tenggat dan pengulangan. Tugas dapat menautkan catatan. Tindakan daya dan kecocokan visual belum lengkap |
| Translate | Ganti pasangan dan penyedia, termasuk bahasa Indonesia/Jawa/Sunda, uji salin, offline, masukan panjang dan kesalahan layanan | Rust memakai MyMemory. Penyedia LLM dan pilihan bahasa perlu dibandingkan |
| Weather | Uji kota dan lokasi tetap, waktu setempat, cuaca kini/per jam/7 hari, tampilan langit dan keadaan offline | Data harian sebagian tersedia. Tampilan langit dan strip per jam perlu dibandingkan |
| World Clock | Tambah, ubah nama, urutkan dan hapus zona, geser waktu untuk semua kota, kembali ke Now, uji pergantian tanggal dan DST | Periksa kemiripan pencarian kota, pita siang/malam, rencana waktu dan integrasi Dashboard/Settings |

## Komponen di luar hitungan modul

| Area | Jalankan dan bandingkan | Selisih atau prasyarat yang diketahui |
| --- | --- | --- |
| Home dan notch | Buka lewat tetikus dan Alt+N, berpindah tab, cek fokus, auto-hide, hit testing, aktivitas saat tertutup, pemutar, kalender, Mirror dan Buddy | Visual baseline lama menunjukkan selisih kontrol dan tata letak. Perlu perangkat audio/kamera, beberapa DPI dan monitor |
| Dock dan Shelf | Pin/urutkan/jalankan aplikasi, tampilkan aplikasi aktif dan beberapa jendela, uji pembesaran ikon, monitor kedua, serta tarik berkas ke Shelf lalu keluarkan kembali | Dock dan Shelf belum setara. Uji di desktop interaktif dengan berkas uji |
| Stats dan HUD | Cocokkan metrik CPU/memori serta opsi perangkat pada sumber data yang sama. Picu volume dan kecerahan dari keyboard, lalu periksa indikator | Rust menampilkan statistik dasar. Perlu perangkat yang mendukung metrik serta tombol media/kecerahan |
| Settings, onboarding dan instalasi | Bandingkan wizard awal dan pengaturan bawaan, kategori/fitur, pencarian, bahasa, tema, penempatan notch, modul aktif/urutan, tray, jalankan saat masuk Windows, penghapusan dan pembaruan | Perlu akun Windows yang bersih dan profil terisi. Build installer yang lulus belum membuktikan alur pemasangan, migrasi dan penghapusan |

Laporan ini mencatat pengujian kesetaraan produk. Audit keamanan dilakukan setelah target kesetaraan fitur sebagaimana diminta.

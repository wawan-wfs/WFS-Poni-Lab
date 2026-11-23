# Kemajuan Poni Rust

Inventaris mencakup 23 modul yang terdaftar melalui `N.register` di aset Poni 1.8.1. Setiap modul berbobot sama. Tombol atau tampilan kosong tidak dihitung. Home, Shelf, Stats, Dock, serta sejumlah pengaturan dan integrasi sistem berada di luar inventaris ini.

| Status | Jumlah | Persentase dari 23 modul |
| --- | ---: | ---: |
| Memiliki fungsi yang bisa dipakai, implementasi masih sebagian | 23 | 100% |
| Belum diimplementasikan sebagai modul | 0 | 0% |
| Terbukti setara penuh | 0 | 0% |

Angka 100% mengukur cakupan inventaris modul. Kesetaraan penuh menunggu perbandingan fitur, tampilan, penyimpanan, integrasi, dan penanganan kesalahan dengan aplikasi asli.

[Daftar verifikasi kesetaraan](PARITY.md) memuat skenario dan bukti yang diperlukan untuk setiap modul serta fitur di luar inventaris.
[Inventaris Settings](SETTINGS-PARITY.md) memuat tampilan General yang dibuka di Poni 1.8.1, serta daftar pengaturan standar dan khusus.

## Modul yang sudah dimulai

- **Todo:** tugas dapat memiliki daftar langkah, tanggal jatuh tempo, dan jadwal berulang pada hari serta waktu pilihan. Menyelesaikan tugas berulang menyimpan riwayat dan membuat tugas berikutnya dengan langkah yang belum dicentang. Pemrosesan bahasa alami, tempat sampah, dan pilihan tindak lanjut ketika tugas terlambat belum tersedia.
- **Notes:** daftar catatan dengan judul dari baris pertama, pencarian, penyimpanan otomatis, serta mode Cards dengan dek, pengacakan, pengulangan, dan skor. Tautan dari Todo, pengeditan melalui AI, dan beberapa pintasan serta animasi belum tersedia.
- **Weather:** pencarian kota, cuaca saat ini dan prakiraan tujuh hari. Belum diverifikasi seluruh pengaturan dan tampilan asli.
- **World clock:** pencarian kota dan zona waktu, pengurutan, pita jam siang dan malam, serta perencanaan per 15 menit dengan keyboard atau pointer. Katalog kota serta pengaturan format jam dan penempatan di notch belum sepenuhnya setara.
- **Day progress:** progres hari, minggu, bulan dan tahun, pengaturan waktu bangun dan tidur, serta linimasa acara lokal dan tugas yang sudah selesai. Awal minggu mengikuti preferensi Calendar di Settings.
- **Calendar:** kalender bulanan, tanggal dan rentang bulan Hijriah dengan koreksi −2 hingga +2 hari, tugas berdasarkan tanggal jatuh tempo, serta acara lokal sekali atau berulang. Settings mengatur kalender Home, awal minggu, dan pengingat sebelum acara. Impor file ICS mendukung acara dengan jam mulai dan akhir. Langganan Google/Outlook, pengulangan dan acara seharian dari ICS, serta pengujian toast Windows masih diperlukan.
- **Bookmarks** menyimpan tautan serta kategori, mendukung pencarian, pengeditan, penyalinan, dan membuka tautan di browser. Saran dari clipboard dan pengambilan favicon masih belum tersedia.
- **Pomodoro** memiliki sesi fokus, jeda pendek dan panjang, pengaturan durasi, riwayat harian, dan timer yang tetap berjalan saat panel ditutup. Audio fokus dan dekorasi timer pada notch tertutup belum tersedia. Pengiriman notifikasi perlu diverifikasi pada instalasi Windows.
- **Teleprompter** menyimpan skrip, mengimpor TXT, dan menggulir teks dengan pengaturan kecepatan, ukuran, serta hitung mundur. Panel baca terpisah, pintasan global, dan pengecualian perekaman layar masih belum tersedia.
- **Dashboard** menyimpan empat slot pilihan, dengan widget jam, progres hari, agenda, tugas, jam dunia, sistem, cuaca, media, timer, Pomodoro, dan kutipan. Kontrol cepat Windows, peluncur, dan pilihan widget Poni lainnya masih belum tersedia.
- **Health** menyimpan hitungan air, peregangan, pernapasan, dan hari aktif. Istirahat mata berjalan di dalam panel, dengan target tetap dan tanpa jadwal pengingat.
- **Currency** memakai kurs ECB dengan ExchangeRate-API sebagai cadangan, memformat angka sesuai wilayah Windows, menerima singkatan seperti `50rb`, dan menyimpan pasangan favorit serta kurs lokal. Tampilan, lokalisasi, pengaturan lintas layar, dan perilaku percobaan ulang belum sepenuhnya diverifikasi.
- **Control** menyediakan Keep Awake, volume keluaran, mute keluaran dan mikrofon, serta akses ke halaman Pengaturan Windows. Pengelolaan Wi-Fi, Bluetooth, dan pengaturan tampilan dari dalam panel masih belum tersedia.
- **GitHub** menampilkan PR publik yang dibuat pengguna dan permintaan review publik. PR privat memerlukan integrasi akun. Akses langsung ke API GitHub masih perlu diuji pada Windows.
- **Notifications** menyimpan riwayat pengingat Todo, Timer dan Pomodoro, dengan filter, penandaan dibaca, dan penghapusan. Pembacaan notifikasi aplikasi Windows lain belum tersedia.
- **Prayer** memakai jadwal AlAdhan untuk kota dan metode yang dipilih, serta menampilkan waktu salat berikutnya dan arah kiblat. Jadwal resmi per kabupaten, azan dan pengingat latar belum tersedia.
- **Radio** mencari stasiun lewat Radio Browser, memutar stream audio HTTPS, dan menyimpan stasiun favorit dan riwayat. Pemutaran bergantung pada ketersediaan dan format stream masing-masing stasiun.
- **Screen Time** dapat mencatat durasi aplikasi aktif setelah diaktifkan pengguna, mengabaikan waktu menganggur, dan menampilkan ringkasan hari ini serta tujuh hari. Pencatatan mengambil sampel berkala dan hanya menyimpan nama aplikasi, tanpa judul jendela. Kategori aplikasi dan ikon belum tersedia.
- **Support** membuka tautan PayPal dan GitHub resmi untuk Poni asli. Panel publik belum menyertakan gambar QRIS.
- **Translate** mengirim teks saat tombol Translate ditekan dan menggunakan MyMemory. Arah terjemahan dipilih manual, dengan batas 500 byte UTF-8 dari penyedia. Penyedia LLM milik aplikasi asli belum diintegrasikan.
- **AI Usage** mengimpor snapshot penggunaan Codex atau Claude yang dipilih pengguna, lalu menampilkan persentase, waktu reset, dan laju penggunaan jika waktunya tersedia. Sinkronisasi langsung dengan akun dan pembaruan otomatis belum tersedia.
- **Bluetooth** menampilkan perangkat klasik yang dipasangkan atau diingat Windows, serta perangkat Bluetooth LE yang sudah dipasangkan. Panel menampilkan status koneksi jika tersedia dan membuka Pengaturan Bluetooth Windows. Status baterai dan kontrol koneksi langsung belum tersedia. Pengujian perangkat fisik masih diperlukan.
- **Chat** mengirim percakapan teks ke Ollama lokal dan menyimpan riwayat per percakapan. Pemakaian memerlukan model Ollama yang terpasang. Penyedia cloud, lampiran, dan tindakan aplikasi dari Chat belum tersedia.

Di luar inventaris modul, Rust menyediakan sebagian perilaku Home/notch, Mirror di Home, jendela Settings terpisah dengan pengaturan dasar yang tersimpan, pemutaran media Windows, stopwatch, timer, statistik CPU/memori dan installer. Poni asli masih memiliki lebih banyak pengaturan, termasuk wizard Setup. Mirror perlu diuji dengan kamera fisik Windows. Tampilan pengingat OS pada instalasi Windows juga perlu diuji. Audit keamanan menyeluruh masih menunggu kesetaraan fitur.

Pengujian browser menggunakan backend tiruan untuk memeriksa alur modul. Runner Windows menjalankan tes Rust, membuat build dan installer, serta memeriksa pembukaan panel melalui Alt+N dan perubahan tinggi panel saat berpindah modul. Fitur yang memerlukan perangkat, akses akun, atau layanan eksternal juga memerlukan pengujian pada kondisi tersebut.

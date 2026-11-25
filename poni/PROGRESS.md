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

Shelf kini menyimpan referensi file dan folder, tautan, dan teks. File dapat dipilih atau diseret masuk, lalu dibuka, ditampilkan di Explorer, disalin jalurnya, atau diseret keluar. Drop Actions menampilkan ubin Shelf, ZIP, Extract, dan Copy. Clipboard history dapat diaktifkan terpisah, dengan item yang dipin, batas salinan terbaru, pratinjau gambar, dan penanda privat Windows yang dilewati.

## Modul yang sudah dimulai

- **Todo:** tugas dapat memiliki daftar langkah, tenggat, jadwal berulang, dan aturan penyelesaian saat terlambat. Settings mengatur aturan bawaan, durasi snooze, dan retensi Trash. Tab Todo memisahkan Active, Done, dan Trash. Pengingat pada notch tertutup bisa diselesaikan atau ditunda tanpa membuka panel. Teks Indonesia dan Inggris dapat mengisi tenggat atau pengulangan secara lokal dan menawarkan pratinjau. Detail tugas bisa menautkan dan membuka catatan. Tindakan daya belum tersedia.
- **Notes:** daftar catatan dengan judul dari baris pertama, pencarian, penyimpanan otomatis, serta mode Cards dengan dek, pengacakan, pengulangan, dan skor. Tautan dari Todo langsung membuka catatan yang dipilih. Pengeditan melalui AI serta beberapa pintasan dan animasi belum tersedia.
- **Weather:** pencarian kota, cuaca saat ini dan prakiraan tujuh hari. Belum diverifikasi seluruh pengaturan dan tampilan asli.
- **World clock:** pencarian kota dan zona waktu, pengurutan, pita jam siang dan malam, serta perencanaan per 15 menit dengan keyboard atau pointer. Katalog kota serta pengaturan format jam dan penempatan di notch belum sepenuhnya setara.
- **Day progress:** progres hari, minggu, bulan dan tahun, dengan pengaturan waktu bangun dan tidur yang tersinkron antara tab dan Settings. Pengingat tidur muncul selama 15 detik, bisa ditunda atau ditutup, dan memiliki kontrol chime. Awal minggu mengikuti preferensi Calendar. Suara dan perilaku setiap mode Do not disturb Windows masih perlu diuji.
- **Calendar:** kalender bulanan, tanggal dan rentang bulan Hijriah dengan koreksi −2 hingga +2 hari, tugas berdasarkan tanggal jatuh tempo, serta acara lokal sekali atau berulang. Settings mengatur kalender Home, awal minggu, dan pengingat sebelum acara. Impor file ICS mendukung acara dengan jam mulai dan akhir. Langganan Google/Outlook, pengulangan dan acara seharian dari ICS, serta pengujian toast Windows masih diperlukan.
- **Bookmarks** menyimpan tautan serta kategori, mendukung pencarian, pengeditan, penyalinan, dan membuka tautan di browser. Saran dari clipboard dan pengambilan favicon masih belum tersedia.
- **Pomodoro** memiliki sesi fokus, jeda pendek dan panjang, riwayat harian, dan pengaturan durasi serta pergantian sesi di Settings dan tab Pomodoro. Audio fokus punya delapan pilihan yang dihasilkan lokal, volume, pratinjau, dan opsi tetap berbunyi selama jeda. Timer berjalan setelah panel ditutup, menerima hingga delapan preset, dapat mengingat durasi terakhir, dan dapat memulai jeda pendek setelah hitung mundur berakhir. Sakelar bunyi penyelesaian berlaku untuk Pomodoro dan Timer. Notch tertutup dapat menampilkan hitung mundur, stopwatch, serta **+5 min** dan **Done** ketika Timer selesai. Kesamaan visual dan suara speaker masih perlu dibandingkan.
- **Teleprompter** menyimpan skrip, mengimpor TXT, dan menggulir teks dengan pengaturan kecepatan, ukuran, serta hitung mundur. Panel baca terpisah, pintasan global, dan pengecualian perekaman layar masih belum tersedia.
- **Dashboard** menyimpan empat slot pilihan, dengan widget jam, progres hari, agenda, tugas, jam dunia, sistem, cuaca, media, timer, Pomodoro, dan kutipan. Kontrol cepat Windows, peluncur, dan pilihan widget Poni lainnya masih belum tersedia.
- **Health** menyimpan hitungan air, peregangan, pernapasan, dan hari aktif. Settings mengatur ketiga target serta pengingat jeda, air dan mata. Rust membaca keaktifan Windows untuk menghitung jeda setelah lima menit idle atau dua menit terkunci. Jeda mata manual dan terjadwal memakai overlay Windows dengan hitung mundur dan Esc.
- **Currency** memakai kurs ECB dengan ExchangeRate-API sebagai cadangan, memformat angka sesuai wilayah Windows, menerima singkatan seperti `50rb`, dan menyimpan pasangan favorit serta kurs lokal. Tampilan, lokalisasi, pengaturan lintas layar, dan perilaku percobaan ulang belum sepenuhnya diverifikasi.
- **Control** menyediakan Keep Awake, volume keluaran, mute keluaran dan mikrofon, serta akses ke halaman Pengaturan Windows. Pengelolaan Wi-Fi, Bluetooth, dan pengaturan tampilan dari dalam panel masih belum tersedia.
- **GitHub** menampilkan PR publik yang dibuat pengguna dan permintaan review publik. PR privat memerlukan integrasi akun. Akses langsung ke API GitHub masih perlu diuji pada Windows.
- **Notifications** menyimpan riwayat pengingat Todo, Timer dan Pomodoro, dengan filter, penandaan dibaca, dan penghapusan. Pembacaan notifikasi aplikasi Windows lain belum tersedia.
- **Prayer** memakai jadwal AlAdhan untuk kota dan metode yang dipilih, serta menampilkan waktu salat berikutnya dan arah kiblat. Jadwal resmi per kabupaten, azan dan pengingat latar belum tersedia.
- **Radio** mencari stasiun lewat Radio Browser, memutar stream audio HTTPS, dan menyimpan stasiun favorit dan riwayat. Pemutaran bergantung pada ketersediaan dan format stream masing-masing stasiun.
- **Screen Time** mencatat durasi aplikasi aktif setelah diaktifkan pengguna dan menampilkan ringkasan hari ini serta tujuh hari. Settings menyediakan sakelar yang sama dengan tab Screen Time, ambang idle 30–600 detik, dan daftar executable yang diabaikan untuk pencatatan berikutnya. Pencatatan mengambil sampel berkala dan menyimpan nama aplikasi selama 35 hari. Kategori aplikasi dan ikon belum tersedia.
- **Support** membuka tautan PayPal dan GitHub resmi untuk Poni asli. Panel publik belum menyertakan gambar QRIS.
- **Translate** mengirim teks saat tombol Translate ditekan dan menggunakan MyMemory. Arah terjemahan dipilih manual, dengan batas 500 byte UTF-8 dari penyedia. Penyedia LLM milik aplikasi asli belum diintegrasikan.
- **AI Usage** mengimpor snapshot penggunaan Codex atau Claude yang dipilih pengguna, lalu menampilkan persentase, waktu reset, dan laju penggunaan jika waktunya tersedia. Sinkronisasi langsung dengan akun dan pembaruan otomatis belum tersedia.
- **Bluetooth** menampilkan perangkat klasik yang dipasangkan atau diingat Windows, serta perangkat Bluetooth LE yang sudah dipasangkan. Panel menampilkan status koneksi jika tersedia dan membuka Pengaturan Bluetooth Windows. Status baterai dan kontrol koneksi langsung belum tersedia. Pengujian perangkat fisik masih diperlukan.
- **Chat** mengirim percakapan teks ke Ollama lokal dan menyimpan riwayat per percakapan. Pemakaian memerlukan model Ollama yang terpasang. Penyedia cloud, lampiran, dan tindakan aplikasi dari Chat belum tersedia.

Di luar inventaris modul, Rust menyediakan sebagian perilaku Home/notch, Mirror di Home, jendela Settings terpisah dengan pengaturan dasar yang tersimpan, pemutaran media Windows, stopwatch, timer, statistik CPU/memori dan installer. Poni asli masih memiliki lebih banyak pengaturan, termasuk wizard Setup. Mirror perlu diuji dengan kamera fisik Windows. Tampilan pengingat OS pada instalasi Windows juga perlu diuji. Audit keamanan menyeluruh masih menunggu kesetaraan fitur.

Settings General mengatur ukuran panel sesuai jenis modul, jarak vertikal, posisi horizontal, opasitas tertutup, arah tata letak, dan visibilitas dalam tangkapan layar Windows. Build memakai ukuran terbuka asli 680 × 196 px dengan tinggi 268 px untuk modul tinggi. Pengaturan posisi dapat diubah melalui slider dan tiga preset. Preview saat menyeret slider dan pemilihan monitor masih belum tersedia.

Warna hangat malam hari berlaku pada latar notch dengan transisi 45 menit dan pratinjau intensitas. Jadwal mengikuti kota Prayer Times atau Weather. Tanpa jadwal kota, build memakai 18.00–06.00 waktu setempat.

Launch at login memakai entri startup Windows untuk pengguna yang menjalankan Poni Rebuild. Pengguna dapat mengaktifkan dan menghapus entri itu dari General.

Pengujian browser menggunakan backend tiruan untuk memeriksa alur modul. Runner Windows menjalankan tes Rust, membuat build dan installer, serta memeriksa pembukaan panel melalui Alt+N dan perubahan tinggi panel saat berpindah modul. Fitur yang memerlukan perangkat, akses akun, atau layanan eksternal juga memerlukan pengujian pada kondisi tersebut.

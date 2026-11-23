# Kemajuan Poni Rust

Inventaris mencakup 23 modul yang terdaftar melalui `N.register` di aset Poni 1.8.1. Setiap modul berbobot sama. Tombol atau tampilan kosong tidak dihitung. Home, Shelf, Stats, Dock, serta sejumlah pengaturan dan integrasi sistem berada di luar inventaris ini.

| Status | Jumlah | Persentase dari 23 modul |
| --- | ---: | ---: |
| Memiliki fungsi yang bisa dipakai, implementasi masih sebagian | 20 | 87,0% |
| Belum diimplementasikan sebagai modul | 3 | 13,0% |
| Terbukti setara penuh | 0 | 0% |

Angka 87,0% mengukur cakupan modul yang sudah mulai berfungsi. Kesetaraan penuh menunggu perbandingan fitur, tampilan, penyimpanan, integrasi, dan penanganan kesalahan dengan aplikasi asli.

## Modul yang sudah dimulai

- **Todo:** tambah, ubah, hapus, selesaikan, tanggal jatuh tempo dan pengingat dasar. Pengulangan, subtask, dan fitur lain belum setara.
- **Notes:** tambah, ubah, hapus dan simpan catatan dasar. Fitur catatan asli lainnya belum setara.
- **Weather:** pencarian kota, cuaca saat ini dan prakiraan tujuh hari. Belum diverifikasi seluruh pengaturan dan tampilan asli.
- **World clock:** lokasi, zona waktu, pengurutan dan perencanaan waktu dasar. Belum diverifikasi seluruh perilaku dan tampilan asli.
- **Day progress:** progres hari, minggu, bulan dan tahun dengan pengaturan jam bangun dan tidur yang tersimpan; awal minggu masih Senin. Agenda dan tugas selesai pada linimasa belum tersedia.
- **Calendar:** kalender bulanan, tanggal dan rentang bulan Hijriah dengan koreksi −2 hingga +2 hari, tugas berdasarkan tanggal jatuh tempo, serta tambah/ubah/hapus acara lokal dengan durasi, lokasi, dan pengulangan harian/mingguan/bulanan/tahunan; acara lokal juga muncul di Home. Sinkronisasi Google/Outlook dan pengingat acara belum tersedia. Perilaku pengulangan dan tampilan Hijriah tetap perlu dibandingkan dengan aplikasi asli, termasuk zona waktu dan tanggal yang tidak ada.
- **Bookmarks** menyimpan tautan serta kategori, mendukung pencarian, pengeditan, penyalinan, dan membuka tautan di browser. Saran dari clipboard dan pengambilan favicon masih belum tersedia.
- **Pomodoro** memiliki sesi fokus, jeda pendek dan panjang, pengaturan durasi, riwayat harian, dan timer yang tetap berjalan saat panel ditutup. Audio fokus dan dekorasi timer pada notch tertutup belum tersedia. Pengiriman notifikasi perlu diverifikasi pada instalasi Windows.
- **Teleprompter** menyimpan skrip, mengimpor TXT, dan menggulir teks dengan pengaturan kecepatan, ukuran, serta hitung mundur. Panel baca terpisah, pintasan global, dan pengecualian perekaman layar masih belum tersedia.
- **Dashboard** menyimpan empat slot pilihan, dengan widget jam, progres hari, agenda, tugas, jam dunia, sistem, cuaca, media, timer, Pomodoro, dan kutipan. Kontrol cepat Windows, peluncur, dan pilihan widget Poni lainnya masih belum tersedia.
- **Health** menyimpan hitungan air, peregangan, pernapasan, dan hari aktif. Istirahat mata berjalan di dalam panel, dengan target tetap dan tanpa jadwal pengingat.
- **Currency** mengonversi mata uang, menyimpan pasangan favorit, dan memakai kurs referensi Frankfurter dengan salinan kurs lokal. Jangkauan mata uang dan jadwal pembaruan mengikuti penyedia tersebut.
- **Control** menyediakan Keep Awake, volume keluaran, mute keluaran dan mikrofon, serta akses ke halaman Pengaturan Windows. Pengelolaan Wi-Fi, Bluetooth, dan pengaturan tampilan dari dalam panel masih belum tersedia.
- **GitHub** menampilkan PR publik yang dibuat pengguna dan permintaan review publik. PR privat memerlukan integrasi akun. Akses langsung ke API GitHub masih perlu diuji pada Windows.
- **Notifications** menyimpan riwayat pengingat Todo, Timer dan Pomodoro, dengan filter, penandaan dibaca, dan penghapusan. Pembacaan notifikasi aplikasi Windows lain belum tersedia.
- **Prayer** memakai jadwal AlAdhan untuk kota dan metode yang dipilih, serta menampilkan waktu salat berikutnya dan arah kiblat. Jadwal resmi per kabupaten, azan dan pengingat latar belum tersedia.
- **Radio** mencari stasiun lewat Radio Browser, memutar stream audio HTTPS, dan menyimpan stasiun favorit dan riwayat. Pemutaran bergantung pada ketersediaan dan format stream masing-masing stasiun.
- **Screen Time** dapat mencatat durasi aplikasi aktif setelah diaktifkan pengguna, mengabaikan waktu menganggur, dan menampilkan ringkasan hari ini serta tujuh hari. Pencatatan mengambil sampel berkala dan hanya menyimpan nama aplikasi, tanpa judul jendela. Kategori aplikasi dan ikon belum tersedia.
- **Support** membuka tautan PayPal dan GitHub resmi untuk Poni asli. Panel publik belum menyertakan gambar QRIS.
- **Translate** mengirim teks saat tombol Translate ditekan dan menggunakan MyMemory. Arah terjemahan dipilih manual, dengan batas 500 byte UTF-8 dari penyedia. Penyedia LLM milik aplikasi asli belum diintegrasikan.

## Modul yang belum diimplementasikan

AI usage, Bluetooth, dan Chat.

Di luar inventaris modul, sudah ada sebagian perilaku Home/notch, pemutaran media Windows, stopwatch, timer, statistik CPU/memori dan installer. Semuanya masih memerlukan perbandingan lebih lanjut. Pengingat OS telah diimplementasikan, tetapi tampilan notifikasi pada instalasi Windows belum diverifikasi. Belum dilakukan audit keamanan; audit menyeluruh direncanakan setelah kesetaraan fitur tercapai.

Pengujian browser menggunakan backend tiruan untuk memeriksa alur modul. Runner Windows menjalankan tes Rust, membuat build dan installer, serta memeriksa pembukaan panel melalui Alt+N dan perubahan tinggi panel saat berpindah modul. Fitur yang memerlukan perangkat, akses akun, atau layanan eksternal juga memerlukan pengujian pada kondisi tersebut.

# Inventaris Settings Poni 1.8.1

Acuan adalah aset `settings.js` dan `settings.html` yang dipulihkan dari Poni Windows 1.8.1. Perbandingan Rust memakai baseline `14a9cb1d69afd2230034c9b29620e6b8dd31a529`, sebelum putaran implementasi Settings. Inventaris ini membaca deklarasi dan handler, sehingga perbedaan visibilitas perangkat atau kondisi akun masih perlu diamati pada aplikasi asli. Status penuh tetap mengikuti [verifikasi kesetaraan](PARITY.md).

## Hitungan dan cakupan

- Terdapat **33 bagian**. **32** berada di sidebar dan **1** adalah wizard Setup tersembunyi. Sidebar mengelompokkan Poni, Features, Poni & system, Integrations, lalu About tanpa judul grup. Settings terbuka di General bila tidak ada bagian tujuan. Kotak Search mencari label/deskripsi dan kata kunci, termasuk sebagian kosakata Indonesia.
- Terdapat **202 deklarasi kontrol standar**. Angkanya berasal dari 185 baris pada `const SECTIONS` dan 17 baris yang diteruskan ke `renderRows` dari halaman custom (3 pada Calendar dan 14 pada HUD). `TODO_SYNC_READY = false` mengeluarkan satu pemilih Todo Sync, jadi katalog executable ini memiliki **201 kandidat kontrol standar** sebelum kondisi OS, perangkat, skenario, dan opsi terkait diperiksa.
- Kode juga mempunyai **36 baris renderer kustom** di `SECTIONS`, termasuk baris Todo Sync yang tidak aktif dan beberapa panel informasi yang tidak dapat diubah. Ada **13 bagian** yang seluruhnya digambar oleh renderer, termasuk Setup. Angka tersebut menghitung renderer, bukan jumlah tombol; renderer yang membuat beberapa kontrol atau mengulang daftar perangkat tidak boleh dianggap hanya satu fitur. Rincian fungsi renderer ada di bawah.
- Hitungan kontrol standar mencakup tujuh jenis yang menerima masukan di `rowHtml`: toggle, range, select, number, text, time, list. Setiap key dihitung satu kali per deklarasi. Heading, lead, status, pilihan dalam dropdown, hasil pencarian, baris list berulang, dan dialog konfirmasi tidak dihitung. Lampiran memuat setiap key agar hitungan bisa diperiksa ulang.
- Baseline Rust belum memiliki jendela Settings terpadu. Beberapa fungsi memiliki kontrol di tab aplikasi masing-masing, tetapi belum dinyatakan setara dengan kontrol Settings asli. Kolom status menyebut padanan yang tersedia, kekurangan, atau kondisi tersembunyi.

## Bukti Windows dan perubahan sejak baseline

Runner Windows membuka jendela **Poni Settings** asli. Setelah menyelesaikan langkah ketujuh Setup dengan pilihan bawaan, gear membuka halaman **General**. Tangkapan `05-settings-general.png` memperlihatkan kolom pencarian, kelompok sidebar, dan pengaturan bahasa, nama, arah tata letak, startup, notch, monitor, posisi, serta fullscreen. Pengamatan menggunakan Poni 1.8.1 dengan hash yang tercatat di [PARITY.md](PARITY.md). [Artefak Settings asli](https://github.com/wawan-wfs/WFS-Poni-Lab/actions/runs/45189121492/artifacts/14825496014)

Tangkapan tambahan mengonfirmasi **Modules** dengan sakelar, pegangan seret, dan panah pengurutan, **Media** dengan kontrol visualizer dan glow dari album art, serta **Calendar** dengan sakelar, pengingat rapat, awal minggu, dan kalender berlangganan ICS. Ketiganya terlihat saat dinavigasi langsung melalui sidebar Settings di runner Windows. [Tangkapan General, Modules, Media, dan Calendar](https://github.com/wawan-wfs/WFS-Poni-Lab/actions/runs/45189833030/artifacts/14826080547)

Tangkapan `native-observation/settings.png` memperlihatkan Settings Rust yang dibuka dengan gear. Runner memeriksa bahwa jendela berubah dari lebar 696 piksel menjadi 916 piksel. Halaman General Rust tampil di dalam notch. Settings asli adalah jendela terpisah dan memiliki kontrol tambahan, seperti nama, bahasa, dan monitor, yang belum tersedia di halaman General Rust. [Tangkapan Settings Rust](https://github.com/wawan-wfs/WFS-Poni-Lab/actions/runs/45189833076/artifacts/14825393106)

Baseline memiliki 25 kontrol standar dengan padanan sebagian dan 176 tanpa padanan. Panel Settings Rust kini menambahkan pilihan baru untuk `hoverDelay`, `mirrorEnabled`, dan `mirrorShape`, serta memperluas padanan untuk `headerClock`, `clock24h`, `openOnHover`, `closeDelay`, dan `moduleShortcuts`. Dengan klasifikasi yang sama, 173 kontrol standar masih belum memiliki padanan. Bagian Modules yang dibuat dengan renderer khusus juga kini memiliki pengaturan urutan, visibilitas, modul awal dan riwayat modul terakhir. Daftar di bawah mempertahankan status baseline untuk melacak perbedaan.

Putaran Calendar memindahkan Settings Rust ke jendela terpisah dan menambahkan `meetingReminderMinutes`, serta memperluas padanan untuk `calendarEnabled` dan `weekStart`. Dengan metode hitung yang sama, **172 dari 201 kontrol standar** masih belum memiliki padanan. Pengaturan minggu berlaku untuk Calendar, pemilih hari pengulangan di Todo, dan Day Progress. Impor ICS lokal tersedia untuk acara berjam yang didukung. Langganan URL belum dibuat.

| Jenis kontrol | Deklarasi | Masuk katalog build |
| --- | ---: | ---: |
| Sakelar | 115 | 115 |
| Slider | 40 | 40 |
| Pilihan | 35 | 34 |
| Angka | 5 | 5 |
| Teks | 4 | 4 |
| Waktu | 2 | 2 |
| Daftar | 1 | 1 |
| **Jumlah** | **202** | **201** |

## Peta bagian dan fungsi kustom

Jumlah pada tabel meliputi kontrol standar. Kolom terakhir merangkum aksi tambahan atau selisih baseline; teks informasi dicatat tanpa dianggap kontrol.

| Grup | Bagian | Standar aktif | Baris kustom | Aksi kustom dan selisih di Rust |
| --- | --- | ---: | ---: | --- |
| Poni | Set up Poni (tersembunyi) | 0 | 0 + halaman | Wizard tujuh langkah. Langkah awal memilih bahasa dan nama; memilih Poni, Dock, Buddy, HUD, notifikasi, Prayer Times dan startup; preset Simple/All/default dan pilihan tab; perilaku hover/auto-hide/fullscreen/reserveTop; efek, cursor dan Genie; layar akhir, Skip, Back, Next, Review/Done serta opsi buka wizard lagi. **Rust:** Belum tersedia. Opsi modul/fitur tetap pada build dasar. |
| Poni | Welcome | 0 | 0 + halaman | Kartu informasi fitur dan tombol Support Poni yang membuka About pada area dukungan. **Rust:** Tab Support mempunyai dua tautan, belum ada Welcome atau navigasi About. |
| Poni | General | 44 | 12 | Pilih bahasa; nama; hidupkan kembali notch; posisi horizontal dan preset kiri/tengah/kanan; tambah/hapus aplikasi auto-hide; tambah/ubah/hapus gap per aplikasi; pilih slot kiri/tengah/kanan, mode, ukuran dan tebal jam; tambah/ubah/urutkan/hapus World Clock; waktu mulai/akhir jam tenang; pilih kurva, look dan warna notch. **Rust:** World Clock sudah bisa dikonfigurasi di tabnya; posisi lekat di tengah, format dan bentuk belum menjadi pengaturan pada baseline. |
| Poni | Modules | 0 | 0 + halaman | Aktifkan per modul; urutkan melalui drag/drop atau panah; pilih tab awal dari modul aktif; ingat tab terakhir. Modul yang membutuhkan fitur aktif juga tergantung pada pengaturan fitur tersebut. **Rust:** Semua tab tersusun tetap di HTML baseline. Ada 24 nama di MODULE_META Settings, berbeda dari 23 modul yang dihitung laporan implementasi. |
| Poni | Live Activities | 11 | 0 | Pengaturan aktivitas dinamis notch tertutup belum tersedia. |
| Poni | Buddy | 10 | 2 | Pilih gambar Buddy, mode pas, bersihkan gambar; impor paket Buddy, kelola dan hapus paket, tautan koleksi serta sumber. **Rust:** Belum ada Buddy pada build dasar. |
| Poni | Cursor | 2 | 1 | Pilih tema/palet cursor, pratinjau cursor sesuai fungsi, pasang atau lepas tema. **Rust:** Belum tersedia. |
| Poni | Animations | 9 | 1 | Pilih pemicu outline bercahaya (off/alerts/music/always). **Rust:** Belum tersedia. |
| Poni | Wallpaper | 4 | 1 | Pilih file gambar/video, nyalakan/matikan wallpaper, lepas file, dan tampilkan status. **Rust:** Belum tersedia. |
| Features | Dashboard | 0 | 0 + halaman | Pilih empat slot widget; tambah aplikasi/file, tambah folder dan hapus entri launcher. Daftar Quick toggles pada Settings berupa petunjuk; kontrol ada di notch. **Rust:** Empat slot dan beberapa widget tersedia pada Dashboard, katalog dan launcher masih berbeda. |
| Features | Todo | 3 | 1 | Sinkron Microsoft To Do/Google Tasks, masuk/keluar, pilih list, sinyal status dan sync now. **Rust:** Tidak terlihat dalam build asli ini karena TODO_SYNC_READY=false. Todo lokal ada, bidang setelan keterlambatan/snooze/Trash belum tersedia. |
| Features | Media | 19 | 3 | Simpan/hapus password VLC, tes status sambungan sesuai kondisi; pilih isi di bawah notch (off/lirik/judul/keduanya). **Rust:** Media dasar ada, VLC dan lirik belum tersedia. |
| Features | Calendar | 3 | 0 + halaman | Kelola feed iCal (.ics): nama, warna, URL, tambah/hapus dan muat ulang; kelola acara lokal: judul, mulai, durasi, ulang, lokasi/tautan rapat, tambah/hapus. **Rust:** Acara lokal kalender tersedia pada tab Calendar. Sambungan Google/Outlook/iCloud dan pemicu rapat belum setara. |
| Features | Weather | 0 | 0 + halaman | Hidupkan cuaca; cari/pilih kota; deteksi posisi sekali atas klik pengguna dan buka izin lokasi bila diperlukan; satuan °C/km/h atau °F/mph. **Rust:** Cari/pilih kota dan prakiraan Open-Meteo tersedia; sensor/lokasi Windows, sakelar dan satuan alternatif belum tersedia pada baseline. |
| Features | Prayer Times | 0 | 0 + halaman | Aktifkan pengingat; pilih kota, gunakan kota Weather, deteksi lokasi, pilih/reset kabupaten Kemenag ketika cocok; metode dan mazhab Asr; koreksi Hijriah; pilih lama hitung mundur, suara dan enam kejadian; adhan default/Subuh (pilih/tes/hapus), aktifkan, volume, jedakan media. **Rust:** Lokasi/metode/Asr dan jadwal ada di Prayer, koreksi Hijriah di Calendar. Pengingat/adhan dan penyedia Kemenag resmi belum tersedia. |
| Features | Pomodoro | 12 | 1 | Tambahkan hingga delapan preset 1–600 menit, hapus dan urutkan. **Rust:** Timer dasar di tab Timer, daftar preset belum tersedia pada baseline. |
| Features | Health | 11 | 0 | Catatan kesehatan dan panduan tersedia; sasaran dan pengingat terjadwal masih berbeda. |
| Features | Screen Time | 3 | 0 | Sakelar pencatatan dan ringkasan ada di tab; idle threshold dan daftar pengecualian belum dapat dikonfigurasi. |
| Features | Day Progress | 4 | 0 | Jam mulai/tidur tersedia di tab; pengingat dan chime DnD belum ada. |
| Features | Bluetooth & Wi-Fi | 2 | 1 | Daftar status perangkat; isi berasal dari keadaan hardware saat Settings dibuka. **Rust:** Tab Bluetooth menampilkan perangkat klasik/LE; pengingat koneksi/baterai dan sakelar sumber belum ada. |
| Poni & system | Dock | 26 | 5 | Pulihkan notch jika mati; pemilih display Dock dan daftar monitor; pilih pin aplikasi/folder, urutkan, hapus dan ubah/reset ikon; pilih tampilan; nyalakan widget, urutkan dari Dock. **Rust:** Dock native dan pengelolaan taskbar Windows belum tersedia. |
| Poni & system | Notifications | 9 | 2 | Petunjuk Telegram bersyarat; hapus riwayat bila ada dengan konfirmasi dalam baris. **Rust:** Clear internal ada pada tab Notifications. Windows notification listener, Do Not Disturb, aturan banner, pop-up, dan deteksi drive belum tersedia. |
| Poni & system | Drop Actions & Shelf | 0 | 0 + halaman | Aktifkan drop actions; pilih dan urutkan ubin Shelf, Share, Zip, Unzip, Compress PDF/Image/Video, Convert, OCR, Copy, Move, OneDrive, Open with, Trash, Eject; pilih kualitas kompresi; sakelar Shelf, buka saat drag dan buang referensi setelah drag out; Phone Share dan folder; Clipboard History dan batas salinan. **Rust:** Tidak ada Shelf atau drop actions native. |
| Poni & system | Snap Zones | 0 | 0 + halaman | Nyalakan Snap Zones; pilih preset layout mana yang tersedia. Windows 11 memberi petunjuk konflik fitur Snap bawaan. **Rust:** Belum tersedia. |
| Poni & system | HUD | 14 | 0 + halaman | Pengaturan standar tercantum di lampiran. Slider Try it menguji volume dan brightness langsung. **Rust:** Volume tersedia di tab Control; HUD sistem dan slider brightness belum tersedia. |
| Poni & system | Battery | 5 | 1 | Hanya menampilkan info daya baterai yang dideteksi. **Rust:** Belum tersedia. |
| Poni & system | Mirror | 2 | 0 | Mirror dan pilihan bentuk belum tersedia. |
| Poni & system | System Monitor | 2 | 2 | Pilih sensor suhu jika sensor terbaca; izinkan FPS jika diperlukan, dan pertahankan notch di layar penuh bila diinginkan. **Rust:** CPU/memori ada pada tab System; suhu, FPS dan permintaan izin Windows belum tersedia. |
| Integrations | AI Chat & Translate | 0 | 0 + halaman | Pilih provider Chat dan Translate; konteks hari, instruksi, memori (tambah/edit/hapus), pencarian web dan kunci Tavily; briefing terjadwal (tambah/ubah/hapus, waktu/hari/isi, jalankan); konfigurasi Gemini/Claude/OpenAI-kompatibel/Ollama dengan model/URL, atur/hapus kunci sesuai provider. **Rust:** Chat menggunakan Ollama lokal dengan pengaturan model, Translate menggunakan MyMemory. Belum ada pemilih provider setara, konteks/memori, Briefs, atau pengelola kredensial asli. |
| Integrations | AI usage | 3 | 2 | Nyalakan Claude dan Codex masing-masing serta tampilkan status layanan/akun lokal. **Rust:** Impor snapshot manual tersedia; penghubungan akun dan laju live belum tersedia. |
| Integrations | Claude Code | 3 | 1 | Tampilkan status integrasi, pasang atau lepas hooks, sesuai lokasi instalasi dan status data. **Rust:** Belum ada integrasi hooks. |
| Integrations | GitHub | 0 | 0 + halaman | Nyalakan modul; simpan/hapus token dengan penyimpanan DPAPI; sertakan PR buatan pengguna. **Rust:** Panel memakai nama pengguna, hasil PR publik dan tanpa token. Tidak ada jalur PR privat. |
| Tanpa judul grup | About | 0 | 0 + halaman | Buka catatan rilis, dukungan QRIS/PayPal/GitHub, pilih tombol Support; wizard ulang/reset/quit; ekspor .poni dan impor dengan pratinjau, konfirmasi, atau buka folder salinan; cek/pasang pembaruan atau buka Store; sakelar cek otomatis, pemasangan otomatis dan statistik anonim. **Rust:** Tab Support memiliki tautan yang diizinkan; QRIS tidak diterbitkan. Backup .poni, wizard, pengaturan update dan telemetry belum tersedia. |

## Rincian kontrol standar

**Padanan sebagian** berarti ada fungsi yang relevan atau versi dengan nilai tetap; belum memenuhi tata letak atau seluruh perilaku Settings. **Belum ada** berarti tidak ada padanan kontrol/fungsi yang ditemukan pada baseline. Tidak ada entri yang dinyatakan setara dari pembacaan source.

<details>

<summary>General — 44 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Layout direction / `layoutDirection` | pilihan | Belum ada. |
| Launch at login / `launchAtLogin` | sakelar | Belum ada. |
| Show Poni (the notch) / `notchEnabled` | sakelar | Belum ada. |
| Show Poni on / `display` | pilihan | Belum ada. |
| Lock position / `lockPosition` | sakelar | Belum ada. |
| Hide when an app is fullscreen / `hideInFullscreen` | sakelar | Belum ada. |
| Auto-hide / `autoHide` | sakelar | Belum ada. |
| Come down when you’re idle / `standbyShow` | sakelar | Belum ada. |
| Idle for / `standbySecs` | angka | Belum ada. |
| Hide button / `hideButton` | sakelar | Belum ada. |
| Step aside for the mouse / `stepAside` | sakelar | Belum ada. |
| Gap from the top edge / `notchTopGap` | slider | Belum ada. |
| Touchscreen support / `touchMode` | sakelar | Belum ada. |
| Keep windows below Poni / `reserveTop` | sakelar | Belum ada. |
| Frosted strip beside Poni / `reserveBlur` | slider | Belum ada. |
| Color the strip like the app below / `reserveMatch` | sakelar | Belum ada. |
| Show Poni in screenshots & recordings / `showInScreenshots` | sakelar | Belum ada. |
| Bounce on events / `haptics` | sakelar | Belum ada. |
| Battery saver / `batterySaving` | pilihan | Belum ada. |
| Shut down or sleep when you’re away / `idlePower` | sakelar | Belum ada. |
| When you’re away / `idlePowerAction` | pilihan | Belum ada. |
| Away for / `idlePowerMinutes` | slider | Belum ada. |
| Keep the time while music or a timer plays / `clockWithActivities` | sakelar | Belum ada. |
| Time and date at the top of the open Poni / `headerClock` | sakelar | Padanan sebagian. Jam header sudah tampil, sakelar dan tanggal belum tersedia pada baseline. |
| 24-hour time / `clock24h` | sakelar | Padanan sebagian. World Clock dapat membaca preferensi format jam jika diberikan, belum ada kontrol bersama. |
| Hourly chime / `hourChime` | pilihan | Belum ada. |
| Open on hover / `openOnHover` | sakelar | Padanan sebagian. Hover berfungsi; opsi klik saja belum tersedia pada baseline. |
| Hover delay / `hoverDelay` | slider | Belum ada. |
| Close delay / `closeDelay` | slider | Padanan sebagian. Penutupan tertunda memakai nilai tetap, belum dapat dikonfigurasi. |
| Open / close Poni / `toggleShortcut` | teks | Padanan sebagian. Alt+N berfungsi, belum dapat diganti. |
| Switch tabs with ← / → / `moduleShortcuts` | sakelar | Padanan sebagian. Navigasi ← dan → tersedia pada kondisi tertentu, belum dapat dikonfigurasi. |
| Snooze Poni / `snoozeShortcut` | teks | Belum ada. |
| Snooze duration / `snoozeMinutes` | slider | Belum ada. |
| Pick a color from the screen / `colorPickShortcut` | teks | Belum ada. |
| Copy colors as / `colorPickFormat` | pilihan | Belum ada. |
| Copy text from the screen / `ocrShortcut` | teks | Belum ada. |
| Width / `notchWidth` | slider | Belum ada. |
| Height / `notchHeight` | slider | Belum ada. |
| Warmer colors at night / `warmNight` | sakelar | Belum ada. |
| Night warmth / `warmNightStrength` | slider | Belum ada. |
| Opacity when closed / `notchOpacity` | slider | Belum ada. |
| Expanded width / `expandedWidth` | slider | Belum ada. |
| Expanded height / `expandedHeight` | slider | Belum ada. |
| Expanded height (tall modules) / `expandedHeightTall` | slider | Belum ada. |

</details>

<details>

<summary>Live Activities — 11 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Live activities while Poni is closed / `liveActivity` | sakelar | Belum ada. |
| Rotate between activities / `liveRotate` | sakelar | Belum ada. |
| Music / `liveSources.music` | sakelar | Belum ada. |
| Pomodoro, timer and stopwatch / `liveSources.pomodoro` | sakelar | Belum ada. |
| System summary now and then / `liveSources.system` | sakelar | Belum ada. |
| Show the System summary every / `sysPeekEvery` | pilihan | Belum ada. |
| Events starting within 15 minutes / `liveSources.calendar` | sakelar | Belum ada. |
| Bluetooth connect / disconnect / low battery / `liveSources.bluetooth` | sakelar | Belum ada. |
| Todo deadlines / `liveSources.todo` | sakelar | Belum ada. |
| Sneak peek on song change / `sneakPeek` | sakelar | Belum ada. |
| Hover-reveal ⏮ ⏯ ⏭ while Poni is closed / `hoverMediaControls` | sakelar | Belum ada. |

</details>

<details>

<summary>Buddy — 10 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Show the buddy / `catEnabled` | sakelar | Belum ada. |
| Character / `catLook` | pilihan | Belum ada. |
| Fur / Feathers / Color, sesuai Buddy / `catColor` | pilihan | Belum ada. |
| Where it hangs / `catSide` | pilihan | Belum ada. |
| Size / `catSize` | slider | Belum ada. |
| Opacity / `catOpacity` | slider | Belum ada. |
| Doze off when the mouse and keyboard are idle / `catSleep` | sakelar | Belum ada. |
| Hide while Poni is open / `catHideWhenOpen` | sakelar | Belum ada. |
| Hide with Poni when it auto-hides / `catAutoHide` | sakelar | Belum ada. |
| Chat with the buddy / `catChat` | sakelar | Belum ada. |

</details>

<details>

<summary>Cursor — 2 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Pointers / `cursorTheme` | pilihan | Belum ada. |
| Size / `cursorScale` | slider | Belum ada. |

</details>

<details>

<summary>Animations — 9 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Timer outline / `fxTimerLine` | sakelar | Belum ada. |
| Windows and popups come out of their Dock icon / `fxGenie` | sakelar | Belum ada. |
| Files fly into the Shelf / `fxShelfFly` | sakelar | Belum ada. |
| Stacked notifications / `fxNotifStack` | sakelar | Belum ada. |
| Tabs slide in from their side / `fxTabSlide` | sakelar | Belum ada. |
| Shadow of the open Poni / `notchShadow` | pilihan | Belum ada. |
| Volume bar bounces at the ends / `fxHudBounce` | sakelar | Belum ada. |
| Karaoke lyrics / `fxKaraoke` | sakelar | Belum ada. |
| Celebrate a done day / `fxCelebrate` | sakelar | Belum ada. |

</details>

<details>

<summary>Wallpaper — 4 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Fit / `wallpaperFit` | pilihan | Belum ada. |
| While an app is fullscreen / `wallpaperPauseFullscreen` | sakelar | Belum ada. |
| While a window covers the screen / `wallpaperPauseCovered` | sakelar | Belum ada. |
| On battery / `wallpaperPauseBattery` | sakelar | Belum ada. |

</details>

<details>

<summary>Todo — 3 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Mark late tasks as done / `todoLateMinutes` | pilihan | Belum ada. |
| Sync with / `todoSync` | pilihan | Tersembunyi di aplikasi asli pada build ini (`TODO_SYNC_READY = false`). |
| Snooze a due task for / `todoSnoozeMinutes` | pilihan | Belum ada. |
| Keep deleted tasks in Trash for / `todoTrashDays` | slider | Belum ada. |

</details>

<details>

<summary>Media — 19 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Music controls / `mediaEnabled` | sakelar | Padanan sebagian. Kontrol sesi media dasar hidup di Home, sakelar belum tersedia. |
| Real audio visualizer / `realVisualizer` | sakelar | Belum ada. |
| Visualizer style / `visualizerStyle` | pilihan | Belum ada. |
| Color glow from album art / `colorGlow` | sakelar | Belum ada. |
| Find missing album art online / `artOnline` | sakelar | Belum ada. |
| Progress bar in the closed Poni / `musicProgress` | sakelar | Padanan sebagian. Progres media ada di Home, belum muncul pada notch tertutup. |
| VLC web interface / `vlcWeb` | sakelar | Belum ada. |
| Web interface port / `vlcPort` | angka | Belum ada. |
| Lyrics / `lyricsEnabled` | sakelar | Belum ada. |
| Where the current line shows / `lyricsLayout` | pilihan | Belum ada. |
| Second line inside / `lyricsSecondLine` | pilihan | Belum ada. |
| Long lines inside / `lyricsLongLines` | pilihan | Belum ada. |
| Lyrics width / `lyricsWidth` | pilihan | Belum ada. |
| Lyrics text size / `lyricsTextSize` | pilihan | Belum ada. |
| Bold lyrics / `lyricsBold` | sakelar | Belum ada. |
| Album art behind the lyrics / `lyricsArtBg` | slider | Belum ada. |
| Show the lyrics as / `lyricsScript` | pilihan | Belum ada. |
| Under each line / `lyricsExtra` | pilihan | Belum ada. |
| Translate lyrics into / `lyricsTranslateTo` | pilihan | Belum ada. |

</details>

<details>

<summary>Calendar — 3 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Show calendar / `calendarEnabled` | sakelar | Padanan sebagian. Agenda lokal tampil pada tab Calendar; belum ada sakelar asli. |
| Meeting reminder / `meetingReminderMinutes` | slider | Belum ada. |
| Week starts on / `weekStart` | pilihan | Padanan sebagian. Awal pekan Monday pada build dasar, belum dapat diubah. |

</details>

<details>

<summary>Pomodoro — 12 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Focus / `pomoWork` | slider | Padanan sebagian. Durasi fokus tersimpan di tab Pomodoro. |
| Short break / `pomoShort` | slider | Padanan sebagian. Durasi jeda pendek tersimpan di tab Pomodoro. |
| Long break / `pomoLong` | slider | Padanan sebagian. Durasi jeda panjang tersimpan di tab Pomodoro. |
| Focus sessions before a long break / `pomoCycles` | slider | Padanan sebagian. Jumlah sesi sebelum jeda panjang tersedia di tab Pomodoro. |
| Start breaks automatically / `pomoAutoBreak` | sakelar | Padanan sebagian. Pilihan jeda otomatis di tab Pomodoro. |
| Start focus automatically after a break / `pomoAutoWork` | sakelar | Padanan sebagian. Pilihan fokus otomatis di tab Pomodoro. |
| Completion sound / `pomoSound` | sakelar | Belum ada. |
| Sound while you focus / `focusSound` | pilihan | Belum ada. |
| Volume / `focusSoundVolume` | slider | Belum ada. |
| Keep playing in breaks / `focusSoundBreaks` | sakelar | Belum ada. |
| Remember the last duration / `timerRemember` | sakelar | Padanan sebagian. Timer Rust menyimpan durasi terakhir, pilihan untuk mematikannya belum ada. |
| Start a break after the timer / `timerThenBreak` | sakelar | Belum ada. |

</details>

<details>

<summary>Health — 11 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Track health / `healthEnabled` | sakelar | Belum ada. |
| Water goal / `healthWaterGoal` | slider | Belum ada. |
| Break goal / `healthBreakGoal` | slider | Belum ada. |
| Mindful minutes goal / `healthMindfulGoal` | slider | Belum ada. |
| Remind me to take a break / `healthBreakReminders` | sakelar | Belum ada. |
| After working continuously for / `healthBreakInterval` | slider | Belum ada. |
| Remind me to drink water / `healthWaterReminders` | sakelar | Belum ada. |
| Water reminder every / `healthWaterInterval` | slider | Belum ada. |
| 20-20-20 eye breaks / `healthEyeBreaks` | sakelar | Belum ada. |
| Eye break every / `healthEyeInterval` | slider | Belum ada. |
| Eye break length / `healthEyeDuration` | slider | Belum ada. |

</details>

<details>

<summary>Screen Time — 3 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Track screen time / `screenTimeEnabled` | sakelar | Padanan sebagian. Sakelar pencatatan ada di tab Screen Time. |
| Stop counting after idle / `screenTimeIdle` | slider | Padanan sebagian. Filter idle memakai ambang tetap, kontrol pengaturan belum ada. |
| Excluded apps / `screenTimeExcluded` | daftar | Belum ada. |

</details>

<details>

<summary>Day Progress — 4 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Day starts / `wakeTime` | waktu | Padanan sebagian. Jam mulai tersimpan di Day Progress. |
| Bedtime / `bedTime` | waktu | Padanan sebagian. Jam tidur tersimpan di Day Progress. |
| Remind me at bedtime / `bedtimeReminder` | sakelar | Belum ada. |
| Chime even in Do not disturb / `bedtimeChimeDnd` | sakelar | Belum ada. |

</details>

<details>

<summary>Bluetooth & Wi-Fi — 2 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Bluetooth devices & battery / `bluetoothEnabled` | sakelar | Belum ada. |
| Low battery alert at / `bluetoothLowBattery` | slider | Belum ada. |

</details>

<details>

<summary>Dock — 26 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Show the Dock / `dockEnabled` | sakelar | Belum ada. |
| Open apps on each Dock / `dockAppsOn` | pilihan | Belum ada. |
| Same shape for every icon / `dockUniformIcons` | sakelar | Belum ada. |
| Tint icons / `dockIconTint` | sakelar | Belum ada. |
| Show today’s date on calendar icons / `dockCalendarDate` | sakelar | Belum ada. |
| Mark apps that need attention / `dockAttention` | sakelar | Belum ada. |
| Unread counts on icons / `dockBadges` | sakelar | Belum ada. |
| Window previews / `dockPreviews` | sakelar | Belum ada. |
| Open-app marker / `dockRunMark` | pilihan | Belum ada. |
| Icon size / `dockSize` | slider | Belum ada. |
| Space between icons / `dockGap` | slider | Belum ada. |
| Magnification / `dockMagnify` | slider | Belum ada. |
| Gap from the bottom edge / `dockLift` | slider | Belum ada. |
| Show open apps that aren’t pinned / `dockShowRunning` | sakelar | Belum ada. |
| End task in the right-click menu / `dockEndTask` | sakelar | Belum ada. |
| Hide the Dock until the mouse reaches the bottom / `dockAutoHide` | sakelar | Belum ada. |
| Hide while a window is maximized / `dockHideMaximized` | sakelar | Belum ada. |
| Come up when you’re idle / `dockStandby` | sakelar | Belum ada. |
| Idle for / `dockStandbySecs` | angka | Belum ada. |
| Hover delay / `dockHoverDelay` | slider | Belum ada. |
| Close delay / `dockCloseDelay` | slider | Belum ada. |
| Keep windows above the Dock / `dockReserve` | sakelar | Belum ada. |
| Hide when an app is fullscreen / `dockHideInFullscreen` | sakelar | Belum ada. |
| Hide the Windows taskbar / `dockHideTaskbar` | sakelar | Belum ada. |
| Battery percentage / `dockBatteryPercent` | sakelar | Belum ada. |
| Tray icon size / `dockTraySize` | pilihan | Belum ada. |

</details>

<details>

<summary>Notifications — 9 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Show Windows notifications in Poni / `notifEnabled` | sakelar | Belum ada. |
| Follow Do not disturb / `notifFollowDnd` | sakelar | Belum ada. |
| Quiet pop-ups during Do not disturb / `notifDndPeek` | sakelar | Belum ada. |
| Don’t show them twice / `notifHideBanners` | sakelar | Belum ada. |
| Show each for / `notifSeconds` | pilihan | Belum ada. |
| Notification history / `notifHistory` | sakelar | Padanan sebagian. Riwayat internal Todo, Timer dan Pomodoro, belum membaca notifikasi aplikasi Windows. |
| Keep for / `notifHistoryDays` | angka | Padanan sebagian. Retensi internal memakai nilai tetap, pengaturan belum tersedia. |
| Keep at most / `notifHistoryMax` | angka | Padanan sebagian. Batas internal memakai nilai tetap, pengaturan belum tersedia. |
| Say when a drive is plugged in / `driveNotify` | sakelar | Belum ada. |

</details>

<details>

<summary>HUD — 14 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Enable HUD / `hudEnabled` | sakelar | Belum ada. |
| Show over fullscreen apps / `hudOverFullscreen` | sakelar | Belum ada. |
| Take over volume keys / `hudOverrideVolumeKeys` | sakelar | Belum ada. |
| Brightness HUD / `hudBrightness` | sakelar | Belum ada. |
| Hide Windows’ own brightness pop-up / `hudHideWindowsOsd` | sakelar | Belum ada. |
| Hide the laptop maker’s pop-ups / `hudHideMakerOsd` | sakelar | Belum ada. |
| Caps Lock, Num Lock and Scroll Lock / `hudLockKeys` | sakelar | Belum ada. |
| Keyboard language / `hudInputLang` | sakelar | Belum ada. |
| Microphone on / off / `hudMic` | sakelar | Belum ada. |
| Touchpad on / off / `hudTouchpad` | sakelar | Belum ada. |
| Airplane mode / `hudAirplane` | sakelar | Belum ada. |
| Keep a mark while Caps Lock is on / `capsLockMark` | sakelar | Belum ada. |
| Show the keyboard language in the closed Poni / `langMark` | sakelar | Belum ada. |
| Style / `hudStyle` | pilihan | Belum ada. |

</details>

<details>

<summary>Battery — 5 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Show battery / `batteryEnabled` | sakelar | Belum ada. |
| Show percentage / `showBatteryPercent` | sakelar | Belum ada. |
| Icon / `batteryStyle` | pilihan | Belum ada. |
| Charging animation / `chargingActivity` | sakelar | Belum ada. |
| Low battery warning at / `lowBatteryThreshold` | slider | Belum ada. |

</details>

<details>

<summary>Mirror — 2 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Show mirror / `mirrorEnabled` | sakelar | Belum ada. |
| Shape / `mirrorShape` | pilihan | Belum ada. |

</details>

<details>

<summary>System Monitor — 2 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Show the System tab / `statsEnabled` | sakelar | Padanan sebagian. Tab System menampilkan CPU dan memori dengan tab tetap. |
| FPS counter / `fpsCounter` | sakelar | Belum ada. |

</details>

<details>

<summary>AI usage — 3 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Refresh Claude Code’s sign-in automatically / `aiUsageAutoRefresh` | sakelar | Belum ada. |
| Show in the closed Poni / `aiUsageMark` | sakelar | Belum ada. |
| Warn at / `aiUsageWarn` | pilihan | Belum ada. |

</details>

<details>

<summary>Claude Code' — 3 kontrol standar aktif</summary>

| Label asli / key | Jenis | Status pada baseline Rust |
| --- | --- | --- |
| Show Claude Code’s requests / `claudeHooks` | sakelar | Belum ada. |
| Answer permissions from Poni / `claudeAnswer` | sakelar | Belum ada. |
| Tell me when Claude is done / `claudeDone` | sakelar | Belum ada. |

</details>

## Bukti berikutnya dari Settings native

Buka Settings dari ikon roda gigi setelah menutup wizard. Simpan tampilan General dan sidebar, lalu pindah ke Modules, Calendar, Dock, Drop Actions & Shelf, HUD, AI Chat & Translate dan About tanpa mengubah setelan pengguna. Bandingkan daftar native dengan inventaris ini dan catat variasi karena perangkat serta OS. Untuk skor kesetaraan, kontrol yang terlihat, operasi, persistensi, perambatan ke fitur, dan aksesibilitas perlu diuji pada kedua build.

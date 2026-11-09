# Animasi Studio Gan

Studio web berbahasa Indonesia untuk mengembangkan ide menjadi naskah dan storyboard AI berdurasi pilihan, menyunting hasilnya, lalu menghasilkan klip video animasi dan sound effect per adegan melalui fal.ai. Backend menggunakan Node.js bawaan, tanpa paket tambahan.

## Menjalankan aplikasi

1. Pastikan Node.js 18 atau lebih baru tersedia.
2. Salin `.env.example` menjadi `.env`.
3. Isi `FAL_KEY` dengan kunci fal.ai di `.env` bila siap mengaktifkan generasi. Jangan kirim atau commit file `.env`.
4. Jalankan `node server.js`, lalu buka `http://127.0.0.1:4173`.

Tanpa `FAL_KEY`, studio dan editor tetap bisa digunakan, tetapi permintaan AI akan ditolak oleh server tanpa menghubungi provider. Contoh yang tampil saat pertama membuka studio hanya contoh lokal, bukan hasil AI. Naskah baru dibuat setelah tombol **Buat naskah AI & storyboard** ditekan; produksi media perlu konfirmasi tambahan sebelum permintaan dikirim. Penggunaan API fal.ai dapat dikenakan biaya sesuai akun/provider; periksa harga dan saldo akun sebelum menambahkan kunci.

## Provider dan model

Server-side queue API fal.ai dipakai untuk dua tugas:

- Naskah dan storyboard: `fal-ai/any-llm`, dengan model LLM default `google/gemini-2.5-flash-lite`.
- Video animasi: `fal-ai/veo3` (klip 4, 6, atau 8 detik, rasio 16:9, 720p).
- Sound effect: `fal-ai/elevenlabs/sound-effects` (hingga 8 detik, prompt disusun dari aksi dan suasana adegan).

Durasi yang dipilih harus bilangan bulat 1–10 menit. AI menargetkan sekitar 130 kata narasi per menit dan membuat rencana klip 4/6/8 detik yang total durasinya sama persis dengan target. Batas 10 menit menghasilkan hingga 75 adegan dan 150 permintaan media (satu video dan satu SFX per adegan). Studio menampilkan jumlah permintaan dan meminta konfirmasi sebelum produksi semua adegan. Klip diproses dengan dua worker maksimal dan hasilnya tetap klip terpisah; aplikasi belum menyambungkan klip menjadi satu film atau menambahkan narasi audio hasil generasi.

Model ID bisa diganti dengan `FAL_SCRIPT_MODEL_ID`, `FAL_SCRIPT_LLM_MODEL`, `FAL_VIDEO_MODEL_ID`, dan `FAL_SFX_MODEL_ID`. Jika model perlu input berbeda, atur objek JSON opsional `FAL_SCRIPT_INPUT_JSON`, `FAL_VIDEO_INPUT_JSON`, dan `FAL_SFX_INPUT_JSON`; field prompt untuk masing-masing tugas tetap disediakan aplikasi. Sesuaikan pengaturan dengan skema model yang dipilih. Galeri dan API model:

- [fal.ai Any LLM](https://fal.ai/models/fal-ai/any-llm/api)
- [fal.ai Veo 3](https://fal.ai/models/fal-ai/veo3/api)
- [fal.ai ElevenLabs Sound Effects](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/api)
- [fal.ai Queue API](https://fal.ai/docs/documentation/model-apis/inference/queue)

API key hanya dibaca server dari `.env`/environment, tidak diberikan ke browser. Backend mengembalikan ID antrean dan browser memeriksa status serta URL hasil. Status antrean disimpan dalam memori server; memulai ulang server dapat memutus pelacakan job yang sedang berjalan. URL hasil media disediakan provider dan dapat kedaluwarsa—unduh hasil yang ingin disimpan.

## Fitur dan batasan

- Minta AI membuat judul, sinopsis, naskah dengan target durasi, dan adegan berurutan yang memiliki prompt visual serta pilihan SFX yang sesuai.
- Koreksi ide, naskah, judul/visual/narasi/SFX adegan, dan gaya sebelum produksi.
- Generate video dan SFX untuk adegan aktif atau produksi semua adegan dengan antrean, pelacakan status, hasil, dan error yang terlihat. Gagal dapat dicoba lagi.
- Putar hasil video/audio saat tersedia. Ilustrasi mockup tetap diberi label pratinjau dan tidak mengaku sebagai video AI.
- Simpan proyek di browser dan ekspor JSON.
- Job antrean disimpan dalam memori server; memulai ulang server dapat memutus pelacakan job yang sedang berjalan. URL hasil media disediakan provider dan dapat kedaluwarsa—unduh hasil yang ingin disimpan.
- Jalankan pemeriksaan backend tanpa kredensial: `node --test server.test.js`.

Kunci `FAL_KEY` dan kemungkinan biaya provider tetap diperlukan untuk generasi sungguhan. Tes otomatis memakai provider tiruan dan tidak melakukan permintaan berbayar. Belum ada sinkronisasi proyek, penyimpanan media permanen, penggabungan klip, atau generasi suara narator.

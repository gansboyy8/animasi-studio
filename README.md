# Animasi Studio Gan

Studio web berbahasa Indonesia untuk mengembangkan ide, menyunting sinopsis/storyboard, lalu meminta generasi video per adegan dan sound effect melalui fal.ai. Backend menggunakan Node.js bawaan, tanpa paket tambahan.

## Menjalankan aplikasi

1. Pastikan Node.js 18 atau lebih baru tersedia.
2. Salin `.env.example` menjadi `.env`.
3. Tambahkan kunci fal.ai ke `FAL_KEY` di `.env` bila siap mengaktifkan generasi. Jangan kirim atau commit file `.env`.
4. Jalankan `node server.js`, lalu buka `http://127.0.0.1:4173`.

Tanpa `FAL_KEY`, studio dan editor tetap bisa digunakan, tetapi permintaan AI akan ditolak oleh server tanpa menghubungi provider. Generasi baru benar-benar dikirim setelah tombol **Buat video AI** atau **Buat SFX AI** ditekan. Penggunaan API fal.ai dapat dikenakan biaya sesuai akun/provider; periksa harga dan saldo akun sebelum menambahkan kunci.

## Provider dan model

Server-side queue API fal.ai dipakai untuk dua tugas:

- Video: `fal-ai/veo3` (durasi default 8 detik, rasio 16:9, 720p).
- Sound effect: `fal-ai/elevenlabs/sound-effects` (durasi default 4 detik).

Model ID bisa diganti dengan `FAL_VIDEO_MODEL_ID` dan `FAL_SFX_MODEL_ID`. Jika model perlu input berbeda, atur objek JSON opsional `FAL_VIDEO_INPUT_JSON` dan `FAL_SFX_INPUT_JSON`; field prompt (`prompt` untuk video, `text` untuk SFX) selalu disediakan aplikasi. Sesuaikan pengaturan dengan skema model yang dipilih. Galeri dan API model:

- [fal.ai Veo 3](https://fal.ai/models/fal-ai/veo3/api)
- [fal.ai ElevenLabs Sound Effects](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/api)
- [fal.ai Queue API](https://fal.ai/docs/documentation/model-apis/inference/queue)

API key hanya dibaca server dari `.env`/environment, tidak diberikan ke browser. Backend mengembalikan ID antrean dan browser memeriksa status serta URL hasil. Status antrean disimpan dalam memori server; memulai ulang server dapat memutus pelacakan job yang sedang berjalan. URL hasil media disediakan provider dan dapat kedaluwarsa—unduh hasil yang ingin disimpan.

## Fitur

- Susun draft cerita lokal dari ide menggunakan template, lalu koreksi naskah dan adegan.
- Generate video untuk adegan aktif dan SFX untuk adegan aktif; status antrean, progres, hasil, dan error tampil di studio. Setiap adegan dirender terpisah; prototipe belum menyambung klip menjadi satu film.
- Putar hasil video/audio saat tersedia; mockup hanya tampil sampai ada hasil generasi nyata.
- Simpan proyek di browser dan ekspor JSON.
- Jalankan pemeriksaan backend tanpa kredensial: `node --test server.test.js`.

Generasi naskah AI belum diintegrasikan; susun draft cerita masih memakai template lokal. Belum ada sinkronisasi proyek atau penyimpanan media permanen.

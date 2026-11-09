# Animasi Studio Gan

Studio web berbahasa Indonesia untuk mengembangkan ide menjadi naskah dan storyboard sesuai durasi, lalu membuat video dan sound effect pada komputer sendiri. Server aplikasi hanya memanggil layanan di `localhost`: Ollama untuk naskah dan ComfyUI untuk workflow video/SFX. Aplikasi tidak memakai fal.ai, API key cloud, atau layanan generasi berbayar.

## Status yang perlu diketahui

- **Naskah/storyboard:** siap digunakan setelah Ollama terpasang, model lokal diunduh oleh pengguna, dan server Ollama berjalan.
- **Video dan SFX:** adapter lokal ComfyUI sudah tersedia, tetapi aplikasi tidak menyertakan model AI, node tambahan, atau workflow universal. Pengguna perlu memasang ComfyUI, model dan node yang cocok dengan perangkatnya, lalu mengekspor workflow API untuk masing-masing tugas.
- **Belum diuji pada komputer bermodel:** pembuatan video/audio sungguhan memerlukan workflow ComfyUI lokal yang valid dan resource komputasi yang memadai. Tes proyek menggunakan mock; tidak mengunduh model dan tidak menghubungi cloud.
- Pemrosesan di CPU bisa sangat lambat. Untuk perangkat yang disebutkan pengguna (laptop RTX 3050 dengan VRAM 4 GB), default Ollama diturunkan ke `qwen2.5:3b` untuk naskah. Generasi video lokal modern umumnya lebih berat daripada batas VRAM tersebut; workflow video mungkin perlu model kecil/terkuantisasi, resolusi dan frame rendah, atau dapat gagal/OOM. Ini bukan jaminan semua model akan jalan. Workflow/audio juga perlu diuji pada konfigurasi ComfyUI yang dipilih. Produksi batch dibuat satu job pada satu waktu untuk menekan tekanan memori. Maksimum durasi rencana tetap 10 menit dan menghasilkan hingga 75 klip, yang bisa memerlukan waktu dan ruang penyimpanan besar.

## 1. Pasang Ollama untuk naskah

1. Pasang Ollama untuk Windows dari [ollama.com/download](https://ollama.com/download).
2. Buka PowerShell dan unduh model lokal yang sesuai dengan ruang disk dan RAM perangkat. Contoh yang dipakai sebagai default aplikasi:

   ```powershell
   ollama pull qwen2.5:3b
   ollama list
   ```

   Pengunduhan dilakukan hanya jika kamu menjalankan perintah itu; ukuran dan kinerja bergantung pada varian model dan perangkat. Model lebih kecil dapat dipilih dengan mengganti `OLLAMA_MODEL` ke nama persis yang tampil di `ollama list`. Hindari nama model bertanda `cloud`.
3. Pastikan Ollama berjalan di `http://127.0.0.1:11434`. Backend mengirim prompt ke endpoint lokal `/api/chat`, tidak ke internet.

Referensi: [Ollama Windows](https://ollama.com/download/windows), [Ollama API chat](https://github.com/ollama/ollama/blob/main/docs/api.md#chat-request).

## 2. Pasang ComfyUI untuk video dan SFX lokal

ComfyUI tidak memiliki satu workflow video/audio yang cocok untuk semua kartu grafis, model, dan versi custom nodes. Pilih model terbuka serta workflow yang didukung oleh perangkatmu, lalu pasang ComfyUI dan dependensi tersebut mengikuti panduan resmi: [ComfyUI installation](https://docs.comfy.org/installation) dan [ComfyUI server overview](https://docs.comfy.org/development/core-concepts/server).

Untuk masing-masing tugas video dan SFX:

1. Jalankan server ComfyUI lokal pada `http://127.0.0.1:8188`.
2. Bangun atau buka workflow yang sudah berfungsi di ComfyUI dan uji secara manual. Workflow video harus menghasilkan file `.mp4` atau `.webm`; workflow efek suara harus menghasilkan `.wav`, `.mp3`, `.flac`, atau `.ogg`.
3. Ekspor workflow memakai **Save (API Format)**. Format JSON API berbeda dari workflow UI biasa.
4. Di JSON hasil ekspor, ganti nilai input prompt pada node yang tepat dengan string placeholder `"{{prompt}}"`. Untuk workflow video, sambungkan juga input durasi ke string placeholder `"{{duration_seconds}}"` (adapter menggantinya dengan angka 4, 6, atau 8); placeholder `"{{seed}}"` opsional. Jangan mengubah struktur workflow/node.
5. Simpan file misalnya sebagai `workflows/video-api.json` dan `workflows/sfx-api.json` di dalam folder proyek. Jangan letakkan file workflow yang belum dipercaya di folder publik lain.

Adapter mengirim objek workflow tersebut ke `POST /prompt`, memeriksa `GET /history/{prompt_id}`, lalu mem-proxy hasil dari endpoint lokal `/view`. Prompt dan metadata media tetap di komputer; file keluaran berada di folder output ComfyUI.

## 3. Jalankan studio

1. Salin `.env.example` sebagai `.env`.
2. Sesuaikan `OLLAMA_MODEL` dengan model lokal yang benar-benar terpasang. Isi `COMFYUI_VIDEO_WORKFLOW` dan `COMFYUI_SFX_WORKFLOW` dengan path relatif di dalam folder proyek.
3. Jalankan:

   ```powershell
   node server.js
   ```

4. Buka `http://127.0.0.1:4173`, cek status Ollama/ComfyUI di bagian **Suasana & Suara**, lalu mulai dari ide dan target durasi.

Untuk mencoba UI tanpa layanan/model terpasang, server tetap dapat dijalankan; status lokal tampil belum siap dan generate akan menampilkan error konfigurasi. Tidak perlu mengisi `FAL_KEY`; jika masih ada di environment, aplikasi mengabaikannya. URL service selain `localhost`, `127.0.0.1`, atau `[::1]` ditolak. Karena ini local-first, jangan ubah `HOST` agar server terbuka ke jaringan publik tanpa memahami risikonya.

## Durasi, hasil, dan batasan

- Durasi target bilangan bulat 1–10 menit; rencana menargetkan sekitar 130 kata narasi per menit dan dibagi menjadi klip 4/6/8 detik dengan jumlah durasi tepat sesuai target.
- Naskah lokal dibuat dengan Ollama dalam job async. Video/SFX dikirim ke workflow ComfyUI per scene; batch menjalankan satu job pada satu waktu dan meminta konfirmasi karena beban perangkat bisa besar.
- Edit naskah, judul, visual, narasi, dan prompt SFX sebelum produksi. File media tidak diunggah atau disimpan ke cloud oleh aplikasi.
- Aplikasi belum menggabungkan klip menjadi satu film, belum menghasilkan narasi suara AI, dan tidak mengunduh atau memasang model/workflow untukmu.
- Job aplikasi berada di memori server; memulai ulang server menghentikan pelacakan job tersebut. File ComfyUI yang sudah dibuat tetap dikelola di folder ComfyUI.

## Konfigurasi lokal

```env
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_VIDEO_WORKFLOW=workflows/video-api.json
COMFYUI_SFX_WORKFLOW=workflows/sfx-api.json
HOST=127.0.0.1
PORT=4173
```

Server memvalidasi URL Ollama/ComfyUI sebagai alamat loopback saja. Workflow harus berupa JSON API ComfyUI yang valid dan memiliki placeholder `{{prompt}}`. Video/SFX tidak aktif hanya dengan memasang ComfyUI; model, node, dan workflow yang kompatibel harus sudah disiapkan pengguna.

## Tes

Tes lokal memakai tiruan API Ollama dan ComfyUI, tidak memerlukan model:

```powershell
node --check server.js
node --check app.js
node --check lib/story-plan.js
node --test server.test.js
```

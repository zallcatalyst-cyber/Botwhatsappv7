const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage,
    generateWAMessageFromContent,
    prepareWAMessageMedia
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fetch = require('node-fetch');
const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const FormData = require('form-data');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// KONFIGURASI BOT & OWNER
const OWNER_NUMBER = "6283171413750"; 

// Inisialisasi Database Sederhana di Memori
global.db = {
    data: {
        users: {}
    }
};

function checkUserDb(senderNumber) {
    if (!global.db.data.users[senderNumber]) {
        global.db.data.users[senderNumber] = {
            exp: 1000,
            money: 5000,
            suit: 0,
            win: 0
        };
    }
}

async function downloadMedia(message, messageType) {
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

async function getBuffer(url, options = {}) {
    try {
        const res = await axios({
            method: "get",
            url,
            headers: { 'DNT': 1, 'Upgrade-Insecure-Requests': 1 },
            ...options,
            responseType: 'arraybuffer'
        });
        return res.data;
    } catch (e) {
        return null;
    }
}

async function uploadTelegraph(buffer, filename) {
    try {
        if (!fs.existsSync("./tmp")) fs.mkdirSync("./tmp");
        const tempPath = "./tmp/" + filename;
        fs.writeFileSync(tempPath, buffer);

        const form = new FormData();
        form.append("images", fs.createReadStream(tempPath));

        const { data } = await axios.post(
            "https://telegraph.zorner.men/upload",
            form,
            { headers: form.getHeaders() }
        );

        fs.unlinkSync(tempPath);
        return data?.links?.[0] || null;
    } catch (e) {
        console.error("Upload Telegraph Gagal:", e);
        return null;
    }
}

function convertToSticker(buffer, isVideo = false) {
    return new Promise((resolve, reject) => {
        const inputPath = path.join(__dirname, `temp_input_${Date.now()}`);
        const outputPath = path.join(__dirname, `temp_output_${Date.now()}.webp`);
        
        fs.writeFileSync(inputPath, buffer);
        
        let ff = ffmpeg(inputPath);
        if (isVideo) {
            ff.outputOptions([
                '-vcodec', 'libwebp',
                '-vf', "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease,fps=15,pad=512:512:(512-iw)/2:(512-ih)/2:color=white@0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse",
                '-loop', '0',
                '-ss', '00:00:00',
                '-t', '00:00:06',
                '-preset', 'default',
                '-an',
                '-vsync', '0'
            ]);
        } else {
            ff.outputOptions([
                '-vcodec', 'libwebp',
                '-vf', "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease,pad=512:512:(512-iw)/2:(512-ih)/2:color=white@0"
            ]);
        }

        ff.toFormat('webp')
          .save(outputPath)
          .on('end', () => {
              const webpBuffer = fs.readFileSync(outputPath);
              fs.unlinkSync(inputPath);
              fs.unlinkSync(outputPath);
              resolve(webpBuffer);
          })
          .on('error', (err) => {
              if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
              if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
              reject(err);
          });
    });
}

async function igdl(url) {
    let data = JSON.stringify({ url, type: 'video' });
    const res = await axios.post('https://vdraw.ai/api/v1/instagram/ins-info', data, {
        headers: { 'Content-Type': 'application/json' },
    });
    return res.data?.data;
}

async function searchTikTok(query) {
    const { data } = await axios.get('https://tikwm.com/api/feed/search', {
        params: { keywords: query, count: 1 },
        timeout: 20000
    });
    if (!data || data.code !== 0 || !data.data?.videos?.length) throw 'Hasil tidak ditemukan';
    const v = data.data.videos[0];
    return `https://www.tiktok.com/@${v.author.unique_id}/video/${v.video_id}`;
}

async function getTikTok(url) {
    const { data } = await axios.get('https://tikwm.com/api/', {
        params: { url, hd: 1 },
        timeout: 20000
    });
    if (!data || data.code !== 0) throw 'Gagal mengambil data TikTok';
    return data.data;
}

function formatNumber(num = 0) { return num.toLocaleString(); }
function pickRandom(list) { return list[Math.floor(Math.random() * list.length)]; }

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.suit = sock.suit || {};

    // LOGIN VIA PAIRING SYSTEM
    if (!sock.authState.creds.registered) {
        console.clear();
        console.log("\x1b[36m%s\x1b[0m", "  _  _ _  _    ___ _  _ ___  ____ ____ ");
        console.log("\x1b[36m%s\x1b[0m", "  |_/   \\/  __  |  \\_/  |__] |___ |__/ ");
        console.log("\x1b[34m%s\x1b[0m", "  /__ _ /       |   |   |__] |___ |  \\ ");
        console.log("\x1b[33m%s\x1b[0m", "=======================================");
        console.log("");
        
        const phoneNumber = await question('\x1b[37m[?] Masukkan Nomor WhatsApp Bot Anda (Contoh: 628xxx): \x1b[0m');
        
        // Meminta kode asli dari WhatsApp Server agar session key tidak rusak/Bad MAC
        const realCode = await sock.requestPairingCode(phoneNumber.trim());
        
        console.clear();
        console.log("\x1b[36m%s\x1b[0m", "=======================================");
        console.log("\x1b[32m%s\x1b[0m", "      RIJAL - MULTI DEVICE PAIRING     ");
        console.log("\x1b[36m%s\x1b[0m", "=======================================");
        console.log("\n[!] Menghubungkan sistem keamanan kode...");
        
        // Tampilan Visual Custom Sesuai Request Kamu
        console.log("\x1b[33m%s\x1b[0m", "\n----------------------------------------");
        console.log(` \x1b[42m\x1b[30m KODE PAIRING ANDA :  ZALLTMPN  \x1b[0m`);
        console.log("\x1b[33m%s\x1b[0m", "----------------------------------------");
        console.log(`\n\x1b[36m💡 [INFO LOG] Karena enkripsi sistem WhatsApp,\n   Silakan masukkan kode resmi ini jika dibutuhkan:\n   ➔ \x1b[44m\x1b[37m  ${realCode}  \x1b[0m\n`);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.clear();
            console.log("\x1b[32m%s\x1b[0m", "===============================================");
            console.log("\x1b[32m%s\x1b[0m", "  ⚡ BOT RIJAL-MULTI DEVICE BERHASIL TERHUBUNG! ⚡ ");
            console.log("\x1b[32m%s\x1b[0m", "===============================================");
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const rawSender = m.key.participant || m.key.remoteJid;
        const sender = rawSender.split(':')[0].split('@')[0];
        
        const msgType = Object.keys(m.message)[0];
        const msgContent = m.message[msgType];

        checkUserDb(sender);

        let body = '';
        if (msgType === 'conversation') body = m.message.conversation;
        else if (msgType === 'extendedTextMessage') body = m.message.extendedTextMessage.text;
        else if (msgType === 'imageMessage' || msgType === 'videoMessage') body = msgContent.caption;

        // Handler game suit pvp
        if (body && !m.key.fromMe) {
            let room = Object.values(sock.suit).find(room => room.id && room.status && [room.p.split('@')[0], room.p2.split('@')[0]].includes(sender));
            if (room) {
                let win = ''; let tie = false;
                const pClean = room.p.split('@')[0]; const p2Clean = room.p2.split('@')[0];

                if (sender === p2Clean && /^(acc(ept)?|terima|gas|oke?|tolak|gamau|nanti|ga(k.)?bisa)/i.test(body) && isGroup && room.status === 'wait') {
                    if (/^(tolak|gamau|nanti|ga(k.)?bisa)/i.test(body)) {
                        await sock.sendMessage(from, { text: `@${p2Clean} menolak suit, suit dibatalkan` }, { quoted: m });
                        clearTimeout(room.waktu); delete sock.suit[room.id]; return;
                    }
                    room.status = 'play'; room.asal = from; clearTimeout(room.waktu);
                    await sock.sendMessage(from, { text: `Suit telah dikirimkan ke private chat\n@${pClean} dan \n@${p2Clean}\n\nSilahkan pilih di private chat!`, mentions: [room.p, room.p2] });
                    const instruksiSuit = `*[ S U I T   P V P ]*\n\n👉 *GUNTING*\n👉 *BATU*\n👉 *KERTAS*`;
                    await sock.sendMessage(room.p, { text: instruksiSuit }); await sock.sendMessage(room.p2, { text: instruksiSuit });
                }

                let jwb = sender === pClean; let jwb2 = sender === p2Clean; let reg = /^(gunting|batu|kertas)/i;
                if (jwb && reg.test(body) && !room.pilih && !isGroup) {
                    room.pilih = reg.exec(body.toLowerCase())[0]; room.text = body;
                    await sock.sendMessage(room.p, { text: `Kamu memilih *${body}*` });
                }
                if (jwb2 && reg.test(body) && !room.pilih2 && !isGroup) {
                    room.pilih2 = reg.exec(body.toLowerCase())[0]; room.text2 = body;
                    await sock.sendMessage(room.p2, { text: `Kamu memilih *${body}*` });
                }

                if (room.pilih && room.pilih2) {
                    let g = /gunting/i, b = /batu/i, k = /kertas/i;
                    let stage = room.pilih, stage2 = room.pilih2;
                    if (b.test(stage) && g.test(stage2)) win = room.p;
                    else if (b.test(stage) && k.test(stage2)) win = room.p2;
                    else if (g.test(stage) && k.test(stage2)) win = room.p;
                    else if (g.test(stage) && b.test(stage2)) win = room.p2;
                    else if (k.test(stage) && b.test(stage2)) win = room.p;
                    else if (k.test(stage) && g.test(stage2)) win = room.p2;
                    else if (stage === stage2) tie = true;

                    let hasilTeks = `*═ [ HASIL SUIT PvP ] ═*\n\n`;
                    if (tie) hasilTeks += `➔ HASIL: *SERI* 🤝\n\n`;
                    hasilTeks += `@${pClean} (${room.text}) ${tie ? '' : room.p === win ? '👉 *MENANG*' : '👉 *KALAH*'}\n`;
                    hasilTeks += `@${p2Clean} (${room.text2}) ${tie ? '' : room.p2 === win ? '👉 *MENANG*' : '👉 *KALAH*'}`;
                    await sock.sendMessage(room.asal, { text: hasilTeks, mentions: [room.p, room.p2] });
                    delete sock.suit[room.id];
                }
            }
        }

        if (!body) return;

        const prefix = /^[./!#]/gi.test(body) ? body.match(/^[./!#]/gi)[0] : '#';
        const isCmd = body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : '';
        const args = body.trim().split(/ +/).slice(1);
        const text = args.join(' ');

        const isOwner = sender === OWNER_NUMBER;

        let isAdmins = false;
        let isBotAdmins = false;
        let participants = [];
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                participants = groupMetadata.participants;
                const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                isAdmins = participants.some(p => p.id === rawSender && (p.admin === 'admin' || p.admin === 'superadmin'));
                isBotAdmins = participants.some(p => p.id === botId && (p.admin === 'admin' || p.admin === 'superadmin'));
            } catch (e) { }
        }

        const quoted = msgType === 'extendedTextMessage' && m.message.extendedTextMessage.contextInfo ? m.message.extendedTextMessage.contextInfo : null;
        const quotedText = quoted && quoted.quotedMessage ? (quoted.quotedMessage.conversation || quoted.quotedMessage.extendedTextMessage?.text || quoted.quotedMessage.imageMessage?.caption) : null;
        const mime = quoted && quoted.quotedMessage ? Object.keys(quoted.quotedMessage)[0] : '';

        const react = async (emoji) => {
            await sock.sendMessage(from, { react: { text: emoji, key: m.key } });
        };
        
        const replyWait = async () => {
            await sock.sendMessage(from, { text: "Sabar ya ganteng, ini lagi di proses 😆" }, { quoted: m });
        };

        if (isCmd) {
            console.log(`\x1b[35m🔥 [COMMAND]\x1b[0m User: ${sender} | Executed: ${prefix}${command}`);
        }

        const aiMakerRegex = /^(tobotak|tochibi|tofunk|tofigura|tofigurav2|tofigurav3|toghibli|tohijab|tojapanese|tojepang|tokacamata|tokamboja|tolego|toliquor|tomaid|tomirror|tomoai|tomonyet|topacar|topeci|topiramida|toputih|toreal|toroblox|toroh|totato|totua|toviking|tozombie|tounderground|tohitam)$/i;
        if (aiMakerRegex.test(command)) {
            let currentMime = m.quoted ? Object.keys(m.quoted.quotedMessage)[0] : msgType;

            if (!/imageMessage/.test(currentMime)) {
                return sock.sendMessage(from, { text: `✨ *AI IMAGE CONVERTER*\n\nReply/Kirim gambar dengan caption *${prefix + command}*` }, { quoted: m });
            }

            try {
                await replyWait();
                await react("✨");

                let targetMedia = m.quoted ? m.quoted.quotedMessage.imageMessage : m.message.imageMessage;
                let buffer = await downloadMedia(targetMedia, 'image');
                let filename = `faa_${Date.now()}.jpg`;

                let imageUrl = await uploadTelegraph(buffer, filename);
                if (!imageUrl) return sock.sendMessage(from, { text: "❌ Upload media ke server gagal!" }, { quoted: m });

                let apiUrl = `https://api-faa.my.id/faa/${command}?url=${encodeURIComponent(imageUrl)}`;
                let resBuffer = await getBuffer(apiUrl);
                if (!resBuffer) return sock.sendMessage(from, { text: "❌ Sistem API sedang error, coba lagi nanti." }, { quoted: m });

                await sock.sendMessage(from, { image: resBuffer, caption: `✨ Sukses convert ke gaya *${command}*!` }, { quoted: m });
                await react("✅");
            } catch (err) {
                console.error(err);
                await react("❌");
            }
            return;
        }

        switch (command) {
            case 'menu':
            case 'help': {
                await react('👋');
                
                const uploadedMedia = await prepareWAMessageMedia(
                    { image: { url: 'https://files.catbox.moe/4mfccw.jpeg' } },
                    { upload: sock.waUploadToServer }
                );

                const sections = [
                    {
                        title: "🎨 STICKER MENU",
                        rows: [
                            { title: "Brat Sticker", rowId: `${prefix}brat`, description: "Membuat stiker tulisan bercak hitam (.brat <teks>)" },
                            { title: "Brat HD Sticker", rowId: `${prefix}brathd`, description: "Membuat stiker brat versi kualitas HD (.brathd <teks>)" },
                            { title: "Regular Sticker", rowId: `${prefix}s`, description: "Mengubah foto/video jadi stiker biasa (Reply media dengan .s)" }
                        ]
                    },
                    {
                        title: "📡 SALURAN MENU",
                        rows: [
                            { title: "Cek ID Channel", rowId: `${prefix}cekidch`, description: "Cek data informasi ID Channel WhatsApp (.cekidch <link>)" },
                            { title: "Create Channel", rowId: `${prefix}createch`, description: "Membuat Saluran WA baru (.createch <nama>|<deskripsi>) [Owner]" }
                        ]
                    },
                    {
                        title: "📥 DOWNLOADER MENU",
                        rows: [
                            { title: "Instagram Downloader", rowId: `${prefix}ig`, description: "Download video Reels / Postingan Foto Instagram" },
                            { title: "TikTok Downloader", rowId: `${prefix}tt`, description: "Download video atau slide foto TikTok tanpa watermark" }
                        ]
                    },
                    {
                        title: "👥 GROUP MENU",
                        rows: [
                            { title: "HideTag", rowId: `${prefix}hidetag`, description: "Tag seluruh member grup secara rahasia (.hidetag <teks>)" },
                            { title: "Promote", rowId: `${prefix}promote`, description: "Menaikkan member menjadi admin grup (.promote @tag)" },
                            { title: "Demote", rowId: `${prefix}demote`, description: "Menurunkan admin menjadi member (.demote @tag)" },
                            { title: "Kick Member", rowId: `${prefix}kick`, description: "Mengeluarkan seseorang dari grup (.kick @tag)" }
                        ]
                    },
                    {
                        title: "🎮 GAME MENU",
                        rows: [
                            { title: "Suit PvP Game", rowId: `${prefix}suitpvp`, description: "Tantang temanmu adu Gunting Batu Kertas (.suitpvp @tag)" },
                            { title: "Slot Machine Game", rowId: `${prefix}slot`, description: "Uji keberuntunganmu di mesin slot virtual (.slot <angka>)" }
                        ]
                    },
                    {
                        title: "🛠️ MAKER MENU",
                        rows: [
                            { title: "iPhone Quoted Chat (IQC)", rowId: `${prefix}iqc`, description: "Ubah teks chat menjadi visual gelembung iPhone (.iqc <teks>)" },
                            { title: "AI Image Filters", rowId: `${prefix}tohitam`, description: "Lihat petunjuk pengubah foto AI (30+ variasi filter)" }
                        ]
                    },
                    {
                        title: "📱 SOSIAL MEDIA",
                        rows: [
                            { title: "Official TikTok Owner", rowId: `${prefix}owner-tt`, description: "Buka profil TikTok ZYY-CYBER (@zyyzall)" },
                            { title: "Official Instagram Owner", rowId: `${prefix}owner-ig`, description: "Buka profil Instagram ZYY-CYBER (@abcdeezall)" },
                            { title: "Saluran WhatsApp Resmi", rowId: `${prefix}owner-channel`, description: "Gabung ke Saluran informasi update WhatsApp Bot" }
                        ]
                    }
                ];

                const listMessage = {
                    title: "⚡ RIJAL-MULTI DEVICE LIST MENU ⚡",
                    description: "Silahkan klik tombol di bawah ini untuk memunculkan panel fitur praktis!",
                    buttonText: "Klik di Sini Untuk Menu",
                    sections
                };

                const msg = generateWAMessageFromContent(from, {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: "Selamat Datang di RIJAL-MULTI DEVICE Bot!\n\nSilahkan pilih menu pada tombol daftar di bawah." },
                                footer: { text: "Powered by Baileys MD • 2026" },
                                header: {
                                    hasVideoMessage: false,
                                    imageMessage: uploadedMedia.imageMessage,
                                    title: "RIJAL-MULTI DEVICE",
                                    subtitle: "Bot Menu"
                                },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: "single_select",
                                            buttonParamsJson: JSON.stringify(listMessage)
                                        }
                                    ],
                                    messageVersion: 1
                                }
                            }
                        }
                    }
                }, { quoted: m });

                await sock.relayMessage(from, msg.message, { messageId: msg.key.id });
                break;
            }

            case 'owner-tt':
                await sock.sendMessage(from, { text: "Link TikTok Owner:\n👉 https://www.tiktok.com/@zyyzall" }, { quoted: m });
                break;
            case 'owner-ig':
                await sock.sendMessage(from, { text: "Link Instagram Owner:\n👉 https://www.instagram.com/abcdeezall" }, { quoted: m });
                break;
            case 'owner-channel':
                await sock.sendMessage(from, { text: "Link Saluran WhatsApp Resmi:\n👉 https://whatsapp.com/channel/0029Vb8F5QwLCoWyFrBbFz0v" }, { quoted: m });
                break;

            case 'cekidch':
            case 'idch': {
                const input = text || quotedText;
                if (!input) return sock.sendMessage(from, { text: "⚠️ Masukkan minimal 1 link channel WhatsApp!" }, { quoted: m });
                
                await replyWait();
                const links = input.split(/\s+/).slice(0, 10);
                let captionArr = [];

                for (let link of links) {
                    if (!link.includes("https://whatsapp.com/channel/")) {
                        captionArr.push(`[ ! ] Link tidak valid: ${link}`);
                        continue;
                    }
                    let idPart = link.split('https://whatsapp.com/channel/')[1];
                    try {
                        let res = await sock.newsletterMetadata("invite", idPart);
                        captionArr.push(
                            `*${res.name || "Tanpa Nama"}*\n` +
                            `• ID Channel: ${res.id}\n` +
                            `• Pengikut: ${res.subscribers || 0}\n` +
                            `• Verifikasi: ${res.verification || "–"}\n` +
                            `• State: ${res.state || "–"}\n`
                        );
                    } catch (err) {
                        captionArr.push(`[ x ] Gagal cek channel: ${link}`);
                    }
                }
                await sock.sendMessage(from, { text: captionArr.join("\n\n") }, { quoted: m });
                break;
            }

            case 'createch':
            case 'createchannel': {
                if (!isOwner) return sock.sendMessage(from, { text: "Perintah ini khusus Owner Bot saja!" }, { quoted: m });
                if (!text) return sock.sendMessage(from, { text: "📛 *Gunakan format:*\n.createch <nama>|<deskripsi>" }, { quoted: m });

                let [name, desc] = text.split("|");
                if (!name) return sock.sendMessage(from, { text: "❌ Harap tuliskan nama channel." }, { quoted: m });
                desc = desc ? desc.trim() : "Tidak ada deskripsi.";

                await replyWait();
                await react("👁️‍🗨️");

                let imageUrl = "https://files.catbox.moe/xpntd8.jpg"; 
                let currentMime = m.quoted ? Object.keys(m.quoted.quotedMessage)[0] : msgType;

                if (/imageMessage/.test(currentMime)) {
                    try {
                        let targetMedia = m.quoted ? m.quoted.quotedMessage.imageMessage : m.message.imageMessage;
                        let mediaBuffer = await downloadMedia(targetMedia, 'image');
                        let uploadedUrl = await uploadTelegraph(mediaBuffer, `avatar_${Date.now()}.jpg`);
                        if (uploadedUrl) imageUrl = uploadedUrl;
                    } catch (e) {
                        console.error(e);
                    }
                }

                try {
                    const newsletter = await sock.newsletterCreate(name.trim(), desc, { url: imageUrl });
                    const invite = newsletter?.invite || "❌ Tidak tersedia";
                    const id = newsletter?.id || "❓";
                    let bufferImg = await getBuffer(imageUrl);

                    await sock.sendMessage(from, {
                        text: `✅ *Channel Berhasil Dibuat!*\n\n📡 *Nama:* ${name}\n📝 *Deskripsi:* ${desc}\n🆔 *ID:* ${id}\n🔗 *Link:* https://whatsapp.com/channel/${invite}`,
                        contextInfo: {
                            externalAdReply: {
                                title: name,
                                body: "Channel berhasil dibuat via RIJAL-MULTI DEVICE System",
                                sourceUrl: `https://whatsapp.com/channel/${invite}`,
                                thumbnail: bufferImg,
                                mediaType: 1,
                                renderLargerThumbnail: true,
                            },
                        },
                    }, { quoted: m });
                } catch (err) {
                    console.error(err);
                    sock.sendMessage(from, { text: "✖️ *Gagal membuat channel.* Akun nomor bot belum memenuhi syarat fitur WhatsApp." }, { quoted: m });
                }
                break;
            }

            case 'hidetag':
            case 'ht': {
                if (!isGroup) return sock.sendMessage(from, { text: "Fitur ini hanya untuk di dalam grup!" }, { quoted: m });
                if (!isAdmins && !isOwner) return sock.sendMessage(from, { text: "Hanya Admin grup yang bisa hidetag!" }, { quoted: m });
                
                let message = text || quotedText;
                if (!message) return sock.sendMessage(from, { text: 'Kirim teks atau reply pesan untuk dihidetag.' }, { quoted: m });

                await replyWait();
                let member = participants.map(u => u.id);
                await sock.sendMessage(from, { text: message, mentions: member });
                break;
            }

            case 'promote': {
                if (!isGroup) return sock.sendMessage(from, { text: "Fitur ini khusus Grup!" }, { quoted: m });
                if (!isAdmins && !isOwner) return sock.sendMessage(from, { text: "Kamu bukan admin!" }, { quoted: m });
                if (!isBotAdmins) return sock.sendMessage(from, { text: "Jadikan bot sebagai admin terlebih dahulu!" }, { quoted: m });

                let user = m.quoted?.sender || m.mentionedJid?.[0] || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!user) return sock.sendMessage(from, { text: 'Tag atau reply user yang mau di-promote.' }, { quoted: m });

                await replyWait();
                await sock.groupParticipantsUpdate(from, [user], 'promote');
                await sock.sendMessage(from, { text: `✅ Berhasil menaikkan @${user.split('@')[0]} menjadi admin grup.`, mentions: [user] }, { quoted: m });
                break;
            }

            case 'demote': {
                if (!isGroup) return sock.sendMessage(from, { text: "Fitur ini khusus Grup!" }, { quoted: m });
                if (!isAdmins && !isOwner) return sock.sendMessage(from, { text: "Kamu bukan admin!" }, { quoted: m });
                if (!isBotAdmins) return sock.sendMessage(from, { text: "Jadikan bot sebagai admin terlebih dahulu!" }, { quoted: m });

                let user = m.quoted?.sender || m.mentionedJid?.[0] || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!user) return sock.sendMessage(from, { text: 'Tag atau reply user yang mau di-demote.' }, { quoted: m });

                await replyWait();
                await sock.groupParticipantsUpdate(from, [user], 'demote');
                await sock.sendMessage(from, { text: `⬇️ Berhasil menurunkan @${user.split('@')[0]} dari admin grup.`, mentions: [user] }, { quoted: m });
                break;
            }

            case 'kick': {
                if (!isGroup) return sock.sendMessage(from, { text: "Fitur ini khusus Grup!" }, { quoted: m });
                if (!isAdmins && !isOwner) return sock.sendMessage(from, { text: "Kamu bukan admin!" }, { quoted: m });
                if (!isBotAdmins) return sock.sendMessage(from, { text: "Jadikan bot sebagai admin terlebih dahulu!" }, { quoted: m });

                let user = m.quoted?.sender || m.mentionedJid?.[0] || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!user) return sock.sendMessage(from, { text: 'Tag atau reply user yang mau dikeluarkan.' }, { quoted: m });
                if (user.split('@')[0] === sender) return sock.sendMessage(from, { text: 'Gak bisa mengeluarkan diri sendiri!' }, { quoted: m });

                await replyWait();
                await sock.groupParticipantsUpdate(from, [user], 'remove');
                await sock.sendMessage(from, { text: `Berhasil mengeluarkan @${user.split('@')[0]} dari grup.`, mentions: [user] }, { quoted: m });
                break;
            }

            case 'iqc':
            case 'fakeiphonechat': {
                let shortcut = text || quotedText;
                if (!shortcut) return sock.sendMessage(from, { text: `*🧩 Masukkan teks!*\n*Contoh: ${prefix + command} info kangg*` }, { quoted: m });

                try {
                    await replyWait();
                    await react('⏳');
                    let iqcUrl = `https://brat.siputzx.my.id/iphone-quoted?time=12.00&batteryPercentage=90&carrierName=AXIS&messageText=${encodeURIComponent(shortcut)}&emojiStyle=apple`;
                    let bufferImg = await getBuffer(iqcUrl);

                    await sock.sendMessage(from, { image: bufferImg, caption: '*✨ iPhone chat berhasil dibuat*' }, { quoted: m });
                } catch (err) {
                    console.error(err);
                }
                break;
            }

            case 'ig':
            case 'igdl': {
                const input = quotedText ? quotedText : text;
                const regex = /(https?:\/\/(?:www\.)?instagram\.com\/(p|reel)\/[a-zA-Z0-9_-]+\/?)/;
                const parseUrl = input?.match(regex)?.[0];

                if (!parseUrl) return sock.sendMessage(from, { text: `Ketik URL Instagram secara benar.\nContoh: *${prefix + command} https://www.instagram.com/reel/xxxxx*` }, { quoted: m });

                try {
                    await replyWait(); await react('🕒');
                    const res = await igdl(parseUrl);
                    if (!res || res.error) return sock.sendMessage(from, { text: 'Gagal mengambil konten dari Instagram~' }, { quoted: m });

                    const result = res.info;
                    if (res.media_type === 'photo') {
                        for (let item of result) await sock.sendMessage(from, { image: { url: item.url } }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { video: { url: result[0].url }, caption: 'Sukses!' }, { quoted: m });
                    }
                    await react('✅');
                } catch (err) {
                    await react('❌');
                }
                break;
            }

            case 'tt':
            case 'tiktok': {
                const input = quotedText ? quotedText : text;
                if (!input) return sock.sendMessage(from, { text: `Contoh:\n${prefix + command} https://vt.tiktok.com/xxxx` }, { quoted: m });
                
                try {
                    await replyWait(); await react('✨');
                    let url = input;
                    if (!/^https?:\/\//i.test(input)) url = await searchTikTok(input);

                    const res = await getTikTok(url);
                    const caption = `# *TIKTOK DOWNLOADER*\n\n> *Judul*: ${res.title || '-'}\n> *Views*: ${formatNumber(res.play_count || 0)}`;

                    if (Array.isArray(res.images) && res.images.length > 0) {
                        for (const img of res.images) await sock.sendMessage(from, { image: { url: img } }, { quoted: m });
                    } else if (res.play) {
                        await sock.sendMessage(from, { video: { url: res.play }, caption }, { quoted: m });
                    }
                    await react('✅');
                } catch (e) {
                    await react('❌');
                }
                break;
            }

            case 'slot': {
                let user = global.db.data.users[sender];
                if (args.length < 1 || isNaN(args[0]) || args[0] <= 0) return sock.sendMessage(from, { text: `Format: *${prefix}${command} [jumlah taruhan]*` }, { quoted: m });

                let count = parseInt(args[0]);
                if (user.money < count) return sock.sendMessage(from, { text: 'Uang kamu tidak cukup.' }, { quoted: m });

                try {
                    await replyWait();
                    let symbols = ['🍊', '🍇', '🍉', '🍌', '🍍'];
                    let spins = Array.from({ length: 9 }, () => pickRandom(symbols));
                    user.money -= count;

                    let isWin = spins[3] === spins[4] && spins[4] === spins[5];
                    let reward = isWin ? count * 3 : 0;
                    user.money += reward;

                    let resText = `*🎰 VIRTUAL SLOTS 🎰*\n\n${spins.slice(0, 3).join('|')}\n${spins.slice(3, 6).join('|')} <<==\n${spins.slice(6).join('|')}\n\n*${isWin ? 'JACKPOT 🥳' : 'KALAH 🥶'}*\nSaldo Anda: Rp ${user.money}`;
                    await sock.sendMessage(from, { text: resText }, { quoted: m });
                } catch (e) {}
                break;
            }

            case 'suitpvp': {
                if (!isGroup) return sock.sendMessage(from, { text: 'Hanya bisa di dalam grup!' }, { quoted: m });
                let who = m.mentionedJid && m.mentionedJid[0] ? m.mentionedJid[0] : null;
                if (!who) return sock.sendMessage(from, { text: 'Tag orang yang ingin ditantang!' }, { quoted: m });

                let id = "suit_" + (new Date() * 1);
                sock.suit[id] = {
                    id, p: rawSender, p2: who, status: "wait",
                    asal: from, timeout: 60000, poin: 500, poin_lose: -100,
                    waktu: setTimeout(() => { delete sock.suit[id]; }, 60000)
                };
                await sock.sendMessage(from, { text: `@${sender} menantang @${who.split('@')[0]} main suit.\n\nKetik *terima* / *gas* untuk mulai!`, mentions: [rawSender, who] }, { quoted: m });
                break;
            }

            case 'brat': {
                let shortcut = quotedText ? quotedText : text;
                if (!shortcut) return sock.sendMessage(from, { text: `Contoh: ${prefix}brat halo` }, { quoted: m });
                try {
                    await replyWait(); await react('🕒');
                    const rawBuffer = await getBuffer(`https://aqul-brat.hf.space?text=${encodeURIComponent(shortcut)}`);
                    const stickerBuffer = await convertToSticker(rawBuffer, false);
                    await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
                    await react('✅');
                } catch (e) { await react('❌'); }
                break;
            }

            case 'brathd': {
                let shortcut = quotedText ? quotedText : text;
                if (!shortcut) return sock.sendMessage(from, { text: `Contoh: ${prefix}brathd halo` }, { quoted: m });
                try {
                    await replyWait(); await react('🕒');
                    const rawBuffer = await getBuffer(`https://api-faa.my.id/faa/brathd?text=${encodeURIComponent(shortcut)}`);
                    const stickerBuffer = await convertToSticker(rawBuffer, false);
                    await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
                    await react('✅');
                } catch (e) { await react('❌'); }
                break;
            }

            case 's':
            case 'sticker': {
                let isMedia = /image|video/.test(msgType);
                let isQuotedMedia = mime && /imageMessage|videoMessage/.test(mime);

                if (isMedia || isQuotedMedia) {
                    try {
                        await replyWait(); await react('🕒');
                        let targetMessage = isMedia ? m.message : quoted.quotedMessage;
                        let targetType = isMedia ? msgType : Object.keys(quoted.quotedMessage)[0];
                        let mediaMessage = targetMessage[targetType];

                        let rawBuffer = await downloadMedia(mediaMessage, targetType.replace('Message', ''));
                        let stickerBuffer = await convertToSticker(rawBuffer, targetType === 'videoMessage');
                        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
                        await react('✅');
                    } catch (e) { await react('❌'); }
                } else {
                    sock.sendMessage(from, { text: 'Balas foto atau video dengan teks .s' }, { quoted: m });
                }
                break;
            }

            case 'addmoney': {
                if (!isOwner) return;
                let target = m.mentionedJid && m.mentionedJid[0] ? m.mentionedJid[0].split('@')[0] : sender;
                let nominal = parseInt(args[0]) || 10000;
                checkUserDb(target);
                global.db.data.users[target].money += nominal;
                await sock.sendMessage(from, { text: `Sukses menambahkan Rp ${nominal.toLocaleString()}` }, { quoted: m });
                break;
            }
        }
    });
}

startBot();

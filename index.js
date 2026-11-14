const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const axios = require('axios');
const FormData = require('form-data');

const TELEGRAM_BOT_TOKEN = '9125543698:AAE6DE7PPNKhUE6Eg0bw1bi5-KPfsVGEQ4A';
const TELEGRAM_CHAT_ID = '7512451863';

// QR কোড ইমেজ বানিয়ে টেলিগ্রামে পাঠানোর ফাংশন
async function sendQRToTelegram(qrString) {
    try {
        const buffer = await QRCode.toBuffer(qrString);
        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('photo', buffer, { filename: 'qrcode.png' });
        form.append('caption', '📱 WhatsApp QR কোড চলে এসেছে! দ্রুত আপনার ফোন দিয়ে এটি স্ক্যান করুন।');

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, form, {
            headers: form.getHeaders()
        });
        console.log('✅ QR কোড টেলিগ্রামে সফলভাবে পাঠানো হয়েছে!');
    } catch (error) {
        console.error('❌ টেলিগ্রামে QR পাঠাতে সমস্যা হয়েছে:', error.response ? error.response.data : error.message);
    }
}

// ফাইল টেলিগ্রামে পাঠানোর ফাংশন
async function sendToTelegram(buffer, fileName, caption) {
    try {
        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('document', buffer, { filename: fileName });
        if (caption) {
            form.append('caption', caption);
        }

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
        console.log(`✅ ফাইল টেলিগ্রামে পাঠানো হয়েছে: ${fileName}`);
    } catch (error) {
        console.error('❌ টেলিগ্রামে ফাইল পাঠাতে সমস্যা হয়েছে:', error.response ? error.response.data : error.message);
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('নতুন QR কোড জেনারেট হয়েছে, টেলিগ্রামে পাঠানো হচ্ছে...');
            await sendQRToTelegram(qr);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('কানেকশন বিচ্ছিন্ন হয়েছে, আবার চেষ্টা করা হচ্ছে...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('🚀 WhatsApp সফলভাবে কানেক্ট হয়েছে!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe || !msg.message) continue;

            // সব ধরনের ভিউ ওয়ান্স এবং সাধারণ মেসেজ ফরম্যাট আনর্যাপ করা
            let messageContent = msg.message;
            if (messageContent.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;
            if (messageContent.viewOnceMessage) messageContent = messageContent.viewOnceMessage.message;
            if (messageContent.viewOnceMessageV2) messageContent = messageContent.viewOnceMessageV2.message;
            if (messageContent.viewOnceMessageV2Extension) messageContent = messageContent.viewOnceMessageV2Extension.message;

            const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
            const messageType = mediaTypes.find(type => messageContent && messageContent[type]);

            if (messageType) {
                try {
                    const sender = msg.pushName || msg.key.remoteJid.split('@')[0];
                    const mediaObj = messageContent[messageType];
                    
                    let fileName = mediaObj.fileName;
                    if (!fileName) {
                        const mime = mediaObj.mimetype || 'application/octet-stream';
                        const ext = mime.split('/')[1]?.split(';')[0] || 'bin';
                        fileName = `WA_ViewOnce_${Date.now()}.${ext}`;
                    }

                    const caption = `📩 **নতুন ফাইল/1-View ছবি এসেছে**\n👤 প্রেরক: ${sender}\n📝 ক্যাপশন: ${mediaObj.caption || 'নেই'}`;

                    console.log(`📥 ফাইল বা ভিউ ওয়ান্স মিডিয়া ডাউনলোড হচ্ছে: ${fileName}...`);

                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { logger: pino({ level: 'silent' }) }
                    );

                    await sendToTelegram(buffer, fileName, caption);

                } catch (err) {
                    console.error('ভিউ ওয়ান্স বা মিডিয়া প্রসেস করতে সমস্যা হয়েছে:', err);
                }
            }
        }
    });
}

connectToWhatsApp();

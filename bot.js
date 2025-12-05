require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    Partials,
    ChannelType,
    Collection
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');

// Konfigürasyon - RAILWAY İÇİN GÜNCELLENDİ
const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    guildId: process.env.GUILD_ID,
    verifiedChannelId: process.env.VERIFIED_CHANNEL_ID,
    logChannelId: process.env.LOG_CHANNEL_ID,
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID,
    unregisteredRoleId: process.env.UNREGISTERED_ROLE_ID,
    lamerRoleId: process.env.LAMER_ROLE_ID,
    memberRoleId: process.env.MEMBER_ROLE_ID,
    vipRoleId: process.env.VIP_ROLE_ID,
    // RAILWAY DOMAINİ BURAYA
    redirectUri: process.env.REDIRECT_URI || 'https://discord-verified-bot-production.up.railway.app/callback',
    port: process.env.PORT || 3000,
    sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    verificationTimeout: parseInt(process.env.VERIFICATION_TIMEOUT) || 600,
    maxAttempts: parseInt(process.env.MAX_ATTEMPTS) || 3
};

// Doğrulama verilerini saklamak için
const userAttempts = new Map();

// Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User]
});

// Koleksiyonlar
client.verificationMessages = new Collection();
client.pendingVerifications = new Collection();

// Bot hazır olduğunda
client.once('ready', async () => {
    console.log(`🎉 ${client.user.tag} Railway'de çalışıyor!`);
    console.log(`🌐 Domain: https://discord-verified-bot-production.up.railway.app`);
    console.log(`🔗 Callback: ${config.redirectUri}`);
    
    // Bot durumu
    client.user.setPresence({
        activities: [{
            name: 'Doğrulama Sistemi',
            type: 3
        }],
        status: 'online'
    });
    
    console.log('✅ Bot hazır!');
});

// Yeni üye katılınca
client.on('guildMemberAdd', async (member) => {
    try {
        if (member.guild.id !== config.guildId) return;
        
        console.log(`👤 Yeni üye: ${member.user.tag}`);
        
        // Verified kanalını bul
        const verifiedChannel = member.guild.channels.cache.get(config.verifiedChannelId);
        if (!verifiedChannel || verifiedChannel.type !== ChannelType.GuildText) {
            console.error('❌ Verified kanalı bulunamadı!');
            return;
        }
        
        // Log kanalı
        const logChannel = member.guild.channels.cache.get(config.logChannelId);
        
        // Kayıtsız rolünü ver
        const unregisteredRole = member.guild.roles.cache.get(config.unregisteredRoleId);
        if (unregisteredRole) {
            await member.roles.add(unregisteredRole);
            console.log(`✅ ${member.user.tag} kayıtsız rolü verildi`);
        }
        
        // Premium embed tasarımı
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({
                name: member.guild.name,
                iconURL: member.guild.iconURL({ size: 128, dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png'
            })
            .setTitle('🎉 Sunucuya Hoş Geldin!')
            .setDescription(`**${member.user.username}**, sunucumuza hoş geldin! Devam edebilmek için hesabını doğrulaman gerekiyor.`)
            .addFields(
                {
                    name: '📋 Doğrulama Adımları',
                    value: '1️⃣ **"Doğrulama Başlat"** butonuna tıkla\n2️⃣ Discord hesabına giriş yap\n3️⃣ Otomatik doğrulanacaksın\n4️⃣ Sunucunun tadını çıkar!',
                    inline: false
                },
                {
                    name: '⏱️ Süre',
                    value: `Doğrulama linki **10 dakika** geçerlidir.`,
                    inline: true
                },
                {
                    name: '🔒 Güvenlik',
                    value: 'Linki kimseyle paylaşma!',
                    inline: true
                }
            )
            .setThumbnail(member.user.displayAvatarURL({ size: 256, dynamic: true, format: 'png' }))
            .setFooter({
                text: `${member.guild.name} • Doğrulama Sistemi`,
                iconURL: member.guild.iconURL({ size: 64, dynamic: true }) || null
            })
            .setTimestamp();
        
        // Butonlar
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`verify_start_${member.id}`)
                    .setLabel('🚀 Doğrulama Başlat')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`help_${member.id}`)
                    .setLabel('❓ Yardım')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❔')
            );
        
        // Mesajı gönder
        const message = await verifiedChannel.send({
            content: `||${member}||`,
            embeds: [embed],
            components: [row]
        });
        
        // Mesajı kaydet
        client.verificationMessages.set(member.id, {
            messageId: message.id,
            channelId: verifiedChannel.id,
            timestamp: Date.now()
        });
        
        // Log kanalına bildir
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('📥 Yeni Üye Katıldı')
                .setDescription(`**${member.user.tag}** sunucuya katıldı`)
                .addFields(
                    { name: '👤 Kullanıcı', value: `${member}`, inline: true },
                    { name: '🆔 ID', value: `\`${member.id}\``, inline: true }
                )
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
        
        console.log(`✅ ${member.user.tag} için mesaj gönderildi`);
        
    } catch (error) {
        console.error('❌ Hata:', error);
    }
});

// Buton tıklamalarını işle
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton()) {
            await handleButtonClick(interaction);
        }
    } catch (error) {
        console.error('❌ Interaction hatası:', error);
        if (!interaction.replied) {
            await interaction.reply({ 
                content: '❌ Bir hata oluştu!',
                ephemeral: true 
            });
        }
    }
});

// Buton tıklamalarını işleme
async function handleButtonClick(interaction) {
    const { customId, user, guild } = interaction;
    
    // Doğrulama başlatma butonu
    if (customId.startsWith('verify_start_')) {
        const memberId = customId.split('_')[2];
        
        if (user.id !== memberId) {
            await interaction.reply({ 
                content: '❌ Bu sadece ilgili kişi içindir!',
                ephemeral: true 
            });
            return;
        }
        
        // Deneme kontrolü
        const attempts = userAttempts.get(user.id) || 0;
        if (attempts >= config.maxAttempts) {
            await interaction.reply({
                content: `❌ Çok fazla deneme yaptınız!`,
                ephemeral: true
            });
            return;
        }
        
        // OAuth2 state oluştur
        const state = crypto.randomBytes(16).toString('hex');
        const verificationCode = crypto.randomBytes(6).toString('hex').toUpperCase();
        
        // Doğrulama verilerini kaydet
        client.pendingVerifications.set(state, {
            userId: user.id,
            guildId: guild.id,
            code: verificationCode,
            timestamp: Date.now()
        });
        
        // OAuth2 URL oluştur - RAILWAY DOMAINİ KULLANIYOR
        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&response_type=code&scope=identify&state=${state}&prompt=none`;
        
        // Embed
        const embed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setTitle('🔐 Discord Doğrulama')
            .setDescription('Aşağıdaki linke tıkla ve Discord hesabınla giriş yap:')
            .addFields(
                {
                    name: '🔗 Doğrulama Linki',
                    value: `[TIKLA VE DOĞRULA](${authUrl})`,
                    inline: false
                },
                {
                    name: '⚠️ ÖNEMLİ',
                    value: 'Bu linki **KİMSEYLE** paylaşma!',
                    inline: false
                }
            )
            .setFooter({
                text: 'Link 10 dakika geçerlidir • Güvenli Doğrulama'
            })
            .setTimestamp();
        
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
        
        // Deneme sayısını artır
        userAttempts.set(user.id, attempts + 1);
        
        console.log(`🔗 ${user.tag} için link oluşturuldu`);
    }
    
    // Yardım butonu
    else if (customId.startsWith('help_')) {
        const embed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setTitle('❓ Yardım Merkezi')
            .setDescription('Sorun yaşıyorsan:')
            .addFields(
                {
                    name: '❔ Link çalışmıyor',
                    value: 'Linki kopyalayıp tarayıcıda aç.'
                },
                {
                    name: '❔ Hesabım doğrulanmadı',
                    value: '1-2 dakika bekle, tekrar dene.'
                }
            )
            .setTimestamp();
        
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }
}

// Express sunucusu
const app = express();

// Session middleware
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Railway HTTPS otomatik yapar
}));

// Basit route
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Discord Doğrulama Botu</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    text-align: center;
                    padding: 50px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                .container {
                    background: rgba(255,255,255,0.1);
                    padding: 30px;
                    border-radius: 15px;
                    backdrop-filter: blur(10px);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Discord Doğrulama Botu Çalışıyor!</h1>
                <p>Domain: discord-verified-bot-production.up.railway.app</p>
                <p>Bot: ${client.user?.tag || 'Başlatılıyor...'}</p>
            </div>
        </body>
        </html>
    `);
});

// OAuth Callback endpoint - RAILWAY İÇİN
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code || !state) {
        return res.status(400).send('Geçersiz istek!');
    }
    
    const verificationData = client.pendingVerifications.get(state);
    if (!verificationData) {
        return res.status(400).send('Geçersiz veya süresi dolmuş doğrulama kodu!');
    }
    
    // Süre kontrolü
    if (Date.now() - verificationData.timestamp > config.verificationTimeout * 1000) {
        client.pendingVerifications.delete(state);
        return res.status(400).send('Doğrulama süresi doldu!');
    }
    
    try {
        // Access token al
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', 
            new URLSearchParams({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: config.redirectUri
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
        
        const accessToken = tokenResponse.data.access_token;
        
        // Kullanıcı bilgilerini al
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
        
        const userData = userResponse.data;
        
        // Kullanıcı ID kontrolü
        if (userData.id !== verificationData.userId) {
            return res.status(400).send('Doğrulama başarısız! Yanlış hesap.');
        }
        
        // Discord sunucusunu bul
        const guild = client.guilds.cache.get(verificationData.guildId);
        if (!guild) {
            return res.status(400).send('Sunucu bulunamadı!');
        }
        
        // Üyeyi bul
        const member = await guild.members.fetch(verificationData.userId);
        if (!member) {
            return res.status(400).send('Üye bulunamadı!');
        }
        
        // Doğrulama işlemini tamamla
        await completeVerification(member, guild, state);
        
        // Başarılı sayfası
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Doğrulama Başarılı</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #2ecc71, #27ae60);
                        color: white;
                    }
                    .success {
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 15px;
                        backdrop-filter: blur(10px);
                    }
                </style>
            </head>
            <body>
                <div class="success">
                    <h1>✅ Doğrulama Başarılı!</h1>
                    <p>${member.user.username}, hesabın başarıyla doğrulandı.</p>
                    <p>Artık sunucunun tüm özelliklerine erişebilirsin.</p>
                    <p>Bu pencereyi kapatabilirsin.</p>
                </div>
                <script>
                    setTimeout(() => window.close(), 5000);
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('❌ OAuth hatası:', error);
        res.status(500).send('Doğrulama sırasında bir hata oluştu!');
    }
});

// Doğrulama tamamlama
async function completeVerification(member, guild, state) {
    try {
        // Rolleri değiştir
        const unregisteredRole = guild.roles.cache.get(config.unregisteredRoleId);
        const lamerRole = guild.roles.cache.get(config.lamerRoleId);
        
        if (unregisteredRole && member.roles.cache.has(unregisteredRole.id)) {
            await member.roles.remove(unregisteredRole.id);
        }
        
        if (lamerRole && !member.roles.cache.has(lamerRole.id)) {
            await member.roles.add(lamerRole.id);
        }
        
        // Log kanalına bildir
        const logChannel = guild.channels.cache.get(config.logChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('✅ Doğrulama Başarılı')
                .setDescription(`**${member.user.tag}** doğrulandı`)
                .addFields(
                    { name: '👤 Kullanıcı', value: `${member}`, inline: true },
                    { name: '🎭 Verilen Rol', value: `<@&${config.lamerRoleId}>`, inline: true }
                )
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
        
        // Verified kanalındaki mesajı sil
        const userMessageData = client.verificationMessages.get(member.id);
        if (userMessageData) {
            try {
                const channel = guild.channels.cache.get(userMessageData.channelId);
                if (channel) {
                    const message = await channel.messages.fetch(userMessageData.messageId);
                    await message.delete();
                }
            } catch (err) {
                console.log('Mesaj silinemedi:', err.message);
            }
            client.verificationMessages.delete(member.id);
        }
        
        // Verileri temizle
        client.pendingVerifications.delete(state);
        userAttempts.delete(member.id);
        
        console.log(`✅ ${member.user.tag} doğrulandı!`);
        
    } catch (error) {
        console.error('❌ Doğrulama hatası:', error);
        throw error;
    }
}

// Botu başlat
client.login(config.token).catch(error => {
    console.error('❌ Bot giriş yapamadı:', error);
    process.exit(1);
});

// Express sunucusunu başlat - RAILWAY İÇİN ÖZEL
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web sunucusu ${PORT} portunda çalışıyor`);
    console.log(`🔗 Callback URL: ${config.redirectUri}`);
});

// Hata yakalama
process.on('unhandledRejection', error => {
    console.error('❌ İşlenmeyen hata:', error);
});

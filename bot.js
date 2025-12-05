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

// RENDER KONFİGÜRASYONU
const config = {
    // Discord Bot
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    
    // Sunucu Bilgileri
    guildId: process.env.GUILD_ID,
    verifiedChannelId: process.env.VERIFIED_CHANNEL_ID,
    logChannelId: process.env.LOG_CHANNEL_ID,
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID,
    
    // Rol ID'leri
    unregisteredRoleId: process.env.UNREGISTERED_ROLE_ID,
    lamerRoleId: process.env.LAMER_ROLE_ID,
    memberRoleId: process.env.MEMBER_ROLE_ID,
    vipRoleId: process.env.VIP_ROLE_ID,
    
    // RENDER DOMAIN - BU ÇOK ÖNEMLİ!
    redirectUri: process.env.REDIRECT_URI || 'https://discord-verified-bot-1.onrender.com/callback',
    
    // RENDER Port (10000 kullanır)
    port: process.env.PORT || 10000,
    
    // Güvenlik
    sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    verificationTimeout: 600, // 10 dakika
    maxAttempts: 3
};

// Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User]
});

// Koleksiyonlar
client.verificationMessages = new Collection();
client.pendingVerifications = new Collection();
client.userAttempts = new Collection();

// 🎉 BOT HAZIR
client.once('ready', () => {
    console.log('══════════════════════════════════════════');
    console.log(`✅ ${client.user.tag} RENDER'de Çalışıyor!`);
    console.log(`🌐 Domain: https://discord-verified-bot-1.onrender.com`);
    console.log(`🔗 Callback: ${config.redirectUri}`);
    console.log(`👥 Sunucular: ${client.guilds.cache.size}`);
    console.log('══════════════════════════════════════════');
    
    // Bot durumu
    client.user.setPresence({
        activities: [{
            name: 'Doğrulama Sistemi',
            type: 3 // WATCHING
        }],
        status: 'online'
    });
});

// 👤 YENİ ÜYE KATILINCA
client.on('guildMemberAdd', async (member) => {
    try {
        if (member.guild.id !== config.guildId) return;
        
        console.log(`📥 Yeni üye: ${member.user.tag} (${member.id})`);
        
        // Verified kanalını bul
        const verifiedChannel = member.guild.channels.cache.get(config.verifiedChannelId);
        if (!verifiedChannel || verifiedChannel.type !== ChannelType.GuildText) {
            console.error('❌ Verified kanalı bulunamadı!');
            return;
        }
        
        // Log kanalı
        const logChannel = member.guild.channels.cache.get(config.logChannelId);
        
        // 🎭 Kayıtsız rolünü ver
        const unregisteredRole = member.guild.roles.cache.get(config.unregisteredRoleId);
        if (unregisteredRole) {
            await member.roles.add(unregisteredRole);
            console.log(`✅ ${member.user.tag} kayıtsız rolü verildi`);
        }
        
        // ✨ GÜZEL EMBED TASARIMI
        const embed = new EmbedBuilder()
            .setColor('#5865F2') // Discord mavisi
            .setAuthor({
                name: member.guild.name,
                iconURL: member.guild.iconURL({ size: 128, dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png'
            })
            .setTitle('🎉 Sunucuya Hoş Geldin!')
            .setDescription(`**${member.user.username}**, ${member.guild.name} sunucusuna hoş geldin!\n\nDevam edebilmek için Discord hesabını doğrulaman gerekiyor.`)
            .addFields(
                {
                    name: '📋 **Doğrulama Adımları**',
                    value: '1️⃣ **"Doğrulama Başlat"** butonuna tıkla\n2️⃣ Discord hesabınla giriş yap\n3️⃣ Otomatik olarak doğrulanacaksın\n4️⃣ Sunucunun tadını çıkar! 🎊',
                    inline: false
                },
                {
                    name: '⏱️ **Süre**',
                    value: 'Doğrulama linki **10 dakika** geçerlidir.',
                    inline: true
                },
                {
                    name: '🔒 **Güvenlik**',
                    value: 'Doğrulama linkini **kimseyle paylaşma!**',
                    inline: true
                }
            )
            .setThumbnail(member.user.displayAvatarURL({ 
                size: 256, 
                dynamic: true, 
                format: 'png' 
            }))
            .setFooter({
                text: `${member.guild.name} • Doğrulama Sistemi`,
                iconURL: member.guild.iconURL({ size: 64, dynamic: true }) || null
            })
            .setTimestamp();
        
        // 🎛️ BUTONLAR
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
        
        // 📨 MESAJI GÖNDER
        const message = await verifiedChannel.send({
            content: `||${member}||`, // Ping'i spoiler içinde
            embeds: [embed],
            components: [row]
        });
        
        // 💾 MESAJI KAYDET
        client.verificationMessages.set(member.id, {
            messageId: message.id,
            channelId: verifiedChannel.id,
            timestamp: Date.now()
        });
        
        // 📊 LOG KANALINA BİLDİR
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('📥 Yeni Üye Katıldı')
                .setDescription(`**${member.user.tag}** sunucuya katıldı`)
                .addFields(
                    { name: '👤 Kullanıcı', value: `${member}`, inline: true },
                    { name: '🆔 ID', value: `\`${member.id}\``, inline: true },
                    { name: '📅 Hesap Oluşturulma', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: 'Doğrulama Log Sistemi' })
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
        
        console.log(`✅ ${member.user.tag} için doğrulama mesajı gönderildi`);
        
    } catch (error) {
        console.error('❌ Üye işleme hatası:', error);
    }
});

// 🎯 BUTON TIKLAMALARI
client.on('interactionCreate', async (interaction) => {
    try {
        if (!interaction.isButton()) return;
        
        const { customId, user, guild } = interaction;
        
        // 🚀 DOĞRULAMA BUTONU
        if (customId.startsWith('verify_start_')) {
            const memberId = customId.split('_')[2];
            
            // Sadece ilgili kişi tıklayabilir
            if (user.id !== memberId) {
                return interaction.reply({ 
                    content: '❌ Bu doğrulama sadece ilgili kişi içindir!',
                    ephemeral: true 
                });
            }
            
            // 📈 DENEME KONTROLÜ
            const attempts = client.userAttempts.get(user.id) || 0;
            if (attempts >= config.maxAttempts) {
                return interaction.reply({
                    content: `❌ Çok fazla deneme yaptınız! Lütfen yöneticilerle iletişime geçin.`,
                    ephemeral: true
                });
            }
            
            // 🔐 OAuth2 STATE OLUŞTUR
            const state = crypto.randomBytes(16).toString('hex');
            const verificationCode = crypto.randomBytes(8).toString('hex').toUpperCase();
            
            // 💾 VERİLERİ KAYDET
            client.pendingVerifications.set(state, {
                userId: user.id,
                guildId: guild.id,
                code: verificationCode,
                timestamp: Date.now()
            });
            
            // 🔗 DOĞRULAMA LİNKİ OLUŞTUR
            const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&response_type=code&scope=identify&state=${state}&prompt=none`;
            
            // 📧 DOĞRULAMA EMBED'I
            const embed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle('🔐 Discord Doğrulama')
                .setDescription('Doğrulama işlemini başlatmak için aşağıdaki linke tıkla:\n\n**⚠️ ÖNEMLİ:** Bu linki **KİMSEYLE** paylaşma!')
                .addFields(
                    {
                        name: '🔗 **Doğrulama Linki**',
                        value: `[Tıkla ve Doğrula](${authUrl})`,
                        inline: false
                    },
                    {
                        name: '⏱️ **Geçerlilik Süresi**',
                        value: '10 dakika',
                        inline: true
                    },
                    {
                        name: '🔒 **Güvenlik Kodu**',
                        value: `||${verificationCode}||`,
                        inline: true
                    }
                )
                .setFooter({
                    text: 'Güvenli Doğrulama Sistemi • Linke tıkladıktan sonra bu pencereyi kapatabilirsin'
                })
                .setTimestamp();
            
            // 🎛️ LİNK BUTONU
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🔗 Doğrulama Linki')
                        .setURL(authUrl)
                        .setStyle(ButtonStyle.Link)
                );
            
            await interaction.reply({
                embeds: [embed],
                components: [row],
                ephemeral: true
            });
            
            // 📈 DENEME SAYISINI ARTIR
            client.userAttempts.set(user.id, attempts + 1);
            
            console.log(`🔗 ${user.tag} için doğrulama linki oluşturuldu`);
        }
        
        // ❓ YARDIM BUTONU
        else if (customId.startsWith('help_')) {
            const embed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle('❓ Yardım Merkezi')
                .setDescription('Doğrulama ile ilgili sıkça sorulan sorular:')
                .addFields(
                    {
                        name: '❔ Link çalışmıyor',
                        value: 'Linki kopyalayıp tarayıcıda açmayı deneyin.'
                    },
                    {
                        name: '❔ Hesabım doğrulanmadı',
                        value: 'Doğrulama sonrası 1-2 dakika bekleyin.'
                    },
                    {
                        name: '📞 Destek',
                        value: 'Sorun devam ederse yöneticilerle iletişime geçin.'
                    }
                )
                .setTimestamp();
            
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }
        
    } catch (error) {
        console.error('❌ Buton hatası:', error);
        if (!interaction.replied) {
            await interaction.reply({ 
                content: '❌ Bir hata oluştu!',
                ephemeral: true 
            });
        }
    }
});

// 🌐 EXPRESS SUNUCUSU
const app = express();

// 📦 MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: true, // Render HTTPS kullanır
        maxAge: 15 * 60 * 1000 // 15 dakika
    }
}));

// 🏠 ANA SAYFA
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Discord Doğrulama Botu</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }
                
                body {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px;
                }
                
                .container {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 40px;
                    max-width: 600px;
                    width: 100%;
                    text-align: center;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                }
                
                h1 {
                    color: #5865F2;
                    margin-bottom: 20px;
                    font-size: 2.5em;
                }
                
                .status {
                    background: #2ecc71;
                    color: white;
                    padding: 10px 20px;
                    border-radius: 50px;
                    display: inline-block;
                    margin: 20px 0;
                    font-weight: bold;
                }
                
                .info {
                    text-align: left;
                    background: #f8f9fa;
                    border-radius: 15px;
                    padding: 20px;
                    margin: 20px 0;
                }
                
                .info-item {
                    margin: 10px 0;
                    display: flex;
                    justify-content: space-between;
                }
                
                .bot-name {
                    font-size: 1.5em;
                    color: #2c3e50;
                    margin: 15px 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Discord Doğrulama Botu</h1>
                
                <div class="status">🚀 ÇALIŞIYOR</div>
                
                <div class="bot-name">
                    ${client.user?.tag || 'Başlatılıyor...'}
                </div>
                
                <div class="info">
                    <div class="info-item">
                        <span>🌐 Domain:</span>
                        <strong>discord-verified-bot-1.onrender.com</strong>
                    </div>
                    <div class="info-item">
                        <span>🔗 Callback URL:</span>
                        <strong>${config.redirectUri}</strong>
                    </div>
                    <div class="info-item">
                        <span>⚡ Durum:</span>
                        <strong>Online</strong>
                    </div>
                    <div class="info-item">
                        <span>👥 Sunucu:</span>
                        <strong>${client.guilds.cache.size}</strong>
                    </div>
                </div>
                
                <p style="color: #7f8c8d; margin-top: 20px;">
                    Otomatik doğrulama sistemi aktif. Yeni üyeler doğrulama yapabilir.
                </p>
            </div>
        </body>
        </html>
    `);
});

// 🔄 CALLBACK ENDPOINT
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    
    console.log(`🔄 Callback received: state=${state}`);
    
    if (!code || !state) {
        return res.status(400).send(renderErrorPage('Geçersiz istek parametreleri!'));
    }
    
    const verificationData = client.pendingVerifications.get(state);
    if (!verificationData) {
        return res.status(400).send(renderErrorPage('Geçersiz veya süresi dolmuş doğrulama kodu!'));
    }
    
    // ⏱️ SÜRE KONTROLÜ
    if (Date.now() - verificationData.timestamp > config.verificationTimeout * 1000) {
        client.pendingVerifications.delete(state);
        return res.status(400).send(renderErrorPage('Doğrulama süresi doldu! Lütfen tekrar deneyin.'));
    }
    
    try {
        // 🔑 ACCESS TOKEN AL
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
        
        // 👤 KULLANICI BİLGİLERİNİ AL
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
        
        const userData = userResponse.data;
        
        // 🆔 KULLANICI KONTROLÜ
        if (userData.id !== verificationData.userId) {
            return res.status(400).send(renderErrorPage('Doğrulama başarısız! Yanlış hesap.'));
        }
        
        // 🏰 SUNUCUYU BUL
        const guild = client.guilds.cache.get(verificationData.guildId);
        if (!guild) {
            return res.status(400).send(renderErrorPage('Sunucu bulunamadı!'));
        }
        
        // 👥 ÜYEYİ BUL
        const member = await guild.members.fetch(verificationData.userId);
        if (!member) {
            return res.status(400).send(renderErrorPage('Üye bulunamadı!'));
        }
        
        // ✅ DOĞRULAMA İŞLEMİNİ TAMAMLA
        await completeVerification(member, guild, state);
        
        // 🎉 BAŞARILI SAYFASI
        res.send(renderSuccessPage(member, guild));
        
    } catch (error) {
        console.error('❌ OAuth hatası:', error);
        res.status(500).send(renderErrorPage('Doğrulama sırasında bir hata oluştu!'));
    }
});

// ✅ DOĞRULAMA TAMAMLAMA
async function completeVerification(member, guild, state) {
    try {
        // 🎭 ROLLERİ DEĞİŞTİR
        const unregisteredRole = guild.roles.cache.get(config.unregisteredRoleId);
        const lamerRole = guild.roles.cache.get(config.lamerRoleId);
        const memberRole = guild.roles.cache.get(config.memberRoleId);
        
        // 🔻 KAYITSIZ ROLÜNÜ AL
        if (unregisteredRole && member.roles.cache.has(unregisteredRole.id)) {
            await member.roles.remove(unregisteredRole.id);
            console.log(`🔻 ${member.user.tag} kayıtsız rolü alındı`);
        }
        
        // 🔼 LAMER ROLÜNÜ VER
        if (lamerRole && !member.roles.cache.has(lamerRole.id)) {
            await member.roles.add(lamerRole.id);
            console.log(`🔼 ${member.user.tag} lamer rolü verildi`);
        }
        
        // 👥 ÜYE ROLÜNÜ VER (OPSİYONEL)
        if (memberRole && !member.roles.cache.has(memberRole.id)) {
            await member.roles.add(memberRole.id);
            console.log(`👥 ${member.user.tag} üye rolü verildi`);
        }
        
        // 📊 LOG KANALINA BİLDİR
        const logChannel = guild.channels.cache.get(config.logChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('✅ Doğrulama Başarılı')
                .setDescription(`**${member.user.tag}** Discord OAuth2 ile doğrulandı`)
                .addFields(
                    { name: '👤 Kullanıcı', value: `${member}`, inline: true },
                    { name: '🆔 ID', value: `\`${member.id}\``, inline: true },
                    { name: '📅 Doğrulama Zamanı', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '🎭 Verilen Roller', value: 
                        `• <@&${config.lamerRoleId}>${memberRole ? `\n• <@&${config.memberRoleId}>` : ''}`, 
                        inline: false 
                    }
                )
                .setThumbnail(member.user.displayAvatarURL({ size: 256, dynamic: true }))
                .setFooter({ 
                    text: 'Otomatik Doğrulama Sistemi',
                    iconURL: guild.iconURL({ dynamic: true })
                })
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
            console.log(`📊 ${member.user.tag} loglandı`);
        }
        
        // ✉️ KULLANICIYA DM GÖNDER
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('🎉 Doğrulama Tamamlandı!')
                .setDescription(`**${guild.name}** sunucusunda başarıyla doğrulandın!`)
                .addFields(
                    { name: '✅ Durum', value: 'Hesabın başarıyla doğrulandı', inline: true },
                    { name: '👥 Topluluk', value: 'Artık tüm kanallara erişebilirsin!', inline: true }
                )
                .setFooter({ 
                    text: `${guild.name} - Hoş geldin!`,
                    iconURL: guild.iconURL({ dynamic: true }) 
                })
                .setTimestamp();
            
            await member.send({ embeds: [dmEmbed] });
            console.log(`✉️ ${member.user.tag} DM gönderildi`);
        } catch (dmError) {
            console.log('DM gönderilemedi:', dmError.message);
        }
        
        // 🗑️ VERIFIED KANALINDAKİ MESAJI SİL
        const userMessageData = client.verificationMessages.get(member.id);
        if (userMessageData) {
            try {
                const channel = guild.channels.cache.get(userMessageData.channelId);
                if (channel) {
                    const message = await channel.messages.fetch(userMessageData.messageId);
                    
                    // ✏️ MESAJI GÜNCELLE (Doğrulandı olarak)
                    const successEmbed = new EmbedBuilder()
                        .setColor('#2ecc71')
                        .setTitle('✅ Doğrulama Tamamlandı')
                        .setDescription(`${member} başarıyla doğrulandı!`)
                        .addFields(
                            { name: '🎉 Tebrikler!', value: 'Artık sunucunun tüm özelliklerine erişebilirsin.', inline: false },
                            { name: '⏱️ Doğrulama Zamanı', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                        )
                        .setFooter({ 
                            text: 'Doğrulama Sistemi • Mesaj 10 saniye sonra silinecek',
                            iconURL: guild.iconURL({ dynamic: true }) 
                        })
                        .setTimestamp();
                    
                    await message.edit({
                        content: `${member} doğrulandı! 🎉`,
                        embeds: [successEmbed],
                        components: []
                    });
                    
                    // ⏰ 10 SANİYE SONRA SİL
                    setTimeout(async () => {
                        try {
                            await message.delete();
                            console.log(`🗑️ ${member.user.tag} mesajı silindi`);
                        } catch (err) {
                            console.log('Mesaj silinemedi:', err.message);
                        }
                    }, 10000);
                }
                
                // 🗂️ KOLEKSİYONDAN KALDIR
                client.verificationMessages.delete(member.id);
            } catch (err) {
                console.log('Mesaj güncellenemedi:', err.message);
            }
        }
        
        // 🧹 VERİLERİ TEMİZLE
        client.pendingVerifications.delete(state);
        client.userAttempts.delete(member.id);
        
        console.log(`✅ ${member.user.tag} başarıyla doğrulandı!`);
        
    } catch (error) {
        console.error('❌ Doğrulama tamamlama hatası:', error);
        throw error;
    }
}

// 🎨 HTML SAYFALARI
function renderSuccessPage(member, guild) {
    return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Doğrulama Başarılı - ${guild.name}</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            
            body {
                background: linear-gradient(135deg, #2ecc71, #27ae60);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            
            .success-container {
                background: white;
                border-radius: 20px;
                padding: 40px;
                max-width: 500px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.2);
            }
            
            .check-icon {
                font-size: 80px;
                color: #2ecc71;
                margin-bottom: 20px;
            }
            
            h1 {
                color: #2c3e50;
                margin-bottom: 20px;
            }
            
            .user-info {
                background: #f8f9fa;
                border-radius: 15px;
                padding: 20px;
                margin: 20px 0;
                display: flex;
                align-items: center;
                gap: 15px;
            }
            
            .avatar {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                border: 3px solid #2ecc71;
            }
            
            .username {
                font-size: 1.3em;
                color: #2c3e50;
                font-weight: bold;
            }
            
            .message {
                color: #34495e;
                line-height: 1.6;
                margin: 20px 0;
            }
            
            .countdown {
                color: #7f8c8d;
                margin-top: 20px;
                font-size: 0.9em;
            }
        </style>
    </head>
    <body>
        <div class="success-container">
            <div class="check-icon">✅</div>
            
            <h1>Doğrulama Başarılı! 🎉</h1>
            
            <div class="user-info">
                <img src="${member.user.displayAvatarURL({ size: 128, format: 'png' })}" 
                     class="avatar"
                     alt="${member.user.username}">
                <div>
                    <div class="username">${member.user.username}</div>
                    <div style="color: #7f8c8d;">${guild.name} Üyesi</div>
                </div>
            </div>
            
            <div class="message">
                <p>Discord hesabın başarıyla doğrulandı!</p>
                <p>Artık <strong>${guild.name}</strong> sunucusunun tüm özelliklerine erişebilirsin.</p>
            </div>
            
            <div style="margin: 25px 0;">
                <a href="https://discord.com/channels/${guild.id}" 
                   style="background: #5865F2; color: white; padding: 12px 30px; 
                          border-radius: 50px; text-decoration: none; font-weight: bold;
                          display: inline-block;">
                    Sunucuya Git
                </a>
            </div>
            
            <div class="countdown">
                Bu pencere 5 saniye sonra kapanacak...
            </div>
        </div>
        
        <script>
            setTimeout(() => window.close(), 5000);
            
            let seconds = 5;
            const countdownElement = document.querySelector('.countdown');
            setInterval(() => {
                seconds--;
                countdownElement.textContent = \`Bu pencere \${seconds} saniye sonra kapanacak...\`;
                if (seconds <= 0) window.close();
            }, 1000);
        </script>
    </body>
    </html>
    `;
}

function renderErrorPage(message) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Doğrulama Hatası</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                text-align: center;
                padding: 50px;
                background: linear-gradient(135deg, #e74c3c, #c0392b);
                color: white;
            }
            
            .error-container {
                background: rgba(255,255,255,0.1);
                padding: 40px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
                max-width: 500px;
                margin: 0 auto;
            }
            
            .error-icon {
                font-size: 60px;
                margin-bottom: 20px;
            }
        </style>
    </head>
    <body>
        <div class="error-container">
            <div class="error-icon">❌</div>
            <h1>Doğrulama Hatası</h1>
            <p>${message}</p>
            <p style="margin-top: 20px;">
                <a href="https://discord.com" style="color: white; text-decoration: underline;">
                    Discord'a dön
                </a>
            </p>
        </div>
    </body>
    </html>
    `;
}

// 🤖 BOTU BAŞLAT
client.login(config.token).catch(error => {
    console.error('❌ Bot giriş hatası:', error);
    process.exit(1);
});

// 🌐 SERVER BAŞLAT - RENDER PORT (10000)
const PORT = config.port;
app.listen(PORT, '0.0.0.0', () => {
    console.log('══════════════════════════════════════════');
    console.log(`🌐 Express server ${PORT} portunda başladı`);
    console.log(`🔗 Ana sayfa: https://discord-verified-bot-1.onrender.com`);
    console.log(`🔄 Callback: ${config.redirectUri}`);
    console.log('══════════════════════════════════════════');
});

// 🛑 HATA YAKALAMA
process.on('unhandledRejection', error => {
    console.error('❌ İşlenmeyen hata:', error);
});

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    Events, 
    Partials,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Collection,
    AttachmentBuilder
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');

// Rate Limiter
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Konfigürasyon
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
    redirectUri: process.env.REDIRECT_URI,
    baseUrl: process.env.BASE_URL,
    port: process.env.PORT || 3000,
    sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    verificationTimeout: parseInt(process.env.VERIFICATION_TIMEOUT) || 600,
    maxAttempts: parseInt(process.env.MAX_ATTEMPTS) || 3
};

// Rate Limiter ayarları
const rateLimiter = new RateLimiterMemory({
    points: 5, // 5 istek
    duration: 60, // 60 saniyede
});

// Doğrulama verilerini saklamak için
const verificationStore = new Map();
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
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel]
});

// Koleksiyonlar
client.verificationMessages = new Collection(); // Kullanıcı ID -> Mesaj ID
client.pendingVerifications = new Collection(); // State -> Verification Data

// Bot hazır olduğunda
client.once('ready', async () => {
    console.log(`🎉 ${client.user.tag} olarak giriş yapıldı!`);
    console.log(`📊 Sunucu sayısı: ${client.guilds.cache.size}`);
    console.log(`👥 Toplam kullanıcı: ${client.users.cache.size}`);
    
    // Bot durumu
    client.user.setPresence({
        activities: [{
            name: 'Doğrulama Sistemini Yönetiyor',
            type: 3 // WATCHING
        }],
        status: 'online'
    });
    
    // Slash komutlarını kaydet (opsiyonel)
    await registerSlashCommands();
    
    console.log('✅ Bot tamamen hazır!');
});

// Slash komutları kaydetme
async function registerSlashCommands() {
    try {
        const commands = [
            {
                name: 'verify',
                description: 'Manuel doğrulama başlat',
                options: [
                    {
                        name: 'kullanıcı',
                        description: 'Doğrulanacak kullanıcı',
                        type: 6, // USER
                        required: true
                    }
                ]
            },
            {
                name: 'stats',
                description: 'Doğrulama istatistiklerini göster'
            },
            {
                name: 'cleanup',
                description: 'Eski doğrulama mesajlarını temizle',
                options: [
                    {
                        name: 'gün',
                        description: 'Kaç günden eski mesajlar silinsin',
                        type: 4, // INTEGER
                        required: false
                    }
                ]
            }
        ];
        
        await client.application.commands.set(commands);
        console.log('✅ Slash komutları kaydedildi!');
    } catch (error) {
        console.error('❌ Slash komutları kaydedilemedi:', error);
    }
}

// Yeni üye katılınca
client.on('guildMemberAdd', async (member) => {
    try {
        if (member.guild.id !== config.guildId) return;
        
        console.log(`👤 Yeni üye: ${member.user.tag} (${member.id})`);
        
        // Rate limit kontrolü
        try {
            await rateLimiter.consume(member.id);
        } catch (rlRejected) {
            console.warn(`⚠️ Rate limit: ${member.user.tag}`);
            return;
        }
        
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
            .setColor('#5865F2') // Discord mavisi
            .setAuthor({
                name: member.guild.name,
                iconURL: member.guild.iconURL({ size: 128, dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png'
            })
            .setTitle('🎉 Sunucuya Hoş Geldin!')
            .setDescription(`**${member.user.username}**, sunucumuza hoş geldin! Devam edebilmek için hesabını doğrulaman gerekiyor.`)
            .addFields(
                {
                    name: '📋 Doğrulama Adımları',
                    value: '1️⃣ Aşağıdaki **"Doğrulama Başlat"** butonuna tıkla\n2️⃣ Discord hesabına giriş yap\n3️⃣ Doğrulama tamamlanacak ve rollerin otomatik verilecek\n4️⃣ Sunucunun tadını çıkar!',
                    inline: false
                },
                {
                    name: '⏱️ Süre',
                    value: `Doğrulama linki **${config.verificationTimeout / 60} dakika** geçerlidir.`,
                    inline: true
                },
                {
                    name: '🔒 Güvenlik',
                    value: 'Doğrulama linkini kimseyle paylaşma!',
                    inline: true
                }
            )
            .setThumbnail(member.user.displayAvatarURL({ size: 256, dynamic: true, format: 'png' }))
            .setImage('https://cdn.discordapp.com/attachments/1445184746509439080/1446633946736492584/Gemini_Generated_Image_i6g3e9i6g3e9i6g3.png?ex=6934b25a&is=693360da&hm=f8142a81e58c634d6199e57130b3524bd59ac21b5a7b7f8b045cab2b5a5da4c6&') // Banner image
            .setFooter({
                text: `${member.guild.name} • Doğrulama Sistemi`,
                iconURL: member.guild.iconURL({ size: 64, dynamic: true }) || null
            })
            .setTimestamp();
        
        // Premium butonlar
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
                    .setEmoji('❔'),
                new ButtonBuilder()
                    .setURL('https://discord.com/guidelines')
                    .setLabel('Discord Kuralları')
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('📜')
            );
        
        // Mesajı gönder
        const message = await verifiedChannel.send({
            content: `||${member}||`, // Ping'i spoiler içinde
            embeds: [embed],
            components: [row]
        });
        
        // Mesajı koleksiyona kaydet
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
                    { name: '🆔 ID', value: `\`${member.id}\``, inline: true },
                    { name: '📅 Hesap Oluşturulma', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '🎭 Bot mu?', value: member.user.bot ? 'Evet' : 'Hayır', inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: 'Doğrulama Log Sistemi' })
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
        
        // Opsiyonel: Hoş geldin kanalına mesaj
        if (config.welcomeChannelId) {
            const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);
            if (welcomeChannel) {
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('✨ Yeni Bir Dost Geldi!')
                    .setDescription(`Lütfen **${member.user.username}**'a hoş geldin de! 🎉\nTopluluğumuza katıldığın için teşekkür ederiz!`)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                    .setImage('https://cdn.discordapp.com/attachments/1445184746509439080/1446633946736492584/Gemini_Generated_Image_i6g3e9i6g3e9i6g3.png?ex=6934b25a&is=693360da&hm=f8142a81e58c634d6199e57130b3524bd59ac21b5a7b7f8b045cab2b5a5da4c6&') // Welcome gif
                    .setFooter({ text: `Sunucu üye sayısı: ${member.guild.memberCount}` })
                    .setTimestamp();
                
                await welcomeChannel.send({ embeds: [welcomeEmbed] });
            }
        }
        
        console.log(`✅ ${member.user.tag} için doğrulama mesajı gönderildi (Mesaj ID: ${message.id})`);
        
    } catch (error) {
        console.error('❌ Yeni üye işleme hatası:', error);
    }
});

// Buton tıklamalarını işle
client.on('interactionCreate', async (interaction) => {
    try {
        // Buton tıklaması
        if (interaction.isButton()) {
            await handleButtonClick(interaction);
        }
        
        // Slash komutları
        if (interaction.isCommand()) {
            await handleSlashCommand(interaction);
        }
        
        // Modal submit
        if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
        }
        
    } catch (error) {
        console.error('❌ Interaction hatası:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
                content: '❌ Bir hata oluştu! Lütfen daha sonra tekrar deneyin.',
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
                content: '❌ Bu doğrulama sadece ilgili kişi içindir!',
                ephemeral: true 
            });
            return;
        }
        
        // Rate limit kontrolü
        const attempts = userAttempts.get(user.id) || 0;
        if (attempts >= config.maxAttempts) {
            await interaction.reply({
                content: `❌ Çok fazla deneme yaptınız! Lütfen yöneticilerle iletişime geçin.`,
                ephemeral: true
            });
            return;
        }
        
        // OAuth2 state oluştur
        const state = crypto.randomBytes(16).toString('hex');
        const verificationCode = crypto.randomBytes(8).toString('hex').toUpperCase();
        
        // Doğrulama verilerini kaydet
        client.pendingVerifications.set(state, {
            userId: user.id,
            guildId: guild.id,
            code: verificationCode,
            timestamp: Date.now(),
            interactionId: interaction.id
        });
        
        // OAuth2 URL oluştur
        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&response_type=code&scope=identify+guilds.join&state=${state}&prompt=none`;
        
        // Premium embed
        const embed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setTitle('🔐 Discord Doğrulama')
            .setDescription('Doğrulama işlemini başlatmak için aşağıdaki linke tıkla.\n\n**⚠️ ÖNEMLİ:** Bu linki **KİMSEYLE** paylaşma!')
            .addFields(
                {
                    name: '🔗 Doğrulama Linki',
                    value: `[Tıkla ve Doğrula](${authUrl})`,
                    inline: false
                },
                {
                    name: '⏱️ Geçerlilik Süresi',
                    value: `${config.verificationTimeout / 60} dakika`,
                    inline: true
                },
                {
                    name: '🔒 Güvenlik Kodu',
                    value: `||${verificationCode}||`,
                    inline: true
                }
            )
            .setFooter({
                text: 'Güvenli Doğrulama Sistemi • Linke tıkladıktan sonra bu pencereyi kapatabilirsin',
                iconURL: 'https://cdn.discordapp.com/attachments/1445184746509439080/1446633946736492584/Gemini_Generated_Image_i6g3e9i6g3e9i6g3.png?ex=6934b25a&is=693360da&hm=f8142a81e58c634d6199e57130b3524bd59ac21b5a7b7f8b045cab2b5a5da4c6&'
            })
            .setTimestamp();
        
        // Butonlar
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('🔗 Doğrulama Linki')
                    .setURL(authUrl)
                    .setStyle(ButtonStyle.Link),
                new ButtonBuilder()
                    .setCustomId('show_code')
                    .setLabel('Kodu Göster')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('👁️')
            );
        
        await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });
        
        // Deneme sayısını artır
        userAttempts.set(user.id, attempts + 1);
        
        console.log(`🔗 ${user.tag} için doğrulama linki oluşturuldu (State: ${state})`);
    }
    
    // Yardım butonu
    else if (customId.startsWith('help_')) {
        const embed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setTitle('❓ Yardım Merkezi')
            .setDescription('Doğrulama ile ilgili sıkça sorulan sorular ve çözümleri:')
            .addFields(
                {
                    name: '❔ Link çalışmıyor',
                    value: 'Linki kopyalayıp tarayıcıda açmayı deneyin veya farklı bir tarayıcı kullanın.'
                },
                {
                    name: '❔ Hesabım doğrulanmadı',
                    value: 'Doğrulama sonrası 1-2 dakika bekleyin. Sorun devam ederse yöneticilerle iletişime geçin.'
                },
                {
                    name: '❔ Link süresi doldu',
                    value: 'Yeniden doğrulama butonuna tıklayarak yeni bir link alın.'
                },
                {
                    name: '📞 Destek',
                    value: 'Yukarıdaki çözümler işe yaramazsa lütfen bir yöneticiye ulaşın.'
                }
            )
            .setFooter({ text: 'Hızlı Destek Sistemi' })
            .setTimestamp();
        
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }
    
    // Kod göster butonu
    else if (customId === 'show_code') {
        // Bu kısımda kullanıcının doğrulama kodunu gösterebilirsiniz
        await interaction.reply({
            content: '⚠️ Güvenlik nedeniyle kod sadece doğrulama sayfasında gösterilir.',
            ephemeral: true
        });
    }
}

// Slash komutlarını işleme
async function handleSlashCommand(interaction) {
    const { commandName, options, member } = interaction;
    
    if (!member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Bu komutu kullanmak için yönetici izinlerine sahip olmalısınız!',
            ephemeral: true
        });
        return;
    }
    
    switch (commandName) {
        case 'verify':
            const targetUser = options.getUser('kullanıcı');
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            // Manuel doğrulama
            await manualVerification(targetMember, interaction);
            break;
            
        case 'stats':
            const statsEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('📊 Doğrulama İstatistikleri')
                .addFields(
                    { name: '⏰ Çalışma Süresi', value: formatUptime(client.uptime), inline: true },
                    { name: '📨 Bekleyen Doğrulama', value: `${client.pendingVerifications.size}`, inline: true },
                    { name: '👥 Toplam Üye', value: `${interaction.guild.memberCount}`, inline: true },
                    { name: '🔢 Doğrulama Mesajları', value: `${client.verificationMessages.size}`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [statsEmbed], ephemeral: true });
            break;
            
        case 'cleanup':
            const days = options.getInteger('gün') || 7;
            await cleanupOldMessages(interaction, days);
            break;
    }
}

// Manual doğrulama
async function manualVerification(member, interaction) {
    try {
        const guild = member.guild;
        
        // Rolleri değiştir
        const unregisteredRole = guild.roles.cache.get(config.unregisteredRoleId);
        const lamerRole = guild.roles.cache.get(config.lamerRoleId);
        const memberRole = guild.roles.cache.get(config.memberRoleId);
        
        if (unregisteredRole && member.roles.cache.has(unregisteredRole.id)) {
            await member.roles.remove(unregisteredRole.id);
        }
        
        if (lamerRole && !member.roles.cache.has(lamerRole.id)) {
            await member.roles.add(lamerRole.id);
        }
        
        if (memberRole && !member.roles.cache.has(memberRole.id)) {
            await member.roles.add(memberRole.id);
        }
        
        // Orijinal doğrulama mesajını sil
        const userMessageData = client.verificationMessages.get(member.id);
        if (userMessageData) {
            try {
                const channel = guild.channels.cache.get(userMessageData.channelId);
                if (channel) {
                    const message = await channel.messages.fetch(userMessageData.messageId);
                    await message.delete();
                }
                client.verificationMessages.delete(member.id);
            } catch (err) {
                console.log('Mesaj silinemedi:', err.message);
            }
        }
        
        // Log
        const logChannel = guild.channels.cache.get(config.logChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setTitle('🛠️ Manuel Doğrulama')
                .setDescription(`${member.user.tag} yönetici tarafından manuel olarak doğrulandı`)
                .addFields(
                    { name: '👤 Kullanıcı', value: `${member}`, inline: true },
                    { name: '🛠️ Yapan', value: `${interaction.user}`, inline: true },
                    { name: '🎭 Verilen Roller', value: `<@&${config.lamerRoleId}> ${config.memberRoleId ? `<@&${config.memberRoleId}>` : ''}`, inline: true }
                )
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
        
        // Kullanıcıya DM
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('✅ Doğrulama Başarılı!')
                .setDescription(`**${guild.name}** sunucusunda bir yönetici tarafından manuel olarak doğrulandın!`)
                .addFields(
                    { name: '🎉 Tebrikler!', value: 'Artık sunucunun tüm özelliklerine erişebilirsin.' },
                    { name: '👥 Topluluk', value: 'Diğer üyelerle tanışmaktan çekinme!' }
                )
                .setTimestamp();
            
            await member.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            // DM gönderilemezse sorun değil
        }
        
        await interaction.reply({
            content: `✅ ${member} başarıyla manuel olarak doğrulandı!`,
            ephemeral: true
        });
        
    } catch (error) {
        console.error('Manual doğrulama hatası:', error);
        await interaction.reply({
            content: '❌ Manuel doğrulama sırasında bir hata oluştu!',
            ephemeral: true
        });
    }
}

// Eski mesajları temizle
async function cleanupOldMessages(interaction, days) {
    const guild = interaction.guild;
    const verifiedChannel = guild.channels.cache.get(config.verifiedChannelId);
    
    if (!verifiedChannel) {
        await interaction.reply({
            content: '❌ Verified kanalı bulunamadı!',
            ephemeral: true
        });
        return;
    }
    
    const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
    let deletedCount = 0;
    
    try {
        const messages = await verifiedChannel.messages.fetch({ limit: 100 });
        
        for (const [messageId, message] of messages) {
            if (message.createdTimestamp < cutoffDate && message.author.id === client.user.id) {
                await message.delete();
                deletedCount++;
                
                // Rate limit için bekle
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Koleksiyonu temizle
        for (const [userId, data] of client.verificationMessages.entries()) {
            if (data.timestamp < cutoffDate) {
                client.verificationMessages.delete(userId);
            }
        }
        
        await interaction.reply({
            content: `✅ ${deletedCount} eski doğrulama mesajı temizlendi!`,
            ephemeral: true
        });
        
    } catch (error) {
        console.error('Cleanup hatası:', error);
        await interaction.reply({
            content: '❌ Mesaj temizleme sırasında bir hata oluştu!',
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
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 15 * 60 * 1000 // 15 dakika
    }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// OAuth Callback endpoint
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code || !state) {
        return res.status(400).send(renderErrorPage('Geçersiz istek parametreleri!'));
    }
    
    const verificationData = client.pendingVerifications.get(state);
    if (!verificationData) {
        return res.status(400).send(renderErrorPage('Geçersiz veya süresi dolmuş doğrulama kodu!'));
    }
    
    // Süre kontrolü
    if (Date.now() - verificationData.timestamp > config.verificationTimeout * 1000) {
        client.pendingVerifications.delete(state);
        return res.status(400).send(renderErrorPage('Doğrulama süresi doldu! Lütfen tekrar deneyin.'));
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
            return res.status(400).send(renderErrorPage('Doğrulama başarısız! Yanlış hesap.'));
        }
        
        // Discord sunucusunu bul
        const guild = client.guilds.cache.get(verificationData.guildId);
        if (!guild) {
            return res.status(400).send(renderErrorPage('Sunucu bulunamadı!'));
        }
        
        // Üyeyi bul
        const member = await guild.members.fetch(verificationData.userId);
        if (!member) {
            return res.status(400).send(renderErrorPage('Üye bulunamadı!'));
        }
        
        // Premium doğrulama işlemi
        await completeVerification(member, guild, state);
        
        // Başarılı sayfasını göster
        res.send(renderSuccessPage(member, guild));
        
    } catch (error) {
        console.error('❌ OAuth işleme hatası:', error);
        res.status(500).send(renderErrorPage('Doğrulama sırasında bir hata oluştu!'));
    }
});

// Doğrulama tamamlama
async function completeVerification(member, guild, state) {
    try {
        // Rolleri değiştir
        const unregisteredRole = guild.roles.cache.get(config.unregisteredRoleId);
        const lamerRole = guild.roles.cache.get(config.lamerRoleId);
        const memberRole = guild.roles.cache.get(config.memberRoleId);
        const vipRole = guild.roles.cache.get(config.vipRoleId);
        
        // Kayıtsız rolünü al
        if (unregisteredRole && member.roles.cache.has(unregisteredRole.id)) {
            await member.roles.remove(unregisteredRole.id);
        }
        
        // Lamer rolünü ver
        if (lamerRole && !member.roles.cache.has(lamerRole.id)) {
            await member.roles.add(lamerRole.id);
        }
        
        // Normal üye rolünü ver (opsiyonel)
        if (memberRole && !member.roles.cache.has(memberRole.id)) {
            await member.roles.add(memberRole.id);
        }
        
        // Premium/VIP rolü kontrolü (opsiyonel)
        // Burada premium üyelik kontrolü yapabilirsiniz
        const isPremium = false; // Premium kontrolü için özel logic
        if (isPremium && vipRole && !member.roles.cache.has(vipRole.id)) {
            await member.roles.add(vipRole.id);
        }
        
        // Log kanalına bildir
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
                        `<@&${config.lamerRoleId}>${memberRole ? `\n<@&${config.memberRoleId}>` : ''}${isPremium && vipRole ? `\n<@&${config.vipRoleId}>` : ''}`, 
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
        }
        
        // Kullanıcıya DM gönder
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('🎉 Doğrulama Tamamlandı!')
                .setDescription(`**${guild.name}** sunucusunda başarıyla doğrulandın!`)
                .addFields(
                    { name: '✅ Durum', value: 'Hesabın başarıyla doğrulandı', inline: true },
                    { name: '👥 Topluluk', value: 'Artık tüm kanallara erişebilirsin!', inline: true },
                    { name: '🎭 Rollerin', value: 
                        `• <@&${config.lamerRoleId}>${memberRole ? `\n• <@&${config.memberRoleId}>` : ''}${isPremium && vipRole ? `\n• <@&${config.vipRoleId}>` : ''}`,
                        inline: false 
                    }
                )
                .setImage('https://cdn.discordapp.com/attachments/1445184746509439080/1446633946736492584/Gemini_Generated_Image_i6g3e9i6g3e9i6g3.png?ex=6934b25a&is=693360da&hm=f8142a81e58c634d6199e57130b3524bd59ac21b5a7b7f8b045cab2b5a5da4c6&')
                .setFooter({ 
                    text: `${guild.name} - Hoş geldin!`,
                    iconURL: guild.iconURL({ dynamic: true }) 
                })
                .setTimestamp();
            
            await member.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            console.log('DM gönderilemedi:', dmError.message);
        }
        
        // Verified kanalındaki orijinal mesajı sil
        const userMessageData = client.verificationMessages.get(member.id);
        if (userMessageData) {
            try {
                const channel = guild.channels.cache.get(userMessageData.channelId);
                if (channel) {
                    const message = await channel.messages.fetch(userMessageData.messageId);
                    
                    // Mesajı güncelle veya sil
                    const successEmbed = new EmbedBuilder()
                        .setColor('#2ecc71')
                        .setTitle('✅ Doğrulama Tamamlandı')
                        .setDescription(`${member} başarıyla doğrulandı!`)
                        .addFields(
                            { name: '🎉 Tebrikler!', value: 'Artık sunucunun tüm özelliklerine erişebilirsin.', inline: false },
                            { name: '⏱️ Doğrulama Zamanı', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                        )
                        .setFooter({ 
                            text: 'Doğrulama Sistemi • Otomatik silinecek',
                            iconURL: guild.iconURL({ dynamic: true }) 
                        })
                        .setTimestamp();
                    
                    await message.edit({
                        content: `${member} doğrulandı! 🎉`,
                        embeds: [successEmbed],
                        components: []
                    });
                    
                    // 10 saniye sonra mesajı sil
                    setTimeout(async () => {
                        try {
                            await message.delete();
                        } catch (err) {
                            console.log('Mesaj silinemedi:', err.message);
                        }
                    }, 10000);
                }
                
                // Koleksiyondan kaldır
                client.verificationMessages.delete(member.id);
            } catch (err) {
                console.log('Mesaj güncellenemedi:', err.message);
            }
        }
        
        // Doğrulama verilerini temizle
        client.pendingVerifications.delete(state);
        userAttempts.delete(member.id);
        
        console.log(`✅ ${member.user.tag} başarıyla doğrulandı ve mesaj silindi!`);
        
    } catch (error) {
        console.error('❌ Doğrulama tamamlama hatası:', error);
        throw error;
    }
}

// HTML Sayfaları
function renderSuccessPage(member, guild) {
    return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Doğrulama Başarılı - ${guild.name}</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
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
            
            .success-container {
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 40px;
                max-width: 600px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                animation: fadeIn 0.5s ease-out;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .success-icon {
                font-size: 80px;
                color: #2ecc71;
                margin-bottom: 20px;
                animation: bounce 1s infinite alternate;
            }
            
            @keyframes bounce {
                from { transform: translateY(0); }
                to { transform: translateY(-10px); }
            }
            
            h1 {
                color: #2c3e50;
                margin-bottom: 15px;
                font-size: 2.5em;
            }
            
            .user-info {
                background: #f8f9fa;
                border-radius: 15px;
                padding: 20px;
                margin: 25px 0;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 15px;
            }
            
            .avatar {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                border: 3px solid #2ecc71;
            }
            
            .username {
                font-size: 1.5em;
                color: #2c3e50;
                font-weight: bold;
            }
            
            .guild-name {
                color: #7f8c8d;
                font-size: 1.1em;
            }
            
            .message {
                color: #34495e;
                line-height: 1.6;
                margin: 20px 0;
                font-size: 1.1em;
            }
            
            .steps {
                text-align: left;
                background: #f1f8ff;
                border-radius: 15px;
                padding: 25px;
                margin: 25px 0;
            }
            
            .steps h3 {
                color: #3498db;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .steps li {
                margin: 10px 0;
                padding-left: 25px;
                position: relative;
                color: #2c3e50;
            }
            
            .steps li:before {
                content: "✓";
                position: absolute;
                left: 0;
                color: #2ecc71;
                font-weight: bold;
            }
            
            .actions {
                margin-top: 30px;
                display: flex;
                gap: 15px;
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .btn {
                padding: 15px 30px;
                border-radius: 50px;
                text-decoration: none;
                font-weight: bold;
                display: inline-flex;
                align-items: center;
                gap: 10px;
                transition: all 0.3s ease;
                font-size: 1em;
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #2ecc71, #27ae60);
                color: white;
            }
            
            .btn-secondary {
                background: #f1f2f6;
                color: #2c3e50;
                border: 2px solid #dfe4ea;
            }
            
            .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
            }
            
            .countdown {
                margin-top: 25px;
                color: #7f8c8d;
                font-size: 0.9em;
            }
            
            .footer {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                color: #95a5a6;
                font-size: 0.9em;
            }
            
            @media (max-width: 600px) {
                .success-container {
                    padding: 25px;
                }
                
                h1 {
                    font-size: 2em;
                }
                
                .actions {
                    flex-direction: column;
                }
                
                .btn {
                    width: 100%;
                    justify-content: center;
                }
            }
        </style>
    </head>
    <body>
        <div class="success-container">
            <div class="success-icon">
                <i class="fas fa-check-circle"></i>
            </div>
            
            <h1>Doğrulama Başarılı! 🎉</h1>
            
            <div class="user-info">
                <img src="${member.user.displayAvatarURL({ size: 128, format: 'png' })}" 
                     alt="${member.user.username}" 
                     class="avatar">
                <div>
                    <div class="username">${member.user.username}</div>
                    <div class="guild-name">${guild.name} Üyesi</div>
                </div>
            </div>
            
            <div class="message">
                Discord hesabın başarıyla doğrulandı! Artık <strong>${guild.name}</strong> sunucusunun tüm özelliklerine erişebilirsin.
            </div>
            
            <div class="steps">
                <h3><i class="fas fa-tasks"></i> Yapılan İşlemler:</h3>
                <ul>
                    <li>Discord hesabın doğrulandı</li>
                    <li>Kayıtsız rolün kaldırıldı</li>
                    <li>Gerekli roller verildi</li>
                    <li>Sunucu erişimin açıldı</li>
                </ul>
            </div>
            
            <div class="actions">
                <a href="https://discord.com/channels/${guild.id}" class="btn btn-primary" target="_blank">
                    <i class="fab fa-discord"></i> Sunucuya Git
                </a>
                <button onclick="window.close()" class="btn btn-secondary">
                    <i class="fas fa-times"></i> Pencereyi Kapat
                </button>
            </div>
            
            <div class="countdown">
                <i class="fas fa-clock"></i> Bu pencere 10 saniye sonra kapanacak...
            </div>
            
            <div class="footer">
                <p>${guild.name} • Doğrulama Sistemi</p>
                <p><i class="fas fa-shield-alt"></i> Güvenli bağlantı • SSL korumalı</p>
            </div>
        </div>
        
        <script>
            // 10 saniye sonra pencereyi kapat
            setTimeout(() => {
                window.close();
            }, 10000);
            
            // Geri sayım
            let countdown = 10;
            const countdownElement = document.querySelector('.countdown');
            setInterval(() => {
                countdown--;
                countdownElement.innerHTML = 
                    \`<i class="fas fa-clock"></i> Bu pencere \${countdown} saniye sonra kapanacak...\`;
                
                if (countdown <= 0) {
                    window.close();
                }
            }, 1000);
        </script>
    </body>
    </html>
    `;
}

function renderErrorPage(message) {
    return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Doğrulama Hatası</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            
            body {
                background: linear-gradient(135deg, #ff6b6b 0%, #ee5a52 100%);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            
            .error-container {
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 40px;
                max-width: 600px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                animation: fadeIn 0.5s ease-out;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .error-icon {
                font-size: 80px;
                color: #e74c3c;
                margin-bottom: 20px;
            }
            
            h1 {
                color: #c0392b;
                margin-bottom: 15px;
                font-size: 2.5em;
            }
            
            .error-message {
                background: #ffebee;
                border-radius: 15px;
                padding: 20px;
                margin: 25px 0;
                color: #c62828;
                font-size: 1.1em;
                line-height: 1.6;
                border-left: 5px solid #e74c3c;
            }
            
            .solutions {
                text-align: left;
                background: #fff8e1;
                border-radius: 15px;
                padding: 25px;
                margin: 25px 0;
            }
            
            .solutions h3 {
                color: #f39c12;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .solutions li {
                margin: 10px 0;
                padding-left: 25px;
                position: relative;
                color: #2c3e50;
            }
            
            .solutions li:before {
                content: "•";
                position: absolute;
                left: 10px;
                color: #f39c12;
                font-weight: bold;
            }
            
            .actions {
                margin-top: 30px;
                display: flex;
                gap: 15px;
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .btn {
                padding: 15px 30px;
                border-radius: 50px;
                text-decoration: none;
                font-weight: bold;
                display: inline-flex;
                align-items: center;
                gap: 10px;
                transition: all 0.3s ease;
                font-size: 1em;
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #3498db, #2980b9);
                color: white;
            }
            
            .btn-secondary {
                background: #f1f2f6;
                color: #2c3e50;
                border: 2px solid #dfe4ea;
            }
            
            .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
            }
            
            @media (max-width: 600px) {
                .error-container {
                    padding: 25px;
                }
                
                h1 {
                    font-size: 2em;
                }
                
                .actions {
                    flex-direction: column;
                }
                
                .btn {
                    width: 100%;
                    justify-content: center;
                }
            }
        </style>
    </head>
    <body>
        <div class="error-container">
            <div class="error-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            
            <h1>Doğrulama Hatası! ⚠️</h1>
            
            <div class="error-message">
                <i class="fas fa-info-circle"></i> ${message}
            </div>
            
            <div class="solutions">
                <h3><i class="fas fa-lightbulb"></i> Çözüm Önerileri:</h3>
                <ul>
                    <li>Doğrulama linkinin süresi dolmuş olabilir</li>
                    <li>Farklı bir tarayıcı deneyin</li>
                    <li>Discord hesabınıza tekrar giriş yapın</li>
                    <li>Sunucuda yeniden doğrulama butonuna tıklayın</li>
                    <li>Hata devam ederse yöneticilerle iletişime geçin</li>
                </ul>
            </div>
            
            <div class="actions">
                <a href="https://discord.com" class="btn btn-primary" target="_blank">
                    <i class="fab fa-discord"></i> Discord'a Git
                </a>
                <button onclick="window.close()" class="btn btn-secondary">
                    <i class="fas fa-times"></i> Pencereyi Kapat
                </button>
            </div>
        </div>
    </body>
    </html>
    `;
}

// Yardımcı fonksiyonlar
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}g`);
    if (hours > 0) parts.push(`${hours}s`);
    if (minutes > 0) parts.push(`${minutes}d`);
    
    return parts.join(' ') || '1 dakikadan az';
}

// Botu başlat
client.login(config.token).catch(error => {
    console.error('❌ Bot giriş yapamadı:', error);
    process.exit(1);
});

// Express sunucusunu başlat
app.listen(config.port, () => {
    console.log(`🌐 OAuth callback sunucusu http://localhost:${config.port} adresinde çalışıyor`);
    console.log(`🔗 Callback URL: ${config.redirectUri}`);
});

// Process exit handlers
process.on('SIGINT', () => {
    console.log('\n🛑 Bot kapatılıyor...');
    client.destroy();
    process.exit(0);
});

process.on('unhandledRejection', error => {
    console.error('❌ İşlenmeyen Promise hatası:', error);
});
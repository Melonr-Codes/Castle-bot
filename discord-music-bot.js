// discord-music-bot.js (Compatibilidade Dupla: !comando e /comando)
import dotenv from 'dotenv';
dotenv.config();

import { Client, GatewayIntentBits, ApplicationCommandOptionType } from 'discord.js';
import { DisTube } from 'distube';
import { YtDlpPlugin } from '@distube/yt-dlp'; 
import fetch from 'node-fetch'; 
import ffmpegStatic from 'ffmpeg-static'; 


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// O prefixo legado que será aceito (e agora co-existe com os comandos de barra)
const PREFIX = '!';

// ----------------------------------------------------
// GERENCIAMENTO DE SESSÃO E VARIÁVEIS GLOBAIS
// ----------------------------------------------------
// Armazenamento em memória para sessões de usuário logado { userId: { sessionId, username, saldo, userId } }
const sessions = {}; 

// O DisTube agora usa o binário estático do FFmpeg
const distube = new DisTube(client, {
    plugins: [new YtDlpPlugin()], 
    ffmpeg: ffmpegStatic, 
    emitNewSongOnly: true,
    emitAddSongWhenCreatingQueue: false,
});


// ----------------------------------------------------
// FUNÇÕES DA API DE COINS (Inalteradas)
// ----------------------------------------------------
async function coinAPI(endpoint, body = {}, sessionId = null) {
    const baseUrl = "https://bank.foxsrv.net"; 
    const url = `${baseUrl}/api/${endpoint}`; 

    const headers = {
        "Content-Type": "application/json",
    };

    if (sessionId) {
        headers["Authorization"] = `Bearer ${sessionId}`;
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            return { error: true, message: errorBody.error || `Erro HTTP ${response.status}` };
        }

        return await response.json();
    } catch (error) {
        console.error("Erro na API de Coins:", error);
        return { error: true, message: "Falha na conexão com o banco" };
    }
}

// ----------------------------------------------------
// CASTLE SEARCH UTILS (Inalteradas)
// ----------------------------------------------------
function generateRandomCastleId(minLen, maxLen) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function getProjectDetailsFromCastleApi(id) {
    const apiUrl = `https://api.castle.xyz/projects/${id}`; 
    const webUrl = `https://castle.xyz/d/${id}`; 
    
    try {
        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'CastleBot/1.0 (Discord)' }
        });

        if (response.status === 404 || !response.ok) {
            return null;
        }

        const data = await response.json();
        
        if (data && data.name) {
            return {
                name: data.name,
                url: webUrl
            };
        }
        
        return null; 
    } catch (error) {
        return null;
    }
}

// ----------------------------------------------------
// FUNÇÃO CENTRALIZADA DE EXECUÇÃO (EVITA DUPLICAÇÃO DE LÓGICA)
// ----------------------------------------------------
/**
 * Executa a lógica de qualquer comando, recebendo os argumentos e o respondedor
 * @param {string} cmd O nome do comando (ex: 'login', 'play', 'saldo').
 * @param {Array<any>} args Os argumentos do comando (posicionais ou extraídos das opções).
 * @param {object} context O objeto de contexto (interaction ou message) com .user, .member, .channel, .guild
 * @param {function} respond Função para enviar a resposta (ex: interaction.editReply ou message.reply)
 * @param {boolean} ephemeral Indica se a resposta deve ser privada (apenas para Slash Commands)
 */
async function executeCommand(cmd, args, context, respond, ephemeral = false) {
    const userId = context.user.id;
    let userSession = sessions[userId];
    const isSlash = (context.interaction && context.interaction.isChatInputCommand());

    // ------------------------------------------------------
    // LÓGICA DE COINS (login, saldo, claim, transferir)
    // ------------------------------------------------------
    if (cmd === 'login') {
        if (userSession) return respond(`Você já está logado como **${userSession.username}**.`);
        if (args.length < 2) return respond("Uso: `/login <username> <password>` ou `!login <username> <password>`");

        const [username, password] = args;
        
        const data = await coinAPI("login", { username, password });
        
        if (data.error || !data.sessionId) {
            return respond(`❌ Falha no login: ${data.message || 'Credenciais inválidas ou erro no servidor.'}`);
        }

        sessions[userId] = {
            sessionId: data.sessionId,
            username: username,
            saldo: data.saldo,
            userId: data.userId 
        };

        return respond(`✅ Login bem-sucedido! Saldo inicial: **${data.saldo} coins**.`);
    }

    if (cmd === 'saldo') {
        if (!userSession) {
            return respond("❌ Você deve estar logado para verificar o saldo. Use `/login` ou `!login`.");
        }
        return respond(`💰 Saldo de **${userSession.username}**: **${userSession.saldo || 'N/A'} coins**`);
    }

    if (cmd === 'claim') {
        if (!userSession) return respond("❌ Você deve estar logado para usar `/claim` ou `!claim`. Use `/login`.");
        
        const data = await coinAPI("claim", {}, userSession.sessionId);
        
        if (data.error) {
            if (data.message === "Cooldown active") {
                return respond("⏳ Cooldown ativo. Tente novamente mais tarde.");
            }
            return respond(`❌ Não foi possível fazer claim: ${data.message || 'Erro desconhecido.'}`);
        }
        
        userSession = sessions[userId]; // Re-fetch, pois pode ter sido alterado
        if (data.claimed && userSession.saldo) {
             userSession.saldo = (parseFloat(userSession.saldo) + parseFloat(data.claimed)).toFixed(8);
        }
        
        return respond(`🎁 Claim realizado! Você ganhou: **${data.claimed || 0} coins**.`);
    }

    if (cmd === 'transferir') {
        if (!userSession) return respond("❌ Você deve estar logado para usar `/transferir` ou `!transferir`. Use `/login`.");
        if (args.length < 2) return respond("Uso: `/transferir <id_destino> <quantia>` ou `!transferir <id_destino> <quantia>`");


        const toId = args[0];
        const amount = parseFloat(args[1]);

        if (isNaN(amount) || amount <= 0) return respond("Quantia inválida.");
        if (toId === userSession.userId) return respond("Você não pode transferir para si mesmo.");

        const data = await coinAPI("transfer", { toId, amount }, userSession.sessionId);
        
        if (data.error) {
            return respond(`❌ Falha na transferência: ${data.message || 'Erro desconhecido.'}`);
        }

        userSession = sessions[userId]; // Re-fetch
        userSession.saldo = (parseFloat(userSession.saldo) - amount).toFixed(8);

        return respond(`✅ Transferido **${amount} coins** para o ID **${toId}**. (TxId: ${data.txId || 'N/A'})`);
    }

    // ------------------------------------------------------
    // LÓGICA DE MÚSICA (play, stop, skip)
    // ------------------------------------------------------
    if (cmd === "play") {
        const query = args[0];
        if (!query) return respond("Manda o link ou o nome da música.");

        const voiceChannel = context.member.voice.channel;
        if (!voiceChannel) return respond("Entre em um canal de voz primeiro.");

        try {
            await distube.play(voiceChannel, query, {
                member: context.member,
                textChannel: context.channel
            });
            // O Distube notificará o canal, a resposta da Interaction/Message é apenas confirmação
            return respond(`🎶 **Busca iniciada:** ${query}. A música será notificada no chat.`);
            
        } catch (error) {
            console.error("Erro no comando /play (Distube):", error);
            return respond(`❌ Ocorreu um erro ao tentar tocar essa música.`);
        }
    }

    if (cmd === "stop") {
        const queue = distube.getQueue(context.guild.id);
        if (!queue) return respond("Não estou tocando nada.");
        
        try {
            distube.stop(context.guild.id);
            return respond("🛑 Música parada e fila limpa. Desconectado.");
        } catch (e) {
            console.error("Erro no comando /stop (Distube):", e);
            return respond("Ocorreu um erro ao tentar parar a música.");
        }
    }

    if (cmd === "skip") {
        const queue = distube.getQueue(context.guild.id);
        if (!queue) return respond("Não estou tocando nada para pular.");

        try {
            const song = await distube.skip(context.guild.id);
            return respond(`⏭️ Pulando para: **${song.name}**`);
        } catch (e) {
            return respond(`❌ ${e}`);
        }
    }

    // ------------------------------------------------------
    // LÓGICA DO CASTLE SCANNER (castle)
    // ------------------------------------------------------
    if (cmd === "castle") {
        const query = args[0];
        if (!query) return respond("Diga o que pesquisar (ex: nome do projeto Castle).");

        const maxAttempts = 20000;
        const normalizedQuery = query.toLowerCase();
        const matchingProjects = [];
        const checkedIds = new Set(); 

        // Resposta inicial antes de iniciar o loop (mantida)
        await respond(`🔍 **INICIANDO SCAN:** Tentando **${maxAttempts} IDs** aleatórios (12 a 20 caracteres) que contenham: **${query}**...`);
        
        let attempts = 0;
        let found = 0;

        // O loop agora usa o canal do contexto para enviar notificações e a função respond para a resposta final
        while (attempts < maxAttempts && found < 5) { 
            attempts++;
            
            const randomId = generateRandomCastleId(12, 20);
            
            if (checkedIds.has(randomId)) continue;
            checkedIds.add(randomId);

            const project = await getProjectDetailsFromCastleApi(randomId); 
            
            if (project && project.name) {
                const normalizedProjectName = project.name.toLowerCase();
                
                if (normalizedProjectName.includes(normalizedQuery)) {
                    matchingProjects.push(project);
                    found++;
                    
                    context.channel.send(`✨ **PROJETO ENCONTRADO!** Nome: **[${project.name}](${project.url})**`);
                }
            }
        }
        
        const finalMessage = `✅ **SCAN FINALIZADO!** Tentativas: **${attempts}** | Total Encontrado: **${found}**`;
        await respond(finalMessage);


        if (matchingProjects.length > 0) {
            const projectsList = matchingProjects.map(p => `* **[${p.name}](${p.url})**`).join('\n');
            
            const embed = {
                color: 0x5865F2,
                title: `🏰 Resultado Final do Scan Castle`,
                description: `O scan encontrou **${found}** projeto(s) com o termo **"${query}"**:\n\n${projectsList}`,
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'Castle Bot Scanner',
                },
            };
            
            context.channel.send({ embeds: [embed] });
        } else {
            context.channel.send(`😭 O scan não encontrou nenhum projeto com o termo **"${query}"**. Tente um termo diferente.`);
        }
    }
}


// ----------------------------------------------------
// 2. REGISTRO DE COMANDOS SLASH (ON READY)
// ----------------------------------------------------
client.on('ready', async () => {
    console.log(`Bot conectado como ${client.user.tag}!`);

    // Definição de todos os comandos Slash (Igual ao código anterior)
    const commands = [
        { name: 'login', description: 'Faz login na sua conta do banco FoxSRV.', options: [
            { name: 'username', description: 'Seu nome de usuário no banco.', type: ApplicationCommandOptionType.String, required: true },
            { name: 'password', description: 'Sua senha no banco.', type: ApplicationCommandOptionType.String, required: true },
        ]},
        { name: 'saldo', description: 'Verifica o saldo de coins do usuário logado.' },
        { name: 'claim', description: 'Resgata a recompensa diária/faucet.' },
        { name: 'transferir', description: 'Transfere coins para outro usuário.', options: [
            { name: 'id_destino', description: 'O ID do usuário (do banco) que receberá os coins.', type: ApplicationCommandOptionType.String, required: true },
            { name: 'quantia', description: 'A quantia de coins a ser transferida.', type: ApplicationCommandOptionType.Number, required: true },
        ]},
        { name: 'play', description: 'Toca uma música no canal de voz.', options: [
            { name: 'musica', description: 'Link ou nome da música.', type: ApplicationCommandOptionType.String, required: true },
        ]},
        { name: 'stop', description: 'Para a música e desconecta do canal de voz.' },
        { name: 'skip', description: 'Pula para a próxima música na fila.' },
        { name: 'castle', description: 'Busca projetos do Castle Make and Play por nome.', options: [
            { name: 'busca', description: 'Termo para procurar nos projetos.', type: ApplicationCommandOptionType.String, required: true },
        ]},
    ];

    try {
        await client.application.commands.set(commands);
        console.log('Comandos Slash registrados com sucesso.');
    } catch (error) {
        console.error('Erro ao registrar comandos Slash:', error);
    }
});


// ----------------------------------------------------
// 3. PROCESSAMENTO DE COMANDOS SLASH (interactionCreate)
// ----------------------------------------------------
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    let args = [];

    // Mapeia opções do Slash Command para o array de argumentos posicional
    if (commandName === 'login') {
        args = [interaction.options.getString('username'), interaction.options.getString('password')];
    } else if (commandName === 'transferir') {
        args = [interaction.options.getString('id_destino'), interaction.options.getNumber('quantia')];
    } else if (commandName === 'play') {
        args = [interaction.options.getString('musica')];
    } else if (commandName === 'castle') {
        args = [interaction.options.getString('busca')];
    }
    // Saldo, Claim, Stop, Skip não precisam de argumentos

    // DeferReply inicial (resposta temporária)
    const isEphemeral = commandName !== 'play' && commandName !== 'castle';
    await interaction.deferReply({ ephemeral: isEphemeral });
    
    // Função de resposta para Slash Commands (usa editReply)
    const respond = (content) => interaction.editReply(content);

    // Contexto unificado
    const context = {
        user: interaction.user,
        member: interaction.member,
        channel: interaction.channel,
        guild: interaction.guild,
        interaction: interaction // Para acessar isChatInputCommand()
    };
    
    // Executa a lógica centralizada
    await executeCommand(commandName, args, context, respond, isEphemeral);
});


// ----------------------------------------------------
// 4. PROCESSAMENTO DE COMANDOS PREFIXO (messageCreate)
// ----------------------------------------------------
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (!msg.content.startsWith(PREFIX)) return;

    const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    
    // Lista de comandos suportados
    const supportedCommands = ['login', 'saldo', 'claim', 'transferir', 'play', 'stop', 'skip', 'castle'];

    if (!supportedCommands.includes(cmd)) return;

    // Remove comandos antigos (apenas notificação)
    if (cmd === "addcoins" || cmd === "remcoins") {
        return msg.reply("❌ Comandos `!addcoins` e `!remcoins` foram descontinuados. Use `!claim` ou `!transferir`.");
    }
    
    // Função de resposta para Prefix Commands (usa message.reply)
    const respond = (content) => msg.reply(content);

    // Contexto unificado
    const context = {
        user: msg.author,
        member: msg.member,
        channel: msg.channel,
        guild: msg.guild,
        interaction: null // Indica que não é uma Interaction
    };

    // Executa a lógica centralizada
    await executeCommand(cmd, args, context, respond, false);
});


// ----------------------------------------------------
// 5. EVENTOS DISTUBE E DEBUGGING
// ----------------------------------------------------
distube
    .on('playSong', (queue, song) => 
        queue.textChannel.send(
            `🎶 Tocando: **${song.name}** - \`${song.formattedDuration}\``
        )
    )
    .on('addSong', (queue, song) =>
        queue.textChannel.send(
            `📜 Adicionado à fila: ${song.name} - \`${song.formattedDuration}\``
        )
    )
    .on('error', (channel, e) => {
        if (channel) channel.send(`❌ Erro encontrado: ${e.toString().slice(0, 190)}`);
        console.error(e);
    })
    .on('empty', queue => 
        queue.textChannel.send('Canal de voz vazio. Saindo...')
    )
    .on('finish', queue => 
        queue.textChannel.send('✅ Fila vazia, desconectando do canal de voz.')
    );

client.on('debug', info => {
    console.log(`[DEBUG] ${info}`);
});

client.login(process.env.TOKEN);
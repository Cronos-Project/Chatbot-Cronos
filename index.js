require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
const { enviarWhatsapp } = require('./whatsapp');
const conectarMongo = require('./db');
const Agendamento = require('./models/Agendamento');
const moment = require('moment');

// ------------------------- Configurações -------------------------

const servicosDisponiveis = {
  "Corte": 30,
  "Barba": 20,
  "Corte + Barba": 45
};

const barbeiros = [
  { nome: "João", id: "joao" },
  { nome: "Pedro", id: "pedro" },
  { nome: "Lucas", id: "lucas" }
];

const horariosPermitidos = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

const userStates = {};

// ------------------------- Funções auxiliares -------------------------

function normalizeService(input) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mapService(input) {
  const normalized = normalizeService(input);
  if (/^corte$/.test(normalized)) return "Corte";
  if (/^barba$/.test(normalized)) return "Barba";
  if (/^(corte(\s*[\+&e]\s*)barba)$/.test(normalized)) return "Corte + Barba";
  return null;
}

function normalizeDate(input) {
  const cleaned = input.replace(/-/g, '/').trim();
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  let [, d, m, y] = match;
  d = d.padStart(2, '0');
  m = m.padStart(2, '0');
  y = y.length === 2 ? '20' + y : y;

  return `${d}/${m}/${y}`;
}

function normalizeTime(input) {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  let [, h, m] = match;
  h = h.padStart(2, '0');
  const normalized = `${h}:${m}`;
  if (!horariosPermitidos.includes(normalized)) return null;

  return normalized;
}

// ------------------------- Inicialização -------------------------

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

(async () => {
  await conectarMongo();
})();

// ------------------------- Comandos -------------------------

bot.onText(/\/ajuda/, (msg) => {
  bot.sendMessage(msg.chat.id, `
ℹ️ *Comandos disponíveis:*
/ajuda - Ver comandos
/servicos - Ver serviços disponíveis
/horarios - Ver horários disponíveis
/agendar - Iniciar novo agendamento
/cancelar - Cancelar agendamento atual
`, { parse_mode: 'Markdown' });
});

bot.onText(/\/servicos/, (msg) => {
  bot.sendMessage(msg.chat.id, `
💈 *Serviços disponíveis:*
 💇 Corte — R$ ${servicosDisponiveis["Corte"].toFixed(2)}
 🧔 Barba — R$ ${servicosDisponiveis["Barba"].toFixed(2)}
 ✂️ Corte + Barba — R$ ${servicosDisponiveis["Corte + Barba"].toFixed(2)}
`, { parse_mode: 'Markdown' });
});

bot.onText(/\/horarios/, (msg) => {
  bot.sendMessage(msg.chat.id, `
🕒 *Horário de atendimento:*
Segunda a Sábado
Das 09:00 às 16:00
`, { parse_mode: 'Markdown' });
});

bot.onText(/\/agendar/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { step: 'ask_name' };
  bot.sendMessage(chatId, '👋 Vamos começar um novo agendamento!\nQual é o seu nome?');
});

bot.onText(/\/cancelar/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { step: 'cancel_nome' };
  bot.sendMessage(chatId, '❌ Vamos cancelar um agendamento. Por favor, informe seu nome:');
});

// ------------------------- Fluxo de mensagens -------------------------

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  if (text.startsWith('/')) return;

  if (!userStates[chatId]) {
    userStates[chatId] = { step: 'ask_name' };
    return bot.sendMessage(chatId, `
👋 *Bem-vindo à Barbearia X!*

ℹ️ *Comandos disponíveis:*
/ajuda - Ver comandos
/servicos - Ver serviços disponíveis
/horarios - Ver horários de atendimento
/agendar - Iniciar um novo agendamento
/cancelar - Cancelar agendamento atual

🕒 *Horário de atendimento:*
Segunda a Sábado, das 09:00 às 16:00

Para começar, digite seu nome abaixo:
`, { parse_mode: 'Markdown' });
  }

  const state = userStates[chatId];

  try {
    switch (state.step) {

      case 'ask_name':
        state.name = text;
        state.step = 'ask_phone';
        bot.sendMessage(chatId, '📞 Qual seu número de WhatsApp (com DDD)? Ex: 11987654321');
        break;

      case 'ask_phone':
        state.phone = text;
        state.step = 'ask_service';
        bot.sendMessage(chatId, `Qual serviço você deseja?\n💇 Corte — R$ ${servicosDisponiveis["Corte"].toFixed(2)}\n🧔 Barba — R$ ${servicosDisponiveis["Barba"].toFixed(2)}\n💈 Corte + Barba — R$ ${servicosDisponiveis["Corte + Barba"].toFixed(2)}`);
        break;

      case 'ask_service': {
        const service = mapService(text);
        if (!service) return bot.sendMessage(chatId, '❌ Serviço inválido. Escolha entre: Corte, Barba ou Corte + Barba.');

        state.service = service;
        state.price = servicosDisponiveis[service];
        state.step = 'ask_date';
        bot.sendMessage(chatId, '📅 Informe a data do agendamento (DD/MM/AAAA):');
        break;
      }

      case 'ask_date': {
        const normalizedDate = normalizeDate(text);
        if (!normalizedDate || !moment(normalizedDate, 'DD/MM/YYYY', true).isValid()) {
          return bot.sendMessage(chatId, '❌ Data inválida. Use um formato válido (DD/MM/YYYY). Ex: 01/09/2025');
        }

        const dataInformada = moment(normalizedDate, 'DD/MM/YYYY');
        if (dataInformada.isoWeekday() === 7) return bot.sendMessage(chatId, '⛔ Não realizamos atendimentos aos domingos.');
        if (dataInformada.isBefore(moment(), 'day')) return bot.sendMessage(chatId, '⛔ A data informada já passou.');
        if (dataInformada.isAfter(moment().add(1, 'year').startOf('day'))) return bot.sendMessage(chatId, '📅 Só é possível agendar até 1 ano a partir de hoje.');

        state.date = normalizedDate;
        state.step = 'ask_barber';

        // Mostra lista de barbeiros disponíveis
        bot.sendMessage(chatId, `💈 Escolha um barbeiro disponível:\n${barbeiros.map(b => `- ${b.nome}`).join('\n')}\n\nDigite o nome do barbeiro desejado:`);
        break;
      }

      case 'ask_barber': {
        const barber = barbeiros.find(b => b.nome.toLowerCase() === text.toLowerCase().trim());
        if (!barber) {
          return bot.sendMessage(chatId, `❌ Barbeiro inválido. Escolha entre:\n${barbeiros.map(b => b.nome).join(', ')}`);
        }

        state.barber = barber;
        state.step = 'ask_time';

        // Busca horários ocupados apenas para o barbeiro escolhido
        const agendamentos = await Agendamento.find({ data: state.date });
        const horariosOcupados = agendamentos
          .filter(a => a.barbeiro === state.barber.id) // ✅ filtra pelo barbeiro selecionado
          .map(a => a.horario);

        const horariosDisponiveis = horariosPermitidos.filter(h => !horariosOcupados.includes(h));

        if (horariosDisponiveis.length === 0) {
          return bot.sendMessage(chatId, `😓 Não há horários disponíveis para ${state.date} com ${state.barber.nome}. Escolha outra data.`);
        }

        bot.sendMessage(chatId, `⏰ Horários disponíveis para ${state.date} com ${state.barber.nome}:\n${horariosDisponiveis.join('\n')}\n\nDigite o horário desejado (HH:MM):`);
        break;
      }

      case 'ask_time': {
        const normalizedTime = normalizeTime(text);
        if (!normalizedTime) return bot.sendMessage(chatId, `⏰ Horário inválido ou indisponível. Escolha entre: ${horariosPermitidos.join(', ')}`);

        const horarioInformado = moment(`${state.date} ${normalizedTime}`, 'DD/MM/YYYY HH:mm');
        if (horarioInformado.isBefore(moment())) return bot.sendMessage(chatId, '⛔ Esse horário já passou. Escolha outro.');

        state.time = normalizedTime;
        state.step = 'done';

        const resumo = `✅ *Agendamento confirmado!*\n
📛 Nome: ${state.name}
📱 WhatsApp: ${state.phone}
🛠️ Serviço: ${state.service}
💈 Barbeiro: ${state.barber.nome}
💰 Valor: R$ ${state.price.toFixed(2)}
📅 Data: ${state.date}
⏰ Horário: ${state.time}`;

        bot.sendMessage(chatId, resumo, { parse_mode: 'Markdown' });

        await Agendamento.create({
          nome: state.name,
          telefone: state.phone,
          servico: state.service,
          barbeiro: state.barber.id,
          data: state.date,
          horario: state.time,
          valor: state.price
        });

        await enviarWhatsapp(state.phone, `Olá ${state.name}, seu agendamento para ${state.service} com ${state.barber.nome} (R$ ${state.price}) está confirmado para ${state.date} às ${state.time} 💈`);

        const [dia, mes, ano] = state.date.split('/');
        const [hora, minuto] = state.time.split(':');
        const dataAgendada = new Date(ano, mes - 1, dia, hora, minuto);
        const lembrete = new Date(dataAgendada.getTime() - 60 * 60 * 1000);

        schedule.scheduleJob(lembrete, () => {
          bot.sendMessage(chatId, `🔔 Olá ${state.name}! Lembrete: seu horário na Barbearia X é às ${state.time} do dia ${state.date}. Até logo! 💈`);
        });

        delete userStates[chatId];
        break;
      }

      case 'cancel_nome':
        state.name = text;
        state.step = 'cancel_data';
        bot.sendMessage(chatId, '📅 Informe a *data do agendamento* que deseja cancelar (DD/MM/AAAA):', { parse_mode: 'Markdown' });
        break;

      case 'cancel_data': {
        const normalizedDate = normalizeDate(text);
        if (!normalizedDate || !moment(normalizedDate, 'DD/MM/YYYY', true).isValid()) {
          return bot.sendMessage(chatId, '❌ Data inválida. Use um formato válido (DD/MM/YYYY). Ex: 01/09/2025');
        }
        state.date = normalizedDate;
        state.step = 'cancel_time';
        bot.sendMessage(chatId, '⏰ Informe o *horário do agendamento* que deseja cancelar (HH:MM):', { parse_mode: 'Markdown' });
        break;
      }

      case 'cancel_time': {
        const normalizedTime = normalizeTime(text);
        if (!normalizedTime) return bot.sendMessage(chatId, '❌ Horário inválido. Use o formato HH:MM.');
        state.time = normalizedTime;

        const agendamentoMongo = await Agendamento.findOneAndDelete({
          nome: state.name,
          data: state.date,
          horario: state.time
        });

        if (agendamentoMongo) {
          bot.sendMessage(chatId, `✅ Agendamento de *${state.name}* para *${state.date} às ${state.time}* cancelado com sucesso!`, { parse_mode: 'Markdown' });
        } else {
          bot.sendMessage(chatId, '❌ Agendamento não encontrado no sistema. Verifique as informações.');
        }

        delete userStates[chatId];
        break;
      }

    }
  } catch (error) {
    console.error('Erro no fluxo de mensagens:', error);
    bot.sendMessage(chatId, '⚠️ Ocorreu um erro. Por favor, tente novamente.');
  }
});



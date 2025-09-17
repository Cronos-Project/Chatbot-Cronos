const express = require('express');
const cors = require('cors');
const conectarMongo = require('./db');
const Agendamento = require('./models/Agendamento');

const app = express();
const PORT = process.env.PORT || 3000;

// Conectar ao MongoDB
conectarMongo();

// Middlewares
app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => {
  res.send('Servidor rodando junto com o bot 🚀');
});

// Listar agendamentos
app.get('/agendamentos', async (req, res) => {
  try {
    const agendamentos = await Agendamento.find().sort({ data: 1, horario: 1 });
    res.json(agendamentos);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

// Criar agendamento
app.post('/agendamentos', async (req, res) => {
  try {
    const novoAgendamento = new Agendamento(req.body);
    await novoAgendamento.save();
    res.status(201).json(novoAgendamento);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar agendamento' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Express ativo na porta ${PORT}`);
});
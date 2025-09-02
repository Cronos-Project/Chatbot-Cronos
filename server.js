const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Servidor rodando junto com o bot 🚀');
});

app.listen(PORT, () => {
  console.log(`Servidor Express ativo na porta ${PORT}`);
});
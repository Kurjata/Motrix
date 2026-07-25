'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const { PORT, MEDIA_DIR, ROOT } = require('./config');
const catalogosRouter = require('./routes/catalogos');
const arquivosRouter = require('./routes/arquivos');
const itensRouter = require('./routes/itens');
const fornecedoresRouter = require('./routes/fornecedores');
const imagensRouter = require('./routes/imagens');
const exportarRouter = require('./routes/exportar');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', immutable: true }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/fornecedores', fornecedoresRouter);
app.use('/api/catalogos', catalogosRouter);
app.use('/api/catalogos/:catalogoId/arquivos', arquivosRouter);
app.use('/api/catalogos/:catalogoId/itens', itensRouter);
app.use('/api/catalogos/:catalogoId/imagens', imagensRouter);
app.use('/api/catalogos/:catalogoId/exportar', exportarRouter);

app.use((req, res) => res.status(404).json({ erro: 'Rota nao encontrada.' }));

// eslint-disable-next-line no-unused-vars -- assinatura de 4 args e o que marca o handler de erro no express
app.use((erro, req, res, next) => {
  if (erro instanceof multer.MulterError) {
    return res.status(400).json({ erro: `Falha no upload: ${erro.message}` });
  }
  if (erro.status && erro.status < 500) {
    return res.status(erro.status).json({ erro: erro.message });
  }
  console.error(erro);
  res.status(500).json({ erro: erro.message || 'Erro interno.' });
});

app.listen(PORT, () => {
  console.log(`Catalogo DE-PARA rodando em http://localhost:${PORT}`);
});

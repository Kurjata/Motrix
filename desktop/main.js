'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');

/**
 * Processo principal do aplicativo de desktop.
 * O mesmo servidor Express do modo servidor roda aqui dentro, numa porta livre
 * escolhida pelo sistema; a janela e so um navegador apontado para ele.
 */

const NOME = 'Catálogo - Peças Automotivas';

// O nome de exibicao tem acento e espaco; a pasta de dados nao pode ter, para nao
// depender de codificacao do sistema de arquivos. Precisa vir antes de getPath.
app.setName('catalogo-pecas-automotivas');

// Os dados do usuario NAO podem ficar junto do programa: em C:\Program Files nao ha
// permissao de escrita e o app.asar e somente leitura. Vao para a pasta do usuario.
process.env.DATA_DIR = path.join(app.getPath('userData'), 'dados');

const ICONE = path.join(__dirname, 'icone.ico');
let janela = null;
let servidor = null;

// Duas instancias abririam dois servidores sobre o mesmo banco SQLite.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  });
}

function montarMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => janela?.reload() },
        { type: 'separator' },
        { label: 'Sair', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', role: 'undo' },
        { label: 'Refazer', role: 'redo' },
        { type: 'separator' },
        { label: 'Recortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Colar', role: 'paste' },
        { label: 'Selecionar tudo', role: 'selectAll' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Aumentar zoom', role: 'zoomIn' },
        { label: 'Diminuir zoom', role: 'zoomOut' },
        { label: 'Zoom normal', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Tela cheia', role: 'togglefullscreen' },
        { label: 'Ferramentas do desenvolvedor', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Onde ficam meus dados',
          click: () => shell.openPath(process.env.DATA_DIR),
        },
        {
          label: `Sobre o ${NOME}`,
          click: () => dialog.showMessageBox(janela, {
            type: 'info',
            title: `Sobre o ${NOME}`,
            message: `${NOME} ${app.getVersion()}`,
            detail: 'Controle de peças catalogadas.\n\n'
              + `Banco e arquivos importados: ${process.env.DATA_DIR}`,
            buttons: ['Fechar'],
          }),
        },
      ],
    },
  ]));
}

function criarJanela(url) {
  janela = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: NOME,
    icon: ICONE,
    backgroundColor: '#12161c', // evita o flash branco antes da pagina pintar
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  janela.once('ready-to-show', () => janela.show());
  janela.on('closed', () => { janela = null; });

  // catalogo exportado e downloads abrem no navegador padrao: la o usuario tem
  // o Ctrl+P para salvar em PDF e a pasta de downloads dele
  janela.webContents.setWindowOpenHandler(({ url: destino }) => {
    shell.openExternal(destino);
    return { action: 'deny' };
  });

  janela.loadURL(url);
  if (process.env.CATALOGO_AUTOTESTE === '1') autoteste(url);
}

/**
 * Verificacao automatica do empacotamento: sobe, confere que o servidor responde e que a
 * tela carregou de verdade, imprime o resultado e sai. Usado para testar o .exe gerado.
 */
function autoteste(url) {
  janela.webContents.once('did-finish-load', async () => {
    try {
      const saude = await fetch(`${url}/api/health`).then((r) => r.json());
      const titulo = await janela.webContents.executeJavaScript('document.title');
      const telaMontada = await janela.webContents
        .executeJavaScript('!!document.querySelector("#tabela-itens") && !!document.querySelector("#tema")');
      const catalogos = await fetch(`${url}/api/catalogos`).then((r) => r.json());
      const importacao = process.env.CATALOGO_TESTE_ARQUIVO
        ? await importarDeTeste(url, process.env.CATALOGO_TESTE_ARQUIVO)
        : null;

      console.log(JSON.stringify({
        servidor: saude.ok === true, titulo, telaMontada, url,
        catalogos: catalogos.length, dados: process.env.DATA_DIR, empacotado: app.isPackaged,
        importacao,
      }));

      const importacaoOk = !importacao || importacao.status === 'processado';
      app.exit(saude.ok && telaMontada && titulo === NOME && importacaoOk ? 0 : 1);
    } catch (erro) {
      console.error('autoteste falhou:', erro);
      app.exit(1);
    }
  });
}

/** Importa um arquivo de verdade, para o autoteste provar que parsers e banco funcionam. */
async function importarDeTeste(url, caminho) {
  const fs = require('fs');
  const catalogo = await fetch(`${url}/api/catalogos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Verificação da instalação' }),
  }).then((r) => r.json());

  const formulario = new FormData();
  formulario.append('fornecedor', 'Teste');
  formulario.append('arquivos', new Blob([fs.readFileSync(caminho)]), path.basename(caminho));

  const resposta = await fetch(`${url}/api/catalogos/${catalogo.id}/arquivos`, {
    method: 'POST', body: formulario,
  }).then((r) => r.json());

  return resposta.arquivos?.[0] ?? { status: 'falhou', resposta };
}

app.whenReady().then(async () => {
  try {
    const { iniciar } = require('../src/server');
    const inicio = await iniciar(0);
    servidor = inicio.servidor;

    montarMenu();
    criarJanela(inicio.url);
  } catch (erro) {
    dialog.showErrorBox(`${NOME} não conseguiu iniciar`, String(erro?.stack || erro));
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => servidor?.close());

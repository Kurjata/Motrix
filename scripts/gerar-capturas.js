'use strict';

/**
 * Tira as capturas usadas no manual, sempre do mesmo jeito e do mesmo tamanho.
 * Roda sobre um servidor ja no ar (npm start) — o Electron aqui e so o navegador,
 * nao carrega o banco, entao nao depende do modulo nativo.
 *
 *   npm start                (em outro terminal)
 *   npx electron scripts/gerar-capturas.js
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, nativeTheme } = require('electron');

const BASE = process.env.CAPTURA_BASE || 'http://localhost:3000';
const DESTINO = path.join(__dirname, '..', 'docs', 'manual', 'img');
const LARGURA = 1320;
// Cabe em tela de 1080p: a janela precisa ficar visivel durante a captura. Oculta, ela
// pinta um unico quadro no carregamento — a tabela sairia vazia e a rolagem nao apareceria.
const ALTURA = 980;

const TITULO = 'titulo=Linha%20de%20Suspens%C3%A3o%20e%20Freios&subtitulo=Tabela%20v%C3%A1lida%20para%20julho%2F2026';
const LINHA_PF1001 = 7; // a lista vem ordenada por código: AM, BU, CX, FL, PD x3, PF-1001...

const TELAS = [
  { nome: 'tela-principal', url: '/', espera: '#tabela-itens tbody tr' },
  {
    nome: 'card-importar', url: '/', espera: '#form-upload',
    recortar: 'section.cartao', margem: 16,
  },
  {
    nome: 'lista-pecas', url: '/', espera: '#tabela-itens tbody tr',
    recortar: '#tabela-itens', margem: 12, altura: 430,
  },
  {
    nome: 'painel-peca', url: '/', espera: '#tabela-itens tbody tr',
    antes: `document.querySelectorAll('#tabela-itens tbody tr [data-item]')[${LINHA_PF1001}].click()`,
    aguardar: '#form-item', recortar: '#painel', altura: 640,
  },
  {
    nome: 'bloco-precos', url: '/', espera: '#tabela-itens tbody tr',
    antes: `document.querySelectorAll('#tabela-itens tbody tr [data-item]')[${LINHA_PF1001}].click()`,
    aguardar: '#form-custo',
    recortar: 'bloco:Preço por fornecedor', margem: 10, altura: 300,
  },
  {
    // espera pela lista, nao pelo botao: o botao e HTML estatico e o clique dispararia
    // antes de o catalogo carregar, quando ele so mostra um aviso
    nome: 'nova-peca', url: '/', espera: '#tabela-itens tbody tr',
    antes: `document.querySelector('#nova-peca').click()`,
    aguardar: '#form-nova-peca', recortar: '#painel', altura: 720,
  },
  { nome: 'catalogo-cliente', url: `/api/catalogos/1/exportar/html?${TITULO}`, espera: '.peca', altura: 900 },
  {
    nome: 'catalogo-interno', url: `/api/catalogos/1/exportar/html?preco=interno&${TITULO}`,
    espera: '.preco.interno', recortar: '.peca', margem: 10, altura: 260,
  },
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarSeletor(janela, seletor, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    const achou = await janela.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(seletor)})`);
    if (achou) return true;
    await esperar(100);
  }
  throw new Error(`Não encontrei "${seletor}" na tela`);
}

/** Localiza o elemento pelo seletor, ou o bloco cujo título contém o texto depois de "bloco:". */
function scriptDoAlvo(alvo, corpo) {
  return alvo.startsWith('bloco:')
    ? `(() => {
        const titulo = ${JSON.stringify(alvo.slice(6))};
        const el = [...document.querySelectorAll('.bloco')]
          .find((b) => b.querySelector('h3')?.textContent.includes(titulo));
        if (!el) return null;
        ${corpo}
      })()`
    : `(() => {
        const el = document.querySelector(${JSON.stringify(alvo)});
        if (!el) return null;
        ${corpo}
      })()`;
}

/** Rola o alvo para o topo da vista, num passo separado da medição. */
async function rolarPara(janela, alvo) {
  await janela.webContents.executeJavaScript(
    scriptDoAlvo(alvo, `el.scrollIntoView({ block: 'start' }); return true;`),
  );
  await esperar(400);
}

async function medir(janela, alvo, margem, alturaMaxima) {
  const retangulo = await janela.webContents.executeJavaScript(
    scriptDoAlvo(alvo, `const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };`),
  );
  if (!retangulo) throw new Error(`Não consegui medir "${alvo}"`);

  const x = Math.max(Math.floor(retangulo.x - margem), 0);
  const y = Math.max(Math.floor(retangulo.y - margem), 0);
  return {
    x,
    y,
    width: Math.min(Math.ceil(retangulo.width + margem * 2), LARGURA - x),
    height: Math.min(Math.ceil(alturaMaxima ?? retangulo.height + margem * 2), ALTURA - y),
  };
}

app.whenReady().then(async () => {
  fs.mkdirSync(DESTINO, { recursive: true });

  // o manual e impresso: mesmo que o Windows esteja no escuro, as telas saem no claro
  nativeTheme.themeSource = 'light';

  const janela = new BrowserWindow({
    width: LARGURA, height: ALTURA, show: true,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });

  for (const tela of TELAS) {
    await janela.loadURL(`${BASE}${tela.url}`);
    await esperarSeletor(janela, tela.espera);
    await janela.webContents.executeJavaScript(
      `document.documentElement.dataset.tema = 'claro'; window.scrollTo(0, 0);`,
    );

    if (tela.antes) {
      await janela.webContents.executeJavaScript(tela.antes);
      if (tela.aguardar) await esperarSeletor(janela, tela.aguardar);
    }
    await esperar(400); // deixa a fonte e as imagens assentarem antes do clique do obturador

    let recorte = { x: 0, y: 0, width: LARGURA, height: Math.min(tela.altura ?? ALTURA, ALTURA) };
    if (tela.recortar) {
      await rolarPara(janela, tela.recortar);
      recorte = await medir(janela, tela.recortar, tela.margem ?? 0, tela.altura);
    }

    const imagem = await janela.webContents.capturePage(recorte);
    const arquivo = path.join(DESTINO, `${tela.nome}.png`);
    fs.writeFileSync(arquivo, imagem.toPNG());
    console.log(`${tela.nome.padEnd(20)} ${recorte.width}x${recorte.height}`);
  }

  console.log(`\nCapturas em ${DESTINO}`);
  app.exit(0);
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});

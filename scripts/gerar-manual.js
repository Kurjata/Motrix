'use strict';

/**
 * Transforma docs/manual/manual.html no PDF do manual.
 * Usa o proprio Electron (printToPDF) — mesma engine que ja vem no projeto, sem
 * gerador de PDF extra e sem depender de Word ou Acrobat instalados.
 *
 *   npx electron scripts/gerar-manual.js
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, nativeTheme } = require('electron');

const ORIGEM = path.join(__dirname, '..', 'docs', 'manual', 'manual.html');
const SAIDA = path.join(__dirname, '..', 'docs', 'Manual - Catalogo Pecas Automotivas.pdf');
const { version } = require('../package.json');

const rodape = `
  <div style="width:100%; font-family:'Bahnschrift SemiCondensed',sans-serif; font-size:7.5pt;
              color:#66707c; padding:0 16mm; display:flex; justify-content:space-between;
              letter-spacing:.1em; text-transform:uppercase;">
    <span>Catálogo · Peças Automotivas — manual de uso</span>
    <span>v${version.split('.').slice(0, 2).join('.')} · <span class="pageNumber"></span>/<span class="totalPages"></span></span>
  </div>`;

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';

  // 1240x1754 ~ A4 a 150dpi: as medidas em mm do CSS ja mandam na paginacao,
  // mas uma janela nesse formato evita reflow estranho ao montar as figuras
  const janela = new BrowserWindow({ width: 1240, height: 1754, show: false });
  await janela.loadFile(ORIGEM);

  // garante que as imagens terminaram de decodificar antes de imprimir
  await janela.webContents.executeJavaScript(
    'Promise.all([...document.images].map((i) => i.complete ? 1 : i.decode().catch(() => 1)))',
  );

  const pdf = await janela.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: { top: 0.63, bottom: 0.71, left: 0.63, right: 0.63 }, // polegadas: 16mm / 18mm
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: rodape,
    preferCSSPageSize: false,
  });

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, pdf);

  console.log(`${path.basename(SAIDA)} — ${(pdf.length / 1024 / 1024).toFixed(2)} MB`);
  app.exit(0);
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});

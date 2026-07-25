'use strict';

/**
 * Gera um PDF e um PSD de exemplo, sem depender de Word/Acrobat/Photoshop.
 * O PDF e montado na mao (objetos + xref) para nao adicionar dependencia so de teste.
 *   node scripts/gerar-pdf-psd.js [diretorio]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { writePsd } = require('ag-psd');

/** Bitmap RGB solido, para virar XObject de imagem no PDF. */
function bitmapRgb(largura, altura, [r, g, b]) {
  const dados = Buffer.alloc(largura * altura * 3);
  for (let i = 0; i < largura * altura; i++) {
    dados[i * 3] = r;
    dados[i * 3 + 1] = g;
    dados[i * 3 + 2] = b;
  }
  return dados;
}

function bitmapRgba(largura, altura, [r, g, b, a]) {
  const dados = new Uint8ClampedArray(largura * altura * 4);
  for (let i = 0; i < largura * altura; i++) {
    dados[i * 4] = r;
    dados[i * 4 + 1] = g;
    dados[i * 4 + 2] = b;
    dados[i * 4 + 3] = a;
  }
  return dados;
}

function gerarPdf(destino) {
  const LADO = 64;
  const imagem = zlib.deflateSync(bitmapRgb(LADO, LADO, [0, 120, 220]));

  const colunas = [50, 150, 320, 500];
  const linhas = [
    { y: 750, celulas: ['Codigo', 'Descricao', 'Aplicacao', 'Custo'] },
    { y: 730, celulas: ['PD-9001', 'Coxim do motor', 'VW Gol 1.0 2012 a 2016', '112,50'] },
    { y: 710, celulas: ['PD-9002', 'Batente do amortecedor', 'GM Onix 1.4 2017 a 2021', '48,90'] },
    { y: 690, celulas: ['PD-9003', 'Bieleta dianteira', 'Ford Ka 1.5 2018 a 2022', '67,30'] },
  ];

  const texto = linhas
    .flatMap((linha) => linha.celulas.map((celula, i) =>
      `BT /F1 10 Tf ${colunas[i]} ${linha.y} Td (${celula}) Tj ET`))
    .join('\n');

  // a imagem fica na altura da primeira linha de dados: o leitor deve amarra-la aquela peca
  const conteudo = `${texto}\nq ${LADO} 0 0 ${LADO} 480 728 cm /Im1 Do Q`;

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>',
    { dicionario: `<< /Length ${Buffer.byteLength(conteudo)} >>`, fluxo: Buffer.from(conteudo, 'latin1') },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    {
      dicionario: `<< /Type /XObject /Subtype /Image /Width ${LADO} /Height ${LADO} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${imagem.length} >>`,
      fluxo: imagem,
    },
  ];

  const partes = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const deslocamentos = [];
  let posicao = partes[0].length;

  objetos.forEach((objeto, indice) => {
    const corpo = typeof objeto === 'string'
      ? Buffer.from(`${indice + 1} 0 obj\n${objeto}\nendobj\n`, 'latin1')
      : Buffer.concat([
        Buffer.from(`${indice + 1} 0 obj\n${objeto.dicionario}\nstream\n`, 'latin1'),
        objeto.fluxo,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      ]);

    deslocamentos.push(posicao);
    partes.push(corpo);
    posicao += corpo.length;
  });

  const xref = ['xref', `0 ${objetos.length + 1}`, '0000000000 65535 f ']
    .concat(deslocamentos.map((d) => `${String(d).padStart(10, '0')} 00000 n `))
    .join('\n');

  partes.push(Buffer.from(
    `${xref}\ntrailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${posicao}\n%%EOF\n`,
    'latin1',
  ));

  fs.writeFileSync(destino, Buffer.concat(partes));
}

function gerarPsd(destino) {
  const psd = {
    width: 400,
    height: 300,
    imageData: { width: 400, height: 300, data: bitmapRgba(400, 300, [235, 235, 235, 255]) },
    children: [
      {
        name: 'foto da peca',
        top: 20, left: 20, bottom: 220, right: 220,
        imageData: { width: 200, height: 200, data: bitmapRgba(200, 200, [200, 60, 40, 255]) },
      },
      {
        name: 'codigo',
        top: 240, left: 20, bottom: 270, right: 380,
        text: { text: 'PS-7001  |  Bandeja suspensao  |  VW Fox 1.6 Highline 2015 a 2018  |  189,90' },
      },
      {
        name: 'cabecalho',
        top: 200, left: 20, bottom: 230, right: 380,
        text: { text: 'Codigo  |  Descricao  |  Aplicacao  |  Custo' },
      },
    ],
  };

  fs.writeFileSync(destino, Buffer.from(writePsd(psd, { generateThumbnail: false, noBackground: true })));
}

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'exemplos'));
fs.mkdirSync(dir, { recursive: true });
gerarPdf(path.join(dir, 'fabrica-catalogo.pdf'));
gerarPsd(path.join(dir, 'arte-peca.psd'));
console.log(`PDF e PSD de exemplo gerados em ${dir}`);

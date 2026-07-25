'use strict';

/**
 * Gera planilhas de exemplo em exemplos/ para testar o import sem depender
 * de arquivos reais de fornecedor.
 *   node scripts/gerar-exemplos.js [diretorio]
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// PNG 2x2 vermelho, so para exercitar a extracao de imagem da planilha
const PNG_EXEMPLO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVQIW2P8z8Dwn4EIwDiqkL4hRSkEAP//AwCJgQNZAAAAAElFTkSuQmCC',
  'base64',
);

async function planilhaAcme(destino) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tabela');

  ws.addRow(['TABELA DE PRECOS - ACME AUTOPECAS - JAN/2026']);
  ws.addRow([]);
  ws.addRow(['Codigo', 'Codigo Original (OEM)', 'Descricao', 'Aplicacao', 'Marca', 'Custo', 'Prazo (dias)', 'Foto']);
  ws.addRow(['PF-1001', '93312507', 'Pastilha de freio dianteira', 'GM Onix 1.0 8V 2016/2020', 'ACME', 78.9, 15, '']);
  ws.addRow(['PF-1002', '5U0698151 / 6R0698151', 'Pastilha de freio dianteira', 'VW Gol 1.6 2013 a 2019', 'ACME', 82.5, 15, '']);
  ws.addRow(['AM-2050', '46786554', 'Amortecedor dianteiro', 'Fiat Palio 1.0 2008/2016', 'ACME', 164.0, 20, '']);
  ws.addRow(['FL-3010', '', 'Filtro de oleo', 'Ford Ka 1.0 2015/2021', 'ACME', 21.4, 10, '']);
  ws.addRow(['BU-5500', '5U0501541', 'Bucha traseira', 'VW Fox 1.6 Comfortline 2015 a 2017', 'ACME', 34.9, 12, '']);

  const imagem = wb.addImage({ buffer: PNG_EXEMPLO, extension: 'png' });
  ws.addImage(imagem, { tl: { col: 7, row: 3 }, ext: { width: 48, height: 48 } });

  await wb.xlsx.writeFile(destino);
}

async function planilhaBeta(destino) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cotacao');

  ws.addRow(['Cod. Fornecedor', 'Codigo', 'Descricao', 'Montadora', 'Modelo', 'Ano Inicial', 'Ano Final', 'Preco de Custo']);
  ws.addRow(['B-778', 'PF-1001', 'Pastilha freio dianteira', 'CHEVROLET', 'ONIX', 2016, 2020, 71.2]);
  ws.addRow(['B-802', 'AM-2050', 'Amortecedor dianteiro', 'FIAT', 'PALIO', 2008, 2016, 158.75]);
  ws.addRow(['B-910', 'CX-4400', 'Coxim do amortecedor', 'CHEVROLET', 'ONIX', 2016, 2020, 42.3]);

  await wb.xlsx.writeFile(destino);
}

async function planilhaAcmeReajuste(destino) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tabela');

  ws.addRow(['Codigo', 'Descricao', 'Custo']);
  ws.addRow(['PF-1001', 'Pastilha de freio dianteira', 86.4]);   // +9,5%
  ws.addRow(['AM-2050', 'Amortecedor dianteiro', 164.0]);        // sem reajuste
  ws.addRow(['FL-3010', 'Filtro de oleo', 19.9]);                // -7,0%

  await wb.xlsx.writeFile(destino);
}

/** Tabela so de precos, com faixa por volume — o formato que a fabrica manda separado. */
async function planilhaPrecosVolume(destino) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Precos');

  ws.addRow(['TABELA DE PRECOS ACME - VIGENCIA 01/03/2026']);
  ws.addRow([]);
  ws.addRow(['Codigo', 'Descricao', '1 a 99', '100 a 199', 'Acima de 200']);
  ws.addRow(['PF-1001', 'Pastilha de freio dianteira', 78.9, 71.0, 66.5]);
  ws.addRow(['AM-2050', 'Amortecedor dianteiro', 164.0, 151.9, 143.2]);

  await wb.xlsx.writeFile(destino);
}

async function main() {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'exemplos'));
  fs.mkdirSync(dir, { recursive: true });

  await planilhaAcme(path.join(dir, 'acme-jan-2026.xlsx'));
  await planilhaBeta(path.join(dir, 'beta-cotacao.xlsx'));
  await planilhaAcmeReajuste(path.join(dir, 'acme-jul-2026.xlsx'));
  await planilhaPrecosVolume(path.join(dir, 'acme-precos-volume.xlsx'));

  console.log(`Exemplos gerados em ${dir}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});

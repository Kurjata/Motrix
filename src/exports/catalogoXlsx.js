'use strict';

const ExcelJS = require('exceljs');
const { descreverAplicacao } = require('../services/exportService');

/**
 * Versao planilha do catalogo: e o formato que representante e cliente pedem para
 * conferir e importar em outro sistema. Uma linha por peca.
 */
async function gerarCatalogoXlsx(dados) {
  const { catalogo, opcoes, grupos, resumo } = dados;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Catálogo - Peças Automotivas';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Catalogo', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const colunas = [
    { header: 'Código', key: 'codigo', width: 16 },
    { header: 'Descrição', key: 'descricao', width: 34 },
    { header: 'Montadora', key: 'montadora', width: 16 },
    { header: 'Aplicação', key: 'aplicacao', width: 44 },
    { header: 'Equivalências', key: 'equivalencias', width: 28 },
    { header: 'Marca', key: 'marca', width: 14 },
  ];

  if (opcoes.preco !== 'nenhum') colunas.push({ header: 'Preço de venda', key: 'preco_venda', width: 15 });
  if (opcoes.preco === 'interno') {
    colunas.push(
      { header: 'Custo (1 un)', key: 'custo_base', width: 14 },
      { header: 'Melhor custo', key: 'melhor_custo', width: 14 },
      { header: 'Fornecedor', key: 'fornecedor', width: 24 },
      { header: 'Margem %', key: 'margem', width: 11 },
    );
  }

  ws.columns = colunas;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16202B' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // uma peca que serve varias montadoras aparece uma vez por grupo, como no HTML
  const vistos = new Set();
  for (const grupo of grupos) {
    for (const item of grupo.itens) {
      const chave = `${grupo.titulo ?? ''}|${item.id}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      const linha = {
        codigo: item.codigo,
        descricao: item.descricao,
        montadora: grupo.titulo ?? item.aplicacoes[0]?.montadora ?? null,
        aplicacao: item.aplicacoes.map(descreverAplicacao).join(' | '),
        equivalencias: item.equivalencias.join(' / '),
        marca: item.marca,
      };

      if (opcoes.preco !== 'nenhum') linha.preco_venda = item.preco_venda;
      if (opcoes.preco === 'interno') {
        linha.custo_base = item.custo_base;
        linha.melhor_custo = item.melhor_custo;
        linha.fornecedor = item.melhor_fornecedor;
        linha.margem = item.preco_venda && item.custo_base != null
          ? Number(((item.preco_venda - item.custo_base) / item.preco_venda) * 100)
          : null;
      }

      ws.addRow(linha);
    }
  }

  // getColumn com chave inexistente e interpretado como letra de coluna e estoura;
  // so formata o que realmente entrou no cabecalho
  const presentes = new Set(colunas.map((c) => c.key));
  for (const chave of ['preco_venda', 'custo_base', 'melhor_custo']) {
    if (presentes.has(chave)) ws.getColumn(chave).numFmt = 'R$ #,##0.00';
  }
  if (presentes.has('margem')) ws.getColumn('margem').numFmt = '0.0"%"';

  ws.autoFilter = { from: 'A1', to: { row: 1, column: colunas.length } };

  const resumoWs = workbook.addWorksheet('Resumo');
  resumoWs.columns = [{ width: 24 }, { width: 60 }];
  resumoWs.addRows([
    ['Catálogo', catalogo.nome],
    ['Título', opcoes.titulo],
    ['Peças', resumo.total_pecas],
    ['Com foto', resumo.com_foto],
    ['Sem preço de venda', resumo.sem_preco_venda],
    ['Fornecedores', resumo.fornecedores.join(', ')],
    ['Emitido em', new Date(resumo.gerado_em).toLocaleString('pt-BR')],
  ]);
  resumoWs.getColumn(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

module.exports = { gerarCatalogoXlsx };

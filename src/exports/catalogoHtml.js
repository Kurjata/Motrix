'use strict';

const fs = require('fs');
const path = require('path');
const { MEDIA_DIR } = require('../config');
const { descreverAplicacao } = require('../services/exportService');

/**
 * Catalogo de apresentacao em HTML autocontido: as fotos viram data URI, entao o arquivo
 * pode ser enviado por e-mail ou aberto sem o sistema no ar. O CSS de impressao ja prepara
 * o PDF (Ctrl+P > Salvar como PDF), sem precisar de gerador de PDF no servidor.
 */

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };

const escapar = (texto) =>
  String(texto ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const moeda = (valor) =>
  valor == null ? null : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function dataUri(caminhoRelativo) {
  try {
    const absoluto = path.join(MEDIA_DIR, caminhoRelativo);
    const tipo = MIME[path.extname(absoluto).toLowerCase()];
    if (!tipo) return null;
    return `data:${tipo};base64,${fs.readFileSync(absoluto).toString('base64')}`;
  } catch {
    return null; // arquivo sumiu do disco: o card sai sem foto, o catalogo nao quebra
  }
}

function blocoPreco(item, modo) {
  if (modo === 'nenhum') return '';

  if (modo === 'interno') {
    const faixas = item.custos.map((c) => {
      const faixa = c.qtd_min <= 1 ? '1+' : c.qtd_max ? `${c.qtd_min}–${c.qtd_max}` : `${c.qtd_min}+`;
      return `<li>${escapar(c.fornecedor)} · <b>${faixa} un</b> · ${moeda(c.custo)}</li>`;
    }).join('');

    const margem = item.preco_venda && item.custo_base != null
      ? `<div class="margem">margem ${(((item.preco_venda - item.custo_base) / item.preco_venda) * 100).toFixed(0)}%</div>`
      : '';

    return `
      <div class="preco interno">
        ${item.preco_venda ? `<div class="venda">${moeda(item.preco_venda)}</div>` : ''}
        ${margem}
        <ul class="custos">${faixas || '<li class="vazio">sem custo lançado</li>'}</ul>
      </div>`;
  }

  return item.preco_venda
    ? `<div class="preco"><span>${moeda(item.preco_venda)}</span></div>`
    : '<div class="preco vazio">sob consulta</div>';
}

function cartao(item, modo) {
  const foto = item.imagens[0] ? dataUri(item.imagens[0].caminho) : null;
  const aplicacoes = item.aplicacoes.map((a) => `<li>${escapar(descreverAplicacao(a))}</li>`).join('');
  const equivalencias = item.equivalencias.slice(0, 6).map((c) => `<span>${escapar(c)}</span>`).join('');

  return `
    <article class="peca">
      <div class="foto">${foto ? `<img src="${foto}" alt="${escapar(item.codigo ?? '')}" />` : '<div class="sem-foto">sem foto</div>'}</div>
      <div class="dados">
        <div class="codigo">${escapar(item.codigo ?? '—')}</div>
        <h3>${escapar(item.descricao ?? 'Peça sem descrição')}</h3>
        ${aplicacoes ? `<ul class="aplicacoes">${aplicacoes}</ul>` : ''}
        ${equivalencias ? `<div class="equivalencias"><b>Equivalências:</b> ${equivalencias}</div>` : ''}
      </div>
      ${blocoPreco(item, modo)}
    </article>`;
}

const ESTILO = `
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.45 "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #16202b; background: #eef1f5; }
  .folha { max-width: 210mm; margin: 0 auto; background: #fff; padding: 22px 26px 40px; }

  .capa { border-bottom: 3px solid #16202b; padding-bottom: 18px; margin-bottom: 22px; }
  .capa .marca { font-size: 26px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .capa h1 { font-size: 22px; margin: 10px 0 4px; }
  .capa .sub { color: #5b6774; font-size: 13px; }
  .capa .resumo { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 14px; font-size: 12px; color: #5b6774; }
  .capa .resumo b { color: #16202b; }

  h2.secao { font-size: 13px; text-transform: uppercase; letter-spacing: .1em; color: #fff;
             background: #16202b; padding: 6px 10px; border-radius: 4px; margin: 26px 0 12px; }

  .grade { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .peca { display: grid; grid-template-columns: 92px 1fr; gap: 12px; padding: 10px;
          border: 1px solid #d8dee6; border-radius: 8px; break-inside: avoid; page-break-inside: avoid; }
  .peca .foto img { width: 92px; height: 92px; object-fit: contain; border-radius: 6px; background: #f6f8fa; }
  .peca .sem-foto { width: 92px; height: 92px; display: flex; align-items: center; justify-content: center;
                    border: 1px dashed #cbd3dc; border-radius: 6px; color: #a4aeb9; font-size: 10px; }
  .peca .codigo { font-weight: 700; font-size: 14px; letter-spacing: .02em; }
  .peca h3 { margin: 2px 0 6px; font-size: 13px; font-weight: 600; }
  .aplicacoes { margin: 0 0 6px; padding-left: 16px; color: #41505f; font-size: 11px; }
  .equivalencias { font-size: 10.5px; color: #5b6774; }
  .equivalencias span { display: inline-block; background: #eef2f7; border-radius: 4px; padding: 1px 5px; margin: 0 3px 3px 0; }

  .preco { grid-column: 1 / -1; border-top: 1px dashed #d8dee6; margin-top: 4px; padding-top: 6px;
           text-align: right; font-size: 16px; font-weight: 700; }
  .preco.vazio { font-size: 12px; font-weight: 500; color: #8b95a1; }
  .preco.interno { text-align: left; font-size: 12px; font-weight: 400; }
  .preco.interno .venda { font-size: 15px; font-weight: 700; }
  .preco.interno .margem { color: #067647; font-size: 11px; }
  .custos { margin: 4px 0 0; padding-left: 16px; color: #41505f; }
  .custos .vazio { color: #8b95a1; list-style: none; margin-left: -16px; }

  .rodape { margin-top: 26px; border-top: 1px solid #d8dee6; padding-top: 10px;
            font-size: 10.5px; color: #8b95a1; display: flex; justify-content: space-between; }

  @media print {
    body { background: #fff; }
    .folha { max-width: none; padding: 0; }
    h2.secao { break-after: avoid; page-break-after: avoid; }
  }`;

function gerarCatalogoHtml(dados) {
  const { catalogo, opcoes, grupos, resumo } = dados;
  const gerado = new Date(resumo.gerado_em).toLocaleDateString('pt-BR');

  const secoes = grupos.map((grupo) => `
    ${grupo.titulo ? `<h2 class="secao">${escapar(grupo.titulo)}</h2>` : ''}
    <div class="grade">${grupo.itens.map((item) => cartao(item, opcoes.preco)).join('')}</div>`).join('');

  const aviso = opcoes.preco === 'interno'
    ? '<div class="capa-aviso"><b>Uso interno:</b> este documento mostra custo por fornecedor e margem.</div>'
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapar(opcoes.titulo)}</title>
<style>${ESTILO}
.capa-aviso { margin-top: 12px; padding: 6px 10px; background: #fef3f2; border: 1px solid #fecdc9;
              border-radius: 6px; color: #b42318; font-size: 11.5px; }</style>
</head>
<body>
  <div class="folha">
    <header class="capa">
      <div class="marca">Peças Automotivas</div>
      <h1>${escapar(opcoes.titulo)}</h1>
      ${opcoes.subtitulo ? `<div class="sub">${escapar(opcoes.subtitulo)}</div>` : ''}
      <div class="resumo">
        <span><b>${resumo.total_pecas}</b> peças</span>
        <span><b>${resumo.com_foto}</b> com foto</span>
        ${opcoes.preco === 'interno' && resumo.fornecedores.length
          // de quem voce compra nao vai no catalogo do cliente: e justamente o ativo do negocio
          ? `<span>Fornecedores: <b>${escapar(resumo.fornecedores.join(', '))}</b></span>` : ''}
        <span>Emitido em <b>${gerado}</b></span>
      </div>
      ${aviso}
    </header>

    ${secoes || '<p>Nenhuma peça encontrada com os filtros aplicados.</p>'}

    <footer class="rodape">
      <span>${escapar(catalogo.nome)}</span>
      <span>Emitido em ${gerado}</span>
    </footer>
  </div>
</body>
</html>`;
}

module.exports = { gerarCatalogoHtml };

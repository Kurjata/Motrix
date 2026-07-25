'use strict';

/**
 * Monta um catalogo de demonstracao completo: importa todos os exemplos, precifica
 * com margem e imprime os links de exportacao.
 *   node scripts/semear-demo.js [http://localhost:3000]
 */

const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3000';
const EXEMPLOS = path.join(__dirname, '..', 'exemplos');

const ARQUIVOS = [
  { arquivo: 'acme-jan-2026.xlsx', fornecedor: 'ACME Autopeças', vigencia: '2026-01-10' },
  { arquivo: 'beta-cotacao.xlsx', fornecedor: 'BETA Distribuidora', vigencia: '2026-02-01' },
  { arquivo: 'acme-precos-volume.xlsx', fornecedor: 'ACME Autopeças', vigencia: '2026-03-01' },
  { arquivo: 'fabrica-catalogo.pdf', fornecedor: 'Delta Componentes', vigencia: '2026-04-01' },
  { arquivo: 'arte-peca.psd', fornecedor: 'Delta Componentes', vigencia: '2026-04-01' },
  { arquivo: 'acme-jul-2026.xlsx', fornecedor: 'ACME Autopeças', vigencia: '2026-07-01' },
];

async function api(rota, opcoes = {}) {
  const resposta = await fetch(`${BASE}${rota}`, opcoes);
  const corpo = resposta.status === 204 ? null : await resposta.json();
  if (!resposta.ok) throw new Error(`${rota} -> ${resposta.status} ${JSON.stringify(corpo)}`);
  return corpo;
}

async function main() {
  const catalogo = await api('/api/catalogos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: 'Catálogo Demonstração',
      descricao: 'Peças importadas de planilha, PDF e PSD',
    }),
  });

  for (const { arquivo, fornecedor, vigencia } of ARQUIVOS) {
    const form = new FormData();
    form.append('fornecedor', fornecedor);
    form.append('vigencia', vigencia);
    form.append('arquivos', new Blob([fs.readFileSync(path.join(EXEMPLOS, arquivo))]), arquivo);

    const resposta = await api(`/api/catalogos/${catalogo.id}/arquivos`, { method: 'POST', body: form });
    const r = resposta.arquivos[0];
    console.log(`${arquivo.padEnd(26)} ${r.itens} peça(s), ${r.novos} nova(s), ${r.custos} preço(s), ${r.imagens} imagem(ns)`);
  }

  const precificacao = await api(`/api/catalogos/${catalogo.id}/exportar/precificar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ margem: 45, base: 'custo_base' }),
  });
  console.log(`\nPrecificado: ${precificacao.precificados} de ${precificacao.itens_com_custo} peças com custo (margem 45%).`);

  const opcoes = 'titulo=Linha%20de%20Suspens%C3%A3o%20e%20Freios&subtitulo=Tabela%20v%C3%A1lida%20para%20julho%2F2026';
  console.log(`\nCatálogo (cliente): ${BASE}/api/catalogos/${catalogo.id}/exportar/html?${opcoes}`);
  console.log(`Catálogo (interno): ${BASE}/api/catalogos/${catalogo.id}/exportar/html?preco=interno&${opcoes}`);
  console.log(`Planilha:           ${BASE}/api/catalogos/${catalogo.id}/exportar/xlsx?${opcoes}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});

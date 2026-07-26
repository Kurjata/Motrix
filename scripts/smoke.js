'use strict';

/**
 * Teste de fumaca ponta a ponta contra a API HTTP.
 * Suba o servidor (npm start) com DATA_DIR limpo e rode:
 *   node scripts/smoke.js [http://localhost:3000] [dir-exemplos]
 */

const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3000';
const EXEMPLOS = path.resolve(process.argv[3] || path.join(__dirname, '..', 'exemplos'));

let falhas = 0;
function checar(descricao, condicao, detalhe) {
  const ok = Boolean(condicao);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${descricao}${detalhe !== undefined ? ` -> ${JSON.stringify(detalhe)}` : ''}`);
}

async function api(rota, opcoes = {}) {
  const resposta = await fetch(`${BASE}${rota}`, opcoes);
  const corpo = resposta.status === 204 ? null : await resposta.json();
  if (!resposta.ok) throw new Error(`${rota} -> ${resposta.status} ${JSON.stringify(corpo)}`);
  return corpo;
}

const apiJson = (rota, metodo, dados) =>
  api(rota, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });

async function enviar(catalogoId, arquivo, campos) {
  const form = new FormData();
  for (const [chave, valor] of Object.entries(campos)) form.append(chave, valor);
  form.append('arquivos', new Blob([fs.readFileSync(path.join(EXEMPLOS, arquivo))]), arquivo);
  const resposta = await api(`/api/catalogos/${catalogoId}/arquivos`, { method: 'POST', body: form });
  return resposta.arquivos[0];
}

async function main() {
  const catalogo = await apiJson('/api/catalogos', 'POST', { nome: `Smoke ${Date.now()}` });
  const rotaItens = `/api/catalogos/${catalogo.id}/itens`;

  // ---------------------------------------------------------------- importacao
  const acme = await enviar(catalogo.id, 'acme-jan-2026.xlsx', {
    fornecedor: 'ACME Autopecas Ltda', vigencia: '2026-01-10',
  });
  checar('acme: 5 pecas novas', acme.itens === 5 && acme.novos === 5, acme);
  checar('acme: 5 precos e 1 imagem', acme.custos === 5 && acme.imagens === 1);

  const beta = await enviar(catalogo.id, 'beta-cotacao.xlsx', {
    fornecedor: 'BETA Distribuidora S.A.', vigencia: '2026-02-01',
  });
  checar('beta: consolidou pelo codigo, so 1 peca nova', beta.novos === 1, beta);

  const volume = await enviar(catalogo.id, 'acme-precos-volume.xlsx', {
    fornecedor: 'ACME Autopecas', vigencia: '2026-03-01',
  });
  checar('tabela de precos: 4 faixas novas (as base ja existiam iguais)', volume.custos === 4, volume);
  checar('tabela de precos nao criou peca nova', volume.novos === 0);

  const reajuste = await enviar(catalogo.id, 'acme-jul-2026.xlsx', {
    fornecedor: 'ACME Autopecas', vigencia: '2026-07-01',
  });
  checar('reajuste: 2 alteracoes (1 preco igual nao conta)', reajuste.custos === 2, reajuste);

  // a tabela de fornecedores e global: conta so os deste teste, para o smoke poder
  // rodar num banco que ja tem outros catalogos
  const fornecedores = await api('/api/fornecedores');
  checar('nome normalizado nao duplicou ACME (Ltda x sem Ltda)',
    fornecedores.filter((f) => /ACME/i.test(f.nome)).length === 1,
    fornecedores.filter((f) => /ACME/i.test(f.nome)).map((f) => f.nome));

  // ---------------------------------------------------------------- consolidacao
  const lista = await api(`${rotaItens}?limite=100`);
  checar('6 pecas consolidadas', lista.total === 6, lista.total);

  const pastilha = lista.itens.find((i) => i.codigo === 'PF-1001');
  checar('PF-1001 custo base = 71,20 (BETA, comprando pouco)', pastilha.custo_base === 71.2, pastilha.custo_base);
  checar('PF-1001 melhor custo = 66,50 (ACME, acima de 200 un)', pastilha.melhor_custo === 66.5, pastilha.melhor_custo);
  checar('PF-1001 tem 2 faixas de volume', pastilha.qtd_faixas_volume === 2, pastilha.qtd_faixas_volume);
  checar('PF-1001 DE-PARA guardou o OEM 93312507',
    pastilha.codigos.some((c) => c.tipo === 'de' && c.codigo === '93312507'));

  const faixa200 = pastilha.custos.find((c) => c.qtd_min === 200);
  checar('faixa "acima de 200" ficou sem teto', faixa200 && faixa200.qtd_max === null, faixa200);

  const bucha = lista.itens.find((i) => i.codigo === 'BU-5500');
  const aplicacao = bucha.aplicacoes[0];
  checar('BU-5500 interpretou versao COMFORTLINE',
    aplicacao.montadora === 'VOLKSWAGEN' && aplicacao.modelo === 'FOX'
      && aplicacao.motor === '1.6' && aplicacao.versao === 'COMFORTLINE'
      && aplicacao.ano_inicio === 2015 && aplicacao.ano_fim === 2017, aplicacao);
  checar('BU-5500 monta a descricao de vitrine',
    bucha.descricao_completa === 'VOLKSWAGEN | Bucha traseira | FOX 1.6 COMFORTLINE 2015-2017',
    bucha.descricao_completa);

  // ---------------------------------------------------------------- filtros
  const porMontadora = await api(`${rotaItens}?montadora=VOLKSWAGEN`);
  checar('filtro por montadora VOLKSWAGEN traz 2 pecas', porMontadora.total === 2, porMontadora.total);

  const montadoras = await api(`${rotaItens}/-/montadoras`);
  checar('lista de montadoras alimenta o filtro', montadoras.length === 4, montadoras.map((m) => m.nome));

  const idBeta = fornecedores.find((f) => /BETA/i.test(f.nome)).id;
  const porFornecedor = await api(`${rotaItens}?fornecedor_id=${idBeta}`);
  checar('filtro por fornecedor BETA traz 3 pecas', porFornecedor.total === 3, porFornecedor.total);

  // ---------------------------------------------------------------- edicao
  const editado = await apiJson(`${rotaItens}/${bucha.id}`, 'PATCH', {
    descricao: 'Bucha da bandeja traseira', quantidade: 12,
  });
  checar('PATCH altera descricao e quantidade',
    editado.descricao === 'Bucha da bandeja traseira' && editado.quantidade === 12,
    { descricao: editado.descricao, quantidade: editado.quantidade });

  await apiJson(`${rotaItens}/${bucha.id}/aplicacoes`, 'POST', {
    montadora: 'Volkswagen', modelo: 'Fox', motor: '1.6', versao: 'Highline', ano_inicio: 2015, ano_fim: 2017,
  });
  const comHighline = await api(`${rotaItens}/${bucha.id}`);
  checar('Highline entra sem substituir a Comfortline',
    comHighline.aplicacoes.length === 2, comHighline.aplicacoes.map((a) => a.versao));

  await apiJson(`${rotaItens}/${bucha.id}/codigos`, 'POST', { codigo: '5U0-501-542', tipo: 'similar' });
  const buscaNovoCodigo = await api(`${rotaItens}?busca=5U0501542`);
  checar('codigo adicionado a mao entra na busca', buscaNovoCodigo.total === 1, buscaNovoCodigo.total);

  await apiJson(`${rotaItens}/${bucha.id}/custos`, 'POST', {
    fornecedor_id: idBeta, custo: 31.5, qtd_min: 50,
  });
  const comCusto = await api(`${rotaItens}/${bucha.id}`);
  checar('preco lancado a mao vira faixa vigente',
    comCusto.custos.some((c) => c.qtd_min === 50 && c.custo === 31.5), comCusto.custos);

  // ---------------------------------------------------------------- pdf e psd
  const pdf = await enviar(catalogo.id, 'fabrica-catalogo.pdf', {
    fornecedor: 'PDF Autopecas', vigencia: '2026-04-01',
  });
  checar('pdf: leu as 3 pecas da tabela', pdf.itens === 3 && pdf.novos === 3, pdf);
  checar('pdf: extraiu a imagem da pagina', pdf.imagens === 1, pdf.imagens);

  const doPdf = await api(`${rotaItens}?busca=PD-9001`);
  const coxim = doPdf.itens[0];
  checar('pdf: imagem ficou na peca da linha em que estava', coxim.imagens.length === 1, coxim.imagens);
  checar('pdf: aplicacao interpretada do texto da pagina',
    coxim.aplicacoes[0]?.montadora === 'VOLKSWAGEN' && coxim.aplicacoes[0]?.modelo === 'GOL'
      && coxim.aplicacoes[0]?.ano_inicio === 2012, coxim.aplicacoes[0]);
  checar('pdf: custo entrou como preco do fornecedor', coxim.custo_base === 112.5, coxim.custo_base);

  const psd = await enviar(catalogo.id, 'arte-peca.psd', {
    fornecedor: 'PSD Estudio', vigencia: '2026-04-01',
  });
  checar('psd: leu a peca das camadas de texto', psd.itens === 1 && psd.novos === 1, psd);
  checar('psd: trouxe composta + arte da camada', psd.imagens === 2, psd.imagens);

  const doPsd = await api(`${rotaItens}?busca=PS-7001`);
  const bandeja = doPsd.itens[0];
  checar('psd: as 2 imagens ficaram na peca, com uma principal so',
    bandeja.imagens.length === 2 && bandeja.imagens.filter((m) => m.principal).length === 1,
    bandeja.imagens.map((m) => m.principal));
  checar('psd: versao Highline interpretada', bandeja.aplicacoes[0]?.versao === 'HIGHLINE',
    bandeja.aplicacoes[0]?.versao);

  // ---------------------------------------------------------------- imagens
  const rotaImagens = `/api/catalogos/${catalogo.id}/imagens`;
  const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVQIW2P8z8Dwn4EIwDiqkL4hRSkEAP//AwCJgQNZAAAAAElFTkSuQmCC', 'base64');
  const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  async function enviarFoto(nome, buffer, itemId) {
    const form = new FormData();
    if (itemId) form.append('item_id', String(itemId));
    form.append('imagem', new Blob([buffer]), nome);
    return api(rotaImagens, { method: 'POST', body: form });
  }

  const daPlanilha = await api(`${rotaImagens}?item_id=${pastilha.id}`);
  checar('foto ancorada na linha do Excel ficou na peca certa',
    daPlanilha.length === 1 && /linha 4/.test(daPlanilha[0].ancora), daPlanilha[0]?.ancora);

  await enviarFoto('solta.png', PNG_B);
  const soltas = await api(`${rotaImagens}?soltas=1`);
  checar('foto sem peca aparece na lista de soltas', soltas.length === 1, soltas.length);

  await apiJson(`${rotaImagens}/${soltas[0].id}`, 'PATCH', { item_id: bucha.id });
  const comFoto = await api(`${rotaItens}/${bucha.id}`);
  checar('foto adotada vira a principal da peca',
    comFoto.imagens.length === 1 && comFoto.imagens[0].principal === 1, comFoto.imagens);
  checar('lista de soltas esvaziou', (await api(`${rotaImagens}?soltas=1`)).length === 0);

  await enviarFoto('segunda.png', PNG_A, bucha.id);
  const duas = await api(`${rotaItens}/${bucha.id}`);
  checar('segunda foto entra sem roubar o posto de principal',
    duas.imagens.length === 2 && duas.imagens[0].principal === 1, duas.imagens.map((m) => m.principal));

  await enviarFoto('segunda.png', PNG_A, bucha.id);
  checar('subir a mesma foto de novo nao duplica',
    (await api(`${rotaItens}/${bucha.id}`)).imagens.length === 2);

  const secundaria = duas.imagens.find((m) => !m.principal);
  await apiJson(`${rotaImagens}/${secundaria.id}`, 'PATCH', { principal: true });
  const trocada = await api(`${rotaItens}/${bucha.id}`);
  checar('trocar a principal troca a foto de vitrine',
    trocada.imagens[0].id === secundaria.id && trocada.imagens[0].principal === 1,
    trocada.imagens.map((m) => ({ id: m.id, principal: m.principal })));

  await api(`${rotaImagens}/${secundaria.id}`, { method: 'DELETE' });
  const restante = (await api(`${rotaItens}/${bucha.id}`)).imagens;
  checar('remover a principal promove a foto que sobrou',
    restante.length === 1 && restante[0].principal === 1, restante);

  // ---------------------------------------------------------------- peça cadastrada a mao
  const nova = await apiJson(rotaItens, 'POST', {
    codigo: 'MN-0001',
    descricao: 'Bieleta traseira',
    marca: 'Generica',
    quantidade: 4,
    aplicacao: { montadora: 'Fiat', modelo: 'Argo', motor: '1.3', versao: 'Drive', ano_inicio: 2019, ano_fim: 2024 },
  });
  checar('cria peça do zero, com aplicação junto',
    nova.codigo === 'MN-0001' && nova.aplicacoes.length === 1
      && nova.aplicacoes[0].montadora === 'FIAT' && nova.aplicacoes[0].versao === 'DRIVE',
    { codigo: nova.codigo, aplicacoes: nova.aplicacoes });
  checar('peça manual entra na busca por código com separadores',
    (await api(`${rotaItens}?busca=mn.00-01`)).total === 1);

  const repetida = await fetch(`${BASE}${rotaItens}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'MN-0001', descricao: 'Outra' }),
  });
  const corpoRepetida = await repetida.json();
  checar('código repetido responde 409 apontando a peça existente',
    repetida.status === 409 && corpoRepetida.item_id === nova.id, corpoRepetida);

  checar('peça sem código e sem descrição é recusada',
    (await fetch(`${BASE}${rotaItens}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marca: 'X' }),
    })).status === 400);

  // as mesmas funcionalidades da peça importada valem para a criada a mão
  await apiJson(`${rotaItens}/${nova.id}/codigos`, 'POST', { codigo: '51-888-123', tipo: 'de' });
  await apiJson(`${rotaItens}/${nova.id}/custos`, 'POST', { fornecedor_id: idBeta, custo: 44.5, qtd_min: 1 });
  await apiJson(`${rotaItens}/${nova.id}/custos`, 'POST', { fornecedor_id: idBeta, custo: 39.9, qtd_min: 100 });
  await apiJson(`${rotaItens}/${nova.id}/aplicacoes`, 'POST', { montadora: 'Fiat', modelo: 'Cronos', ano_inicio: 2018 });
  await enviarFoto('manual.png', PNG_B, nova.id);
  const completa = await api(`${rotaItens}/${nova.id}`);

  checar('peça manual aceita código OEM, 2 aplicações, 2 faixas de preço e foto',
    completa.codigos.filter((c) => c.tipo === 'de').length === 1
      && completa.aplicacoes.length === 2 && completa.custos.length === 2
      && completa.imagens.length === 1 && completa.imagens[0].principal === 1,
    { codigos: completa.codigos.length, aplicacoes: completa.aplicacoes.length,
      custos: completa.custos.length, imagens: completa.imagens.length });
  checar('peça manual entra no melhor custo por volume',
    completa.custo_base === 44.5 && completa.melhor_custo === 39.9,
    { base: completa.custo_base, melhor: completa.melhor_custo });
  checar('peça manual sai no catálogo exportado',
    (await (await fetch(`${BASE}/api/catalogos/${catalogo.id}/exportar/html`)).text()).includes('MN-0001'));

  await api(`${rotaItens}/${nova.id}`, { method: 'DELETE' });
  checar('excluir peça manual remove também códigos, aplicações e preços',
    (await api(`${rotaItens}?busca=MN-0001`)).total === 0
      && (await api(`${rotaItens}?busca=51888123`)).total === 0);

  // ---------------------------------------------------------------- historico
  const detalhe = await api(`${rotaItens}/${pastilha.id}`);
  const baseAcme = detalhe.historico_custo.filter((h) => /ACME/i.test(h.fornecedor) && h.qtd_min === 1);
  checar('historico da faixa base ACME tem 2 vigencias', baseAcme.length === 2, baseAcme.map((h) => h.custo));
  checar('reajuste da faixa base ~ +9,51%',
    Math.abs(baseAcme.find((h) => h.variacao_percentual !== null).variacao_percentual - 9.5057) < 0.01);
  checar('reajuste da base nao mexeu na faixa de volume',
    detalhe.custos_vigentes.filter((c) => c.qtd_min === 200 && c.custo === 66.5).length === 1);

  // ---------------------------------------------------------------- exportacao
  const rotaExportar = `/api/catalogos/${catalogo.id}/exportar`;

  const precificacao = await apiJson(`${rotaExportar}/precificar`, 'POST', { margem: 45, base: 'custo_base' });
  checar('precificacao em massa preencheu o preco de venda',
    precificacao.precificados > 0 && precificacao.precificados === precificacao.itens_com_custo, precificacao);

  const semSobrescrever = await apiJson(`${rotaExportar}/precificar`, 'POST', { margem: 60 });
  checar('rodar de novo nao sobrescreve preco ja definido', semSobrescrever.precificados === 0, semSobrescrever);

  const precificado = (await api(`${rotaItens}?busca=PD-9001`)).itens[0];
  // 112,50 + 45% = 163,125 -> arredonda para cima terminando em ,90
  checar('preco de venda = custo + 45%, terminando em ,90',
    precificado.preco_venda === 163.9, { custo: precificado.custo_base, venda: precificado.preco_venda });
  checar('margem calculada sobre o preco de venda',
    Math.abs(precificado.margem_percentual - 31.36) < 0.05, precificado.margem_percentual);

  const previa = await api(`${rotaExportar}/previa?agrupar=montadora`);
  checar('previa conta pecas e fotos', previa.total_pecas === 10 && previa.com_foto === 4, previa);
  checar('previa agrupa por montadora', previa.grupos.length === 4, previa.grupos.map((g) => g.titulo));

  const previaFiltrada = await api(`${rotaExportar}/previa?montadora=VOLKSWAGEN`);
  checar('exportacao respeita o filtro de montadora', previaFiltrada.total_pecas === 4, previaFiltrada.total_pecas);

  const respostaHtml = await fetch(`${BASE}${rotaExportar}/html?titulo=Catalogo%20de%20Teste`);
  const html = await respostaHtml.text();
  checar('html traz titulo, pecas e foto embutida',
    html.includes('Catalogo de Teste') && html.includes('PD-9001') && html.includes('data:image/png;base64,'),
    { titulo: html.includes('Catalogo de Teste'), peca: html.includes('PD-9001'), foto: html.includes('data:image/png;base64,') });
  checar('html de cliente nao vaza custo nem fornecedor',
    !html.includes('ACME') && !html.includes('Uso interno'), { temAcme: html.includes('ACME') });

  const htmlInterno = await (await fetch(`${BASE}${rotaExportar}/html?preco=interno`)).text();
  checar('html interno mostra custo por fornecedor e aviso',
    htmlInterno.includes('Uso interno') && htmlInterno.includes('ACME'), null);

  const respostaXlsx = await fetch(`${BASE}${rotaExportar}/xlsx`);
  const xlsx = Buffer.from(await respostaXlsx.arrayBuffer());
  checar('planilha do catalogo baixa como xlsx valido',
    xlsx.length > 5000 && xlsx.subarray(0, 2).toString() === 'PK'
      && /attachment; filename=".*\.xlsx"/.test(respostaXlsx.headers.get('content-disposition')),
    { bytes: xlsx.length, nome: respostaXlsx.headers.get('content-disposition') });

  console.log(falhas ? `\n${falhas} verificacao(oes) falharam.` : '\nTodas as verificacoes passaram.');
  process.exit(falhas ? 1 : 0);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});

'use strict';

const estado = {
  catalogoId: null,
  pagina: 1,
  limite: 50,
  busca: '',
  montadora: '',
  fornecedorId: '',
  fornecedores: [],
  item: null,
};

const $ = (seletor) => document.querySelector(seletor);
const moeda = (valor) =>
  valor == null ? '—' : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const escapar = (texto) =>
  String(texto ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ tema

const TEMA_CHAVE = 'motrix:tema';
const preferenciaEscura = window.matchMedia('(prefers-color-scheme: dark)');

const lerTemaSalvo = () => {
  try {
    return localStorage.getItem(TEMA_CHAVE);
  } catch {
    return null; // navegacao privada: usa o tema do sistema e nao insiste
  }
};

/** O tema que esta valendo agora: o escolhido ou, na falta dele, o do sistema. */
const temaEfetivo = () => lerTemaSalvo() || (preferenciaEscura.matches ? 'escuro' : 'claro');

function pintarBotaoTema() {
  const escuro = temaEfetivo() === 'escuro';
  const botao = $('#tema');
  botao.textContent = escuro ? '☀ Claro' : '☾ Escuro';
  botao.setAttribute('aria-label', escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
}

function aplicarTema(tema) {
  if (tema) {
    document.documentElement.dataset.tema = tema;
    try {
      localStorage.setItem(TEMA_CHAVE, tema);
    } catch { /* sem persistencia: vale para esta sessao */ }
  }
  pintarBotaoTema();
}

// enquanto o usuario nao escolher, acompanha o sistema
preferenciaEscura.addEventListener('change', () => { if (!lerTemaSalvo()) pintarBotaoTema(); });

async function api(rota, opcoes) {
  const resposta = await fetch(rota, opcoes);
  const corpo = resposta.status === 204 ? null : await resposta.json();
  if (!resposta.ok) throw new Error(corpo?.erro || `Falha na requisição (${resposta.status})`);
  return corpo;
}

async function apiJson(rota, metodo, dados) {
  return api(rota, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
}

function mostrarAviso(texto, ehErro = false) {
  const caixa = $('#resultado-upload');
  caixa.textContent = texto;
  caixa.classList.toggle('erro', ehErro);
  caixa.classList.remove('oculto');
}

/** "a partir de 100 un" para faixas de volume. */
function rotuloFaixa(custo) {
  if (custo.qtd_min <= 1) return '1+';
  return custo.qtd_max ? `${custo.qtd_min}–${custo.qtd_max}` : `${custo.qtd_min}+`;
}

// ------------------------------------------------------------------ carregamento

async function carregarCatalogos() {
  const catalogos = await api('/api/catalogos');
  const select = $('#catalogo');

  if (!catalogos.length) {
    select.innerHTML = '<option value="">— nenhum catálogo —</option>';
    estado.catalogoId = null;
    return;
  }

  select.innerHTML = catalogos
    .map((c) => `<option value="${c.id}">${escapar(c.nome)} (${c.total_itens} peças)</option>`)
    .join('');
  estado.catalogoId = catalogos.some((c) => c.id === estado.catalogoId) ? estado.catalogoId : catalogos[0].id;
  select.value = estado.catalogoId;
}

async function carregarFornecedores() {
  estado.fornecedores = await api('/api/fornecedores');
  $('#fornecedores').innerHTML = estado.fornecedores.map((f) => `<option value="${escapar(f.nome)}"></option>`).join('');
  $('#filtro-fornecedor').innerHTML = '<option value="">Todos os fornecedores</option>'
    + estado.fornecedores.map((f) => `<option value="${f.id}">${escapar(f.nome)}</option>`).join('');
  $('#filtro-fornecedor').value = estado.fornecedorId;
}

async function carregarMontadoras() {
  if (!estado.catalogoId) return;
  const montadoras = await api(`/api/catalogos/${estado.catalogoId}/itens/-/montadoras`);
  $('#filtro-montadora').innerHTML = '<option value="">Todas as montadoras</option>'
    + montadoras.map((m) => `<option value="${escapar(m.nome)}">${escapar(m.nome)} (${m.itens})</option>`).join('');
  $('#filtro-montadora').value = estado.montadora;
}

function linhaItem(item) {
  const foto = item.imagens[0]
    ? `<img class="miniatura" src="${item.imagens[0].url}" alt="" />`
    : '<div class="sem-foto"></div>';

  const fornecedores = item.qtd_fornecedores > 1
    ? `${escapar(item.melhor_fornecedor)} <span class="suave">(+${item.qtd_fornecedores - 1})</span>`
    : escapar(item.melhor_fornecedor ?? '') || '<span class="suave">—</span>';

  const volume = item.qtd_faixas_volume
    ? `${moeda(item.melhor_custo)} <span class="suave">no volume</span>`
    : '<span class="suave">—</span>';

  return `
    <tr class="clicavel" data-item="${item.id}">
      <td>${foto}</td>
      <td><strong>${escapar(item.codigo ?? '—')}</strong></td>
      <td>${escapar(item.descricao_completa) || '<span class="suave">sem descrição</span>'}</td>
      <td>${fornecedores}</td>
      <td class="num">${moeda(item.custo_base ?? item.melhor_custo)}</td>
      <td class="num">${volume}</td>
      <td><button class="secundario mini" data-item="${item.id}">Editar</button></td>
    </tr>`;
}

async function carregarItens() {
  const corpo = $('#tabela-itens tbody');
  if (!estado.catalogoId) return (corpo.innerHTML = '');

  const parametros = new URLSearchParams({ pagina: estado.pagina, limite: estado.limite });
  if (estado.busca) parametros.set('busca', estado.busca);
  if (estado.montadora) parametros.set('montadora', estado.montadora);
  if (estado.fornecedorId) parametros.set('fornecedor_id', estado.fornecedorId);

  const dados = await api(`/api/catalogos/${estado.catalogoId}/itens?${parametros}`);
  corpo.innerHTML = dados.itens.length
    ? dados.itens.map(linhaItem).join('')
    : '<tr><td colspan="7" class="suave">Nenhuma peça encontrada.</td></tr>';

  const paginas = Math.max(Math.ceil(dados.total / estado.limite), 1);
  $('#contador').textContent = `— ${dados.total} peça(s)`;
  $('#pagina-atual').textContent = `Página ${estado.pagina} de ${paginas}`;
  $('#anterior').disabled = estado.pagina <= 1;
  $('#proxima').disabled = estado.pagina >= paginas;
}

async function atualizarTudo() {
  await carregarCatalogos();
  await Promise.all([carregarFornecedores(), carregarMontadoras(), carregarItens()]);
}

// ------------------------------------------------------------------ painel de edicao

function blocoFotos(item, soltas) {
  const fotos = item.imagens.map((m) => `
    <figure class="foto ${m.principal ? 'principal' : ''}">
      <img src="${m.url}" alt="" />
      <figcaption>
        ${m.principal ? '<span class="tag">principal</span>'
          : `<button class="secundario mini" data-principal="${m.id}">tornar principal</button>`}
        <button class="secundario mini" data-remover-foto="${m.id}">remover</button>
      </figcaption>
    </figure>`).join('') || '<div class="suave">Nenhuma foto nesta peça.</div>';

  const orfas = soltas.length ? `
    <h3 style="margin-top:14px">Fotos sem peça (${soltas.length})</h3>
    <p class="dica">Vieram dos arquivos importados sem dar para saber a qual peça pertencem.</p>
    <div class="galeria">
      ${soltas.slice(0, 24).map((m) => `
        <figure class="foto">
          <img src="${m.url}" alt="" title="${escapar(m.arquivo ?? '')}" />
          <figcaption><button class="secundario mini" data-adotar-foto="${m.id}">é desta peça</button></figcaption>
        </figure>`).join('')}
    </div>` : '';

  return `
    <div class="bloco">
      <h3>Fotos</h3>
      <div class="galeria">${fotos}</div>
      <form id="form-foto" class="acoes">
        <input type="file" name="imagem" accept="image/*" required />
        <button type="submit">Enviar foto</button>
      </form>
      ${orfas}
    </div>`;
}

function blocoAplicacoes(item) {
  const linhas = item.aplicacoes.map((a) => `
    <div>
      <span>${escapar([a.montadora, a.modelo, a.motor, a.versao].filter(Boolean).join(' '))}
        ${a.ano_inicio ? `<span class="suave">${a.ano_inicio}${a.ano_fim ? `-${a.ano_fim}` : '+'}</span>` : ''}</span>
      <button class="secundario mini" data-remover-aplicacao="${a.id}">remover</button>
    </div>`).join('') || '<div class="suave">Nenhuma aplicação cadastrada.</div>';

  return `
    <div class="bloco">
      <h3>Aplicação (veículo)</h3>
      <div class="item-lista">${linhas}</div>
      <form id="form-aplicacao" class="grade">
        <input name="montadora" placeholder="Montadora (ex.: Volkswagen)" />
        <input name="modelo" placeholder="Modelo (ex.: Fox)" />
        <input name="motor" placeholder="Motor (ex.: 1.6)" />
        <input name="versao" placeholder="Versão (ex.: Comfortline)" />
        <input name="ano_inicio" type="number" placeholder="Ano inicial" />
        <input name="ano_fim" type="number" placeholder="Ano final" />
        <button type="submit" class="largo">Adicionar aplicação</button>
      </form>
    </div>`;
}

function blocoCodigos(item) {
  const linhas = item.codigos.map((c) => `
    <div>
      <span><span class="tag">${c.tipo}</span> ${escapar(c.codigo)}</span>
      <button class="secundario mini" data-remover-codigo="${c.id}">remover</button>
    </div>`).join('') || '<div class="suave">Nenhum código equivalente.</div>';

  return `
    <div class="bloco">
      <h3>Códigos equivalentes</h3>
      <div class="item-lista">${linhas}</div>
      <form id="form-codigo" class="grade">
        <input name="codigo" placeholder="Código" required />
        <select name="tipo">
          <option value="de">do fabricante / OEM</option>
          <option value="similar">similar</option>
          <option value="para">interno</option>
        </select>
        <button type="submit" class="largo">Adicionar código</button>
      </form>
    </div>`;
}

function blocoPrecos(item) {
  const porFornecedor = new Map();
  for (const custo of item.custos) {
    if (!porFornecedor.has(custo.fornecedor)) porFornecedor.set(custo.fornecedor, []);
    porFornecedor.get(custo.fornecedor).push(custo);
  }

  const listas = [...porFornecedor.entries()].map(([fornecedor, custos]) => `
    <div>
      <span><strong>${escapar(fornecedor)}</strong><br />
        ${custos.map((c) => `<span class="tag">${rotuloFaixa(c)} un · ${moeda(c.custo)}</span>`).join('')}</span>
    </div>`).join('') || '<div class="suave">Nenhum preço importado. Suba a tabela de preços da fábrica.</div>';

  const historico = item.historico_custo.slice(0, 8).map((h) => {
    const variacao = h.variacao_percentual == null ? ''
      : `<span class="${h.variacao_percentual >= 0 ? 'reajuste-alta' : 'reajuste-baixa'}">
           ${h.variacao_percentual >= 0 ? '+' : ''}${h.variacao_percentual.toFixed(1)}%</span>`;
    return `<div><span>${h.vigencia_inicio} · ${escapar(h.fornecedor)} · ${rotuloFaixa(h)} un · ${moeda(h.custo)}
      ${h.vigencia_fim ? '<span class="suave">(encerrado)</span>' : ''}</span>${variacao}</div>`;
  }).join('') || '<div class="suave">Sem histórico ainda.</div>';

  const opcoes = estado.fornecedores.map((f) => `<option value="${f.id}">${escapar(f.nome)}</option>`).join('');

  return `
    <div class="bloco">
      <h3>Preço por fornecedor e volume</h3>
      <div class="item-lista">${listas}</div>
      <form id="form-custo" class="grade">
        <select name="fornecedor_id" required><option value="">Fornecedor...</option>${opcoes}</select>
        <input name="custo" type="number" step="0.01" placeholder="Custo (R$)" required />
        <input name="qtd_min" type="number" placeholder="A partir de (un)" value="1" />
        <input name="qtd_max" type="number" placeholder="Até (un) — opcional" />
        <button type="submit" class="largo">Lançar preço</button>
      </form>
    </div>
    <div class="bloco">
      <h3>Histórico de reajuste</h3>
      <div class="item-lista">${historico}</div>
    </div>`;
}

function desenharPainel(item, soltas) {
  estado.item = item;
  $('#painel-titulo').textContent = item.codigo || 'Peça';

  $('#painel-corpo').innerHTML = `
    <form id="form-item" class="grade">
      <label>Código<input name="codigo" value="${escapar(item.codigo ?? '')}" /></label>
      <label>Marca da peça<input name="marca" value="${escapar(item.marca ?? '')}" /></label>
      <label class="largo">Descrição
        <input name="descricao" value="${escapar(item.descricao ?? '')}" placeholder="ex.: Bucha traseira" />
      </label>
      <label>Quantidade<input name="quantidade" type="number" step="0.01" value="${item.quantidade ?? ''}" /></label>
      <label>Unidade<input name="unidade" value="${escapar(item.unidade ?? '')}" /></label>
      <label class="largo">Observação<input name="observacao" value="${escapar(item.observacao ?? '')}" /></label>
      <div class="acoes largo">
        <button type="submit">Salvar</button>
        <button type="button" id="excluir-item" class="secundario">Excluir peça</button>
      </div>
    </form>
    ${blocoFotos(item, soltas)}
    ${blocoAplicacoes(item)}
    ${blocoCodigos(item)}
    ${blocoPrecos(item)}`;

  $('#painel').classList.remove('oculto');
  $('#cortina').classList.remove('oculto');
}

async function abrirItem(itemId) {
  const [item, soltas] = await Promise.all([
    api(`/api/catalogos/${estado.catalogoId}/itens/${itemId}`),
    api(`/api/catalogos/${estado.catalogoId}/imagens?soltas=1`),
  ]);
  desenharPainel(item, soltas);
}

async function recarregarPainel() {
  await abrirItem(estado.item.id);
  await carregarItens();
  await carregarMontadoras();
}

function fecharPainel() {
  estado.item = null;
  $('#painel').classList.add('oculto');
  $('#cortina').classList.add('oculto');
}

function dadosDoFormulario(formulario) {
  return Object.fromEntries(new FormData(formulario).entries());
}

// ------------------------------------------------------------------ eventos

$('#tema').addEventListener('click', () => {
  aplicarTema(temaEfetivo() === 'escuro' ? 'claro' : 'escuro');
});

$('#catalogo').addEventListener('change', (evento) => {
  estado.catalogoId = Number(evento.target.value);
  estado.pagina = 1;
  carregarMontadoras();
  carregarItens();
});

$('#novo-catalogo').addEventListener('click', async () => {
  const nome = prompt('Nome do catálogo:');
  if (!nome?.trim()) return;
  const catalogo = await apiJson('/api/catalogos', 'POST', { nome: nome.trim() });
  estado.catalogoId = catalogo.id;
  await atualizarTudo();
});

$('#form-upload').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!estado.catalogoId) return mostrarAviso('Crie um catálogo antes de importar.', true);

  const botao = evento.target.querySelector('button[type="submit"]');
  botao.disabled = true;
  mostrarAviso('Importando...');

  try {
    const resposta = await api(`/api/catalogos/${estado.catalogoId}/arquivos`, {
      method: 'POST',
      body: new FormData(evento.target),
    });

    mostrarAviso(resposta.arquivos.map((a) => {
      if (a.status === 'erro') return `${a.nome}: erro — ${a.erro}`;
      if (a.status === 'pendente') return `${a.nome}: guardado, sem leitor ainda (${a.erro})`;
      const avisos = a.avisos?.length ? `\n   ${a.avisos.join('\n   ')}` : '';
      return `${a.nome}: ${a.itens} peça(s), ${a.novos} nova(s), ${a.custos} preço(s), ${a.imagens} imagem(ns)${avisos}`;
    }).join('\n'));

    evento.target.querySelector('input[type="file"]').value = '';
    await atualizarTudo();
  } catch (erro) {
    mostrarAviso(erro.message, true);
  } finally {
    botao.disabled = false;
  }
});

$('#tabela-itens').addEventListener('click', (evento) => {
  const alvo = evento.target.closest('[data-item]');
  if (alvo) abrirItem(alvo.dataset.item).catch((erro) => mostrarAviso(erro.message, true));
});

$('#fechar-painel').addEventListener('click', fecharPainel);
$('#cortina').addEventListener('click', fecharPainel);
document.addEventListener('keydown', (evento) => { if (evento.key === 'Escape') fecharPainel(); });

$('#painel-corpo').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const rotaItem = `/api/catalogos/${estado.catalogoId}/itens/${estado.item.id}`;
  const dados = dadosDoFormulario(evento.target);

  try {
    if (evento.target.id === 'form-foto') {
      const formulario = new FormData(evento.target);
      formulario.append('item_id', estado.item.id);
      await api(`/api/catalogos/${estado.catalogoId}/imagens`, { method: 'POST', body: formulario });
      return recarregarPainel();
    }
    if (evento.target.id === 'form-item') await apiJson(rotaItem, 'PATCH', dados);
    if (evento.target.id === 'form-aplicacao') await apiJson(`${rotaItem}/aplicacoes`, 'POST', dados);
    if (evento.target.id === 'form-codigo') await apiJson(`${rotaItem}/codigos`, 'POST', dados);
    if (evento.target.id === 'form-custo') await apiJson(`${rotaItem}/custos`, 'POST', dados);
    await recarregarPainel();
  } catch (erro) {
    alert(erro.message);
  }
});

$('#painel-corpo').addEventListener('click', async (evento) => {
  const rotaItem = `/api/catalogos/${estado.catalogoId}/itens/${estado.item.id}`;
  const { removerAplicacao, removerCodigo, adotarFoto, principal, removerFoto } = evento.target.dataset;
  const rotaImagens = `/api/catalogos/${estado.catalogoId}/imagens`;

  try {
    if (adotarFoto) {
      await apiJson(`${rotaImagens}/${adotarFoto}`, 'PATCH', { item_id: estado.item.id });
      return recarregarPainel();
    }
    if (principal) {
      await apiJson(`${rotaImagens}/${principal}`, 'PATCH', { principal: true });
      return recarregarPainel();
    }
    if (removerFoto) {
      await api(`${rotaImagens}/${removerFoto}`, { method: 'DELETE' });
      return recarregarPainel();
    }
    if (removerAplicacao) {
      await api(`${rotaItem}/aplicacoes/${removerAplicacao}`, { method: 'DELETE' });
      return recarregarPainel();
    }
    if (removerCodigo) {
      await api(`${rotaItem}/codigos/${removerCodigo}`, { method: 'DELETE' });
      return recarregarPainel();
    }
    if (evento.target.id === 'excluir-item') {
      if (!confirm('Excluir esta peça do catálogo?')) return;
      await api(rotaItem, { method: 'DELETE' });
      fecharPainel();
      await carregarItens();
    }
  } catch (erro) {
    alert(erro.message);
  }
});

// ------------------------------------------------------------------ exportacao

/** Junta as opcoes do formulario com os filtros da lista: o catalogo sai do que esta na tela. */
function parametrosExportacao() {
  const formulario = new FormData($('#form-exportar'));
  const parametros = new URLSearchParams();

  for (const [chave, valor] of formulario.entries()) {
    if (String(valor).trim()) parametros.set(chave, valor);
  }
  if (estado.montadora) parametros.set('montadora', estado.montadora);
  if (estado.fornecedorId) parametros.set('fornecedor_id', estado.fornecedorId);

  return parametros;
}

function mostrarResumo(texto, ehErro = false) {
  const caixa = $('#resumo-exportacao');
  caixa.textContent = texto;
  caixa.classList.toggle('erro', ehErro);
  caixa.classList.remove('oculto');
}

function abrirExportacao(formato, download) {
  if (!estado.catalogoId) return mostrarResumo('Crie um catálogo antes de exportar.', true);
  const parametros = parametrosExportacao();
  if (download) parametros.set('download', '1');
  window.open(`/api/catalogos/${estado.catalogoId}/exportar/${formato}?${parametros}`, '_blank');
}

$('#abrir-previa').addEventListener('click', async () => {
  if (!estado.catalogoId) return mostrarResumo('Crie um catálogo antes de exportar.', true);
  try {
    const previa = await api(`/api/catalogos/${estado.catalogoId}/exportar/previa?${parametrosExportacao()}`);
    const semPreco = previa.sem_preco_venda
      ? ` — ${previa.sem_preco_venda} sem preço de venda (saem como "sob consulta")`
      : '';
    mostrarResumo(`${previa.total_pecas} peça(s), ${previa.com_foto} com foto${semPreco}.`);
  } catch (erro) {
    mostrarResumo(erro.message, true);
  }
  abrirExportacao('html', false);
});

$('#baixar-html').addEventListener('click', () => abrirExportacao('html', true));
$('#baixar-xlsx').addEventListener('click', () => abrirExportacao('xlsx', true));

$('#aplicar-margem').addEventListener('click', async () => {
  if (!estado.catalogoId) return mostrarResumo('Crie um catálogo antes de precificar.', true);
  try {
    const resultado = await apiJson(`/api/catalogos/${estado.catalogoId}/exportar/precificar`, 'POST', {
      margem: Number($('#margem').value),
      base: $('#base-margem').value,
      sobrescrever: $('#sobrescrever').checked,
    });
    mostrarResumo(`${resultado.precificados} peça(s) precificadas de ${resultado.itens_com_custo} com custo lançado.`);
    await carregarItens();
  } catch (erro) {
    mostrarResumo(erro.message, true);
  }
});

let temporizadorBusca;
$('#busca').addEventListener('input', (evento) => {
  clearTimeout(temporizadorBusca);
  temporizadorBusca = setTimeout(() => {
    estado.busca = evento.target.value.trim();
    estado.pagina = 1;
    carregarItens();
  }, 250);
});

$('#filtro-montadora').addEventListener('change', (evento) => {
  estado.montadora = evento.target.value;
  estado.pagina = 1;
  carregarItens();
});

$('#filtro-fornecedor').addEventListener('change', (evento) => {
  estado.fornecedorId = evento.target.value;
  estado.pagina = 1;
  carregarItens();
});

$('#anterior').addEventListener('click', () => { estado.pagina--; carregarItens(); });
$('#proxima').addEventListener('click', () => { estado.pagina++; carregarItens(); });

pintarBotaoTema();
atualizarTudo().catch((erro) => mostrarAviso(erro.message, true));

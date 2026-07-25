'use strict';

/**
 * Heuristicas de reconhecimento de colunas de catalogo de pecas.
 * A ordem importa: o primeiro padrao que casar vence, entao os padroes mais
 * especificos (codigo original, codigo interno) vem antes do generico "codigo".
 */
const CAMPOS = [
  { campo: 'codigo_fornecedor', padroes: [/c[oó]d(igo)?\.?\s*(do\s*)?(fornecedor|f[aá]brica)/i] },
  // o prefixo e obrigatorio: "Montadora" sozinho e marca de veiculo, nao codigo
  { campo: 'codigo_de', padroes: [/^(cod|c[oó]d(igo)?|ref(er[eê]ncia)?)\.?\s*(original|oem|concorrente|montadora|da\s*montadora)/i, /^(oem|original)$/i, /^de$/i] },
  { campo: 'codigo_similar', padroes: [/similar/i, /equivalen/i, /substitu/i, /^cross\s*ref/i] },
  { campo: 'codigo', padroes: [/^(cod|c[oó]d(igo)?)(\s|_|\.|$)/i, /^ref(er[eê]ncia)?$/i, /^sku$/i, /part\s*(number|no)/i, /^pn$/i, /^para$/i, /nosso\s*c[oó]digo/i, /c[oó]digo\s*interno/i] },
  { campo: 'descricao', padroes: [/descri[cç]/i, /denomina/i, /^produto$/i, /^pe[cç]a$/i, /^item$/i, /^nome$/i] },

  // aplicacao (veiculo). "marca" fica reservado a marca da peca; a do carro e "montadora".
  { campo: 'montadora', padroes: [/montadora/i, /marca\s*(do\s*)?(ve[ií]culo|carro)/i] },
  { campo: 'modelo', padroes: [/^modelo/i, /ve[ií]culo/i] },
  { campo: 'motor', padroes: [/motor/i, /cilindrada/i] },
  { campo: 'versao', padroes: [/^vers[aã]o/i, /acabamento/i, /^trim$/i, /^s[eé]rie$/i] },
  { campo: 'ano_inicio', padroes: [/ano\s*(inicial|in[ií]cio|de|a\s*partir)/i, /^ano$/i, /^de\s*\(ano\)$/i] },
  { campo: 'ano_fim', padroes: [/ano\s*(final|fim|at[eé])/i, /^at[eé]$/i] },
  { campo: 'aplicacao', padroes: [/aplica[cç]/i, /montagem/i] },

  { campo: 'marca', padroes: [/^marca$/i, /^fabricante$/i, /^brand$/i, /linha/i] },
  { campo: 'fornecedor', padroes: [/fornecedor/i, /^f[aá]brica$/i] },
  { campo: 'qtd_min', padroes: [/qtd\.?\s*m[ií]n/i, /quantidade\s*m[ií]nima/i, /^de\s*\(qtd\)$/i] },
  { campo: 'qtd_max', padroes: [/qtd\.?\s*m[aá]x/i, /quantidade\s*m[aá]xima/i, /^at[eé]\s*\(qtd\)$/i] },
  { campo: 'quantidade', padroes: [/^qtd(e)?\.?$/i, /quantidade/i, /^estoque$/i, /^saldo$/i] },

  // ordem critica: custo e venda antes do generico, que so e resolvido pelo tipo do arquivo
  { campo: 'custo', padroes: [/custo/i, /pre[cç]o\s*(de\s*)?(compra|f[aá]brica)/i, /^fob$/i, /^cotac/i] },
  { campo: 'preco_venda', padroes: [/venda/i, /sugerid/i, /^pv$/i, /varejo/i, /p[uú]blico/i, /^tabela$/i] },
  { campo: 'preco', padroes: [/^pre[cç]o/i, /^valor/i, /^price$/i, /^r\$$/i] },

  { campo: 'unidade', padroes: [/^un(id(ade)?)?\.?$/i, /^um$/i, /^emb(alagem)?$/i] },
  { campo: 'ncm', padroes: [/^ncm$/i] },
  { campo: 'prazo_dias', padroes: [/prazo/i, /lead\s*time/i] },
  { campo: 'lote_minimo', padroes: [/lote\s*m[ií]n/i, /m[ií]nimo/i, /^moq$/i] },
  { campo: 'observacao', padroes: [/observa/i, /^obs\.?$/i, /^nota$/i] },
];

const CAMPOS_NUMERICOS = new Set([
  'quantidade', 'preco', 'custo', 'preco_venda', 'ano_inicio', 'ano_fim', 'prazo_dias', 'lote_minimo',
]);

function normalizar(texto) {
  return String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cabecalhos que carregam faixa de volume no proprio rotulo:
 * "100 a 199", "Acima de 200", "200+", "Preco 100 un", "R$ p/ 50 pcs".
 * Retorna { qtd_min, qtd_max } ou null.
 */
const FAIXAS = [
  { padrao: /(\d[\d.]*)\s*(?:a|at[eé]|–|—|-|\/)\s*(\d[\d.]*)/i, ler: (m) => ({ qtd_min: inteiro(m[1]), qtd_max: inteiro(m[2]) }) },
  { padrao: /(?:acima\s*de|a\s*partir\s*de|\+\s*de|mais\s*de|>=?|min\.?)\s*(\d[\d.]*)/i, ler: (m) => ({ qtd_min: inteiro(m[1]), qtd_max: null }) },
  { padrao: /^(\d[\d.]*)\s*\+$/, ler: (m) => ({ qtd_min: inteiro(m[1]), qtd_max: null }) },
  { padrao: /(?:pre[cç]o|custo|valor|r\$)[^\d]*(\d[\d.]*)/i, ler: (m) => ({ qtd_min: inteiro(m[1]), qtd_max: null }) },
  { padrao: /(\d[\d.]*)\s*(?:un|und|pc|p[cç]s?|pe[cç]as?)\b/i, ler: (m) => ({ qtd_min: inteiro(m[1]), qtd_max: null }) },
];

function inteiro(texto) {
  const numero = Number(String(texto).replace(/\./g, ''));
  return Number.isFinite(numero) ? numero : null;
}

function detectarFaixa(rotulo) {
  const valor = normalizar(rotulo);
  if (!/\d/.test(valor) || /\bano\b/i.test(valor) || /ncm/i.test(valor)) return null;

  for (const { padrao, ler } of FAIXAS) {
    const achado = valor.match(padrao);
    if (!achado) continue;
    const faixa = ler(achado);
    // quantidade de peca em faixa comercial: acima disso e ano, codigo ou ruido
    if (!faixa.qtd_min || faixa.qtd_min > 100000) continue;
    return faixa;
  }
  return null;
}

/** Identifica o campo de negocio de um cabecalho, ou null se nao reconhecido. */
function classificarCabecalho(texto) {
  const valor = normalizar(texto);
  if (!valor) return null;
  for (const { campo, padroes } of CAMPOS) {
    if (padroes.some((p) => p.test(valor))) return campo;
  }
  return null;
}

/**
 * Recebe as N primeiras linhas de uma tabela e escolhe a que parece o cabecalho:
 * a que reconhece mais campos (minimo 2, ou 1 se for um codigo).
 * Retorna { indice, mapa: { [indiceColuna]: campo }, desconhecidas: { [indiceColuna]: rotulo } }.
 */
function detectarCabecalho(linhas, maxLinhasVarridas = 15) {
  let melhor = null;

  const limite = Math.min(linhas.length, maxLinhasVarridas);
  for (let i = 0; i < limite; i++) {
    const linha = linhas[i] || [];
    const mapa = {};
    const faixas = {};
    const desconhecidas = {};
    const vistos = new Set();

    linha.forEach((celula, col) => {
      const rotulo = normalizar(celula);
      if (!rotulo) return;

      // a faixa de volume vem antes: "Preco 100 un" e faixa, nao a coluna generica de preco
      const faixa = detectarFaixa(rotulo);
      if (faixa) {
        mapa[col] = 'custo_faixa';
        faixas[col] = faixa;
        vistos.add(`faixa:${faixa.qtd_min}`);
        return;
      }

      const campo = classificarCabecalho(rotulo);
      if (campo && !vistos.has(campo)) {
        vistos.add(campo);
        mapa[col] = campo;
      } else if (rotulo.length <= 60) {
        desconhecidas[col] = rotulo;
      }
    });

    const pontos = vistos.size + (vistos.has('codigo') || vistos.has('codigo_de') ? 1 : 0);
    if (vistos.size >= 2 && (!melhor || pontos > melhor.pontos)) {
      melhor = { indice: i, mapa, faixas, desconhecidas, pontos };
    }
  }

  return melhor
    ? { indice: melhor.indice, mapa: melhor.mapa, faixas: melhor.faixas, desconhecidas: melhor.desconhecidas }
    : null;
}

/** "R$ 1.234,56" -> 1234.56 ; "1,5" -> 1.5 ; "" -> null */
function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  let texto = String(valor).replace(/[^\d,.-]/g, '');
  if (!texto) return null;

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');
  if (temVirgula && temPonto) {
    // formato pt-BR: ponto e milhar, virgula e decimal
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    texto = texto.replace(',', '.');
  }

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

/** Converte uma linha de dados em um item, usando o mapa de colunas. */
function linhaParaItem(linha, cabecalho) {
  const item = { dados_extra: {}, faixas: [] };

  for (const [col, campo] of Object.entries(cabecalho.mapa)) {
    const bruto = linha[Number(col)];
    const valor = normalizar(bruto);
    if (!valor) continue;

    if (campo === 'custo_faixa') {
      const custo = paraNumero(bruto);
      if (custo !== null) item.faixas.push({ ...cabecalho.faixas[col], custo });
      continue;
    }

    item[campo] = CAMPOS_NUMERICOS.has(campo) ? paraNumero(bruto) : valor;
  }

  // faixa declarada em colunas proprias (uma linha por faixa)
  if (item.qtd_min || item.qtd_max) {
    const custo = item.custo ?? item.preco ?? null;
    if (custo !== null) item.faixas.push({ qtd_min: item.qtd_min || 1, qtd_max: item.qtd_max ?? null, custo });
  }

  for (const [col, rotulo] of Object.entries(cabecalho.desconhecidas || {})) {
    const valor = normalizar(linha[Number(col)]);
    if (valor) item.dados_extra[rotulo] = valor;
  }

  const temConteudo = item.codigo || item.codigo_de || item.descricao;
  return temConteudo ? item : null;
}

module.exports = {
  classificarCabecalho, detectarCabecalho, detectarFaixa, linhaParaItem, paraNumero, normalizar,
};

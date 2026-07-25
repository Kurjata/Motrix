'use strict';

/**
 * Interpretacao de aplicacao veicular vinda de texto livre de planilha.
 * Ex.: "GM Onix 1.0 8V 2016/2020" -> { montadora: 'GM', modelo: 'ONIX', motor: '1.0 8V',
 *                                      ano_inicio: 2016, ano_fim: 2020 }
 * O texto original e sempre preservado em `texto_livre` para conferencia humana.
 */

const MONTADORAS = [
  'CHEVROLET', 'GM', 'VOLKSWAGEN', 'VW', 'FIAT', 'FORD', 'TOYOTA', 'HONDA', 'HYUNDAI', 'RENAULT',
  'PEUGEOT', 'CITROEN', 'NISSAN', 'JEEP', 'RAM', 'DODGE', 'CHRYSLER', 'MERCEDES-BENZ', 'MERCEDES',
  'BMW', 'AUDI', 'VOLVO', 'SCANIA', 'IVECO', 'MAN', 'MITSUBISHI', 'KIA', 'SUZUKI', 'SUBARU',
  'CHERY', 'CAOA', 'JAC', 'BYD', 'GWM', 'LAND ROVER', 'MINI', 'PORSCHE', 'TROLLER', 'AGRALE',
  'MARCOPOLO', 'YAMAHA',
];

const APELIDOS = { GM: 'CHEVROLET', VW: 'VOLKSWAGEN', MERCEDES: 'MERCEDES-BENZ' };

// acabamentos: entram como "versao" e nao poluem o nome do modelo
const VERSOES = [
  'COMFORTLINE', 'HIGHLINE', 'TRENDLINE', 'BLUEMOTION', 'TSI', 'GTI', 'CROSS',
  'LTZ', 'PREMIER', 'MIDNIGHT', 'JOY', 'ADVANTAGE', 'ACTIV',
  'TITANIUM', 'FREESTYLE', 'SEL', 'SE', 'XLS', 'XLT', 'XL',
  'PRECISION', 'TOURING', 'EXL', 'EX', 'LX', 'LXR',
  'DYNAMIQUE', 'EXPRESSION', 'INTENSE', 'ICONIC', 'ZEN', 'LIFE',
  'LONGITUDE', 'LIMITED', 'TRAILHAWK', 'SAHARA', 'RUBICON', 'SPORT',
  'PLATINUM', 'ELITE', 'ESSENCE', 'ATTRACTIVE', 'GLX', 'GLS', 'GL',
  'LTZ+', 'LT', 'LS',
];
const REGEX_VERSAO = new RegExp(`\\b(${VERSOES.map((v) => v.replace('+', '\\+')).join('|')})\\b`, 'gi');
const MOTOR = /\b(\d\.\d)\b|\b(8V|16V|V6|V8|TDI|TSI|CRDI|FLEX|DIESEL|TURBO|GNV|ASPIRADO)\b/gi;
const ANO_INTERVALO = /\b((?:19|20)\d{2})\s*(?:\/|-|a|at[eé]|>|\.\.)\s*((?:19|20)\d{2})?\b/i;
const ANO_SOLTO = /\b((?:19|20)\d{2})\b/g;
const SEPARADOR_APLICACOES = /\s*(?:;|\n|\r|\||\/{2,})\s*/;

function limpar(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim();
}

function chaveDe(aplicacao) {
  return [aplicacao.montadora, aplicacao.modelo, aplicacao.motor, aplicacao.versao,
    aplicacao.ano_inicio, aplicacao.ano_fim]
    .map((v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9.]/g, ''))
    .join('|');
}

function extrairMontadora(texto) {
  const alvo = texto.toUpperCase();
  // testa as mais longas primeiro para "LAND ROVER" nao virar "ROVER" nem "MERCEDES-BENZ" virar "MERCEDES"
  const candidatas = [...MONTADORAS].sort((a, b) => b.length - a.length);
  for (const nome of candidatas) {
    const regex = new RegExp(`(^|[^A-Z])${nome.replace(/[-\s]/g, '[-\\s]')}([^A-Z]|$)`, 'i');
    if (regex.test(alvo)) {
      return { montadora: APELIDOS[nome] || nome, restante: texto.replace(new RegExp(nome.replace(/[-\s]/g, '[-\\s]'), 'ig'), ' ') };
    }
  }
  return { montadora: null, restante: texto };
}

function extrairAnos(texto) {
  const intervalo = texto.match(ANO_INTERVALO);
  if (intervalo) {
    return {
      ano_inicio: Number(intervalo[1]),
      ano_fim: intervalo[2] ? Number(intervalo[2]) : null,
      restante: texto.replace(intervalo[0], ' '),
    };
  }

  const soltos = [...texto.matchAll(ANO_SOLTO)].map((m) => Number(m[1]));
  if (!soltos.length) return { ano_inicio: null, ano_fim: null, restante: texto };

  return {
    ano_inicio: Math.min(...soltos),
    ano_fim: soltos.length > 1 ? Math.max(...soltos) : null,
    restante: texto.replace(ANO_SOLTO, ' '),
  };
}

function extrairMotor(texto) {
  const achados = texto.match(MOTOR);
  if (!achados) return { motor: null, restante: texto };
  const motor = [...new Set(achados.map((m) => m.toUpperCase()))].join(' ');
  return { motor, restante: texto.replace(MOTOR, ' ') };
}

function extrairVersao(texto) {
  const achados = texto.match(REGEX_VERSAO);
  if (!achados) return { versao: null, restante: texto };
  const versao = [...new Set(achados.map((v) => v.toUpperCase()))].join('/');
  return { versao, restante: texto.replace(REGEX_VERSAO, ' ') };
}

/** Interpreta um unico trecho de aplicacao. */
function interpretar(texto) {
  const original = limpar(texto);
  if (!original) return null;

  const passo1 = extrairMontadora(original);
  const passo2 = extrairAnos(passo1.restante);
  const passo3 = extrairMotor(passo2.restante);
  const passo4 = extrairVersao(passo3.restante);

  const modelo = limpar(passo4.restante).replace(/^[-–,\s]+|[-–,\s]+$/g, '') || null;
  const aplicacao = {
    montadora: passo1.montadora,
    modelo: modelo ? modelo.toUpperCase() : null,
    motor: passo3.motor,
    versao: passo4.versao,
    ano_inicio: passo2.ano_inicio,
    ano_fim: passo2.ano_fim,
    texto_livre: original,
  };

  aplicacao.chave = chaveDe(aplicacao);
  return aplicacao.chave.replace(/\|/g, '') ? aplicacao : null;
}

/**
 * Monta a lista de aplicacoes de um item a partir dos campos reconhecidos na linha.
 * Colunas estruturadas (montadora/modelo/ano) tem prioridade; o texto livre e complemento.
 */
function aplicacoesDoItem(item) {
  const resultado = new Map();

  const temEstruturado = item.montadora || item.modelo || item.ano_inicio || item.motor || item.versao;
  if (temEstruturado) {
    const aplicacao = {
      montadora: item.montadora ? String(item.montadora).toUpperCase() : null,
      modelo: item.modelo ? String(item.modelo).toUpperCase() : null,
      motor: item.motor ? String(item.motor).toUpperCase() : null,
      versao: item.versao ? String(item.versao).toUpperCase() : null,
      ano_inicio: item.ano_inicio ?? null,
      ano_fim: item.ano_fim ?? null,
      texto_livre: [item.montadora, item.modelo, item.motor, item.versao, item.ano_inicio, item.ano_fim]
        .filter(Boolean).join(' '),
    };
    aplicacao.chave = chaveDe(aplicacao);
    resultado.set(aplicacao.chave, aplicacao);
  }

  if (item.aplicacao) {
    for (const trecho of String(item.aplicacao).split(SEPARADOR_APLICACOES)) {
      const aplicacao = interpretar(trecho);
      if (aplicacao && !resultado.has(aplicacao.chave)) resultado.set(aplicacao.chave, aplicacao);
    }
  }

  return [...resultado.values()];
}

module.exports = { interpretar, aplicacoesDoItem, chaveDe, MONTADORAS };

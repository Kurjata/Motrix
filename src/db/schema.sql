-- Catalogo = um agrupamento de trabalho (ex.: "Catalogo Cliente X 2026")
CREATE TABLE IF NOT EXISTS catalogos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fornecedor = a fabrica que cota a peca. O custo sempre pertence a um fornecedor.
CREATE TABLE IF NOT EXISTS fornecedores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL UNIQUE,
  nome_norm  TEXT NOT NULL UNIQUE,
  cnpj       TEXT,
  contato    TEXT,
  prazo_dias INTEGER,
  observacao TEXT,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cada arquivo enviado (xlsx/docx/pdf/psd), com rastreio do processamento
CREATE TABLE IF NOT EXISTS arquivos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  catalogo_id       INTEGER NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,
  fornecedor_id     INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
  vigencia          TEXT,                                -- data-base da tabela (YYYY-MM-DD)
  desconto_percentual REAL,                              -- desconto negociado sobre a tabela cheia
  nome_original     TEXT NOT NULL,
  caminho           TEXT NOT NULL,
  extensao          TEXT NOT NULL,
  mime              TEXT,
  tamanho           INTEGER NOT NULL,
  hash              TEXT,
  status            TEXT NOT NULL DEFAULT 'pendente',   -- pendente|processando|processado|erro
  erro              TEXT,
  itens_extraidos   INTEGER NOT NULL DEFAULT 0,
  itens_novos       INTEGER NOT NULL DEFAULT 0,
  custos_registrados INTEGER NOT NULL DEFAULT 0,
  imagens_extraidas INTEGER NOT NULL DEFAULT 0,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  processado_em     TEXT
);
CREATE INDEX IF NOT EXISTS idx_arquivos_catalogo ON arquivos(catalogo_id);

-- Item = a peca consolidada. Uma peca so, ainda que venha de N planilhas de fabricas.
CREATE TABLE IF NOT EXISTS itens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  catalogo_id   INTEGER NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,
  arquivo_id    INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,  -- arquivo que criou o item
  codigo        TEXT,              -- codigo principal (o "PARA" / interno)
  codigo_norm   TEXT,              -- codigo principal normalizado, usado na consolidacao
  descricao     TEXT,
  marca         TEXT,
  unidade       TEXT,
  ncm           TEXT,
  quantidade    REAL,
  preco_venda   REAL,
  margem_alvo   REAL,              -- markup desejado em % sobre o custo (ex.: 45)
  observacao    TEXT,
  origem        TEXT,              -- ex.: "xlsx:Tabela ACME:linha 42"
  dados_extra   TEXT,              -- JSON com as colunas nao mapeadas
  revisado      INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_itens_catalogo ON itens(catalogo_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_itens_codigo_norm ON itens(catalogo_id, codigo_norm)
  WHERE codigo_norm IS NOT NULL;

-- DE-PARA: um item pode ter N codigos de origem e N equivalentes
CREATE TABLE IF NOT EXISTS item_codigos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,      -- 'de' (OEM/original/concorrente) | 'para' (interno) | 'similar'
  codigo      TEXT NOT NULL,
  codigo_norm TEXT NOT NULL,      -- sem separadores, uppercase: e por aqui que o DE-PARA casa
  fabricante  TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, tipo, codigo_norm)
);
CREATE INDEX IF NOT EXISTS idx_item_codigos_norm ON item_codigos(codigo_norm);

-- Aplicacao: uma peca serve varios veiculos, cada um com sua faixa de ano
CREATE TABLE IF NOT EXISTS item_aplicacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
  montadora   TEXT,
  modelo      TEXT,
  motor       TEXT,
  versao      TEXT,               -- acabamento: Comfortline, Highline, LTZ, Titanium...
  ano_inicio  INTEGER,
  ano_fim     INTEGER,
  texto_livre TEXT,               -- como veio na planilha, para conferencia
  chave       TEXT NOT NULL,      -- normalizacao usada para nao duplicar a mesma aplicacao
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, chave)
);
CREATE INDEX IF NOT EXISTS idx_aplicacoes_item ON item_aplicacoes(item_id);
CREATE INDEX IF NOT EXISTS idx_aplicacoes_modelo ON item_aplicacoes(montadora, modelo);

-- Custo por fornecedor, append-only: cada reajuste fecha a vigencia anterior e abre uma nova.
-- vigencia_fim IS NULL = custo vigente hoje.
CREATE TABLE IF NOT EXISTS item_custos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id             INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
  fornecedor_id       INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
  custo               REAL NOT NULL,
  qtd_min             INTEGER NOT NULL DEFAULT 1,   -- faixa de volume: a partir de N unidades
  qtd_max             INTEGER,                      -- NULL = sem teto ("200 ou mais")
  moeda               TEXT NOT NULL DEFAULT 'BRL',
  codigo_fornecedor   TEXT,        -- como a fabrica chama a peca
  prazo_dias          INTEGER,
  lote_minimo         REAL,
  vigencia_inicio     TEXT NOT NULL,
  vigencia_fim        TEXT,
  -- data-base da ultima tabela em que este preco apareceu. Separado da vigencia porque tabela
  -- nova com preco igual confirma o preco sem abrir vigencia nova: sem isso ele pareceria velho.
  confirmado_em       TEXT,
  variacao_percentual REAL,        -- reajuste em relacao ao custo anterior do mesmo fornecedor
  arquivo_id          INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
  observacao          TEXT,
  criado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custos_item ON item_custos(item_id);
-- cada faixa de volume tem seu proprio vigente e seu proprio historico de reajuste
CREATE UNIQUE INDEX IF NOT EXISTS idx_custos_vigente ON item_custos(item_id, fornecedor_id, qtd_min)
  WHERE vigencia_fim IS NULL;

-- Imagens extraidas dos arquivos; item_id nulo = ainda nao vinculada a uma peca
CREATE TABLE IF NOT EXISTS imagens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  catalogo_id INTEGER NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,
  arquivo_id  INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
  item_id     INTEGER REFERENCES itens(id) ON DELETE SET NULL,
  caminho     TEXT NOT NULL,
  hash        TEXT,
  largura     INTEGER,
  altura      INTEGER,
  ancora      TEXT,               -- ex.: "Tabela ACME!linha 12" ou "docx:word/media/image3.png"
  principal   INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_imagens_catalogo ON imagens(catalogo_id);
CREATE INDEX IF NOT EXISTS idx_imagens_item ON imagens(item_id);

-- Visao de trabalho.
-- custo_base   = o que se paga comprando pouco (faixa que comeca em 1 unidade)
-- melhor_custo = o menor preco vigente em qualquer faixa, ou seja, comprando volume
-- Recriada a cada carga: em banco que ja existe, CREATE VIEW IF NOT EXISTS manteria a versao
-- antiga. View nao guarda dado, entao derrubar e recriar mantem banco e codigo em sincronia.
DROP VIEW IF EXISTS vw_itens_custo;
CREATE VIEW vw_itens_custo AS
SELECT i.*,
       (SELECT MIN(c.custo) FROM item_custos c
         WHERE c.item_id = i.id AND c.vigencia_fim IS NULL AND c.qtd_min <= 1) AS custo_base,
       (SELECT MIN(c.custo) FROM item_custos c
         WHERE c.item_id = i.id AND c.vigencia_fim IS NULL)                    AS melhor_custo,
       (SELECT f.nome FROM item_custos c JOIN fornecedores f ON f.id = c.fornecedor_id
         WHERE c.item_id = i.id AND c.vigencia_fim IS NULL
         ORDER BY c.custo ASC LIMIT 1)                                         AS melhor_fornecedor,
       (SELECT COUNT(DISTINCT c.fornecedor_id) FROM item_custos c
         WHERE c.item_id = i.id AND c.vigencia_fim IS NULL)                    AS qtd_fornecedores,
       (SELECT COUNT(*) FROM item_custos c
         WHERE c.item_id = i.id AND c.vigencia_fim IS NULL AND c.qtd_min > 1)  AS qtd_faixas_volume,

       -- ultima vez que o conjunto de precos vigentes desta peca mudou
       (SELECT MAX(c.vigencia_inicio) FROM item_custos c
         WHERE c.item_id = i.id AND c.vigencia_fim IS NULL)                    AS preco_desde,

       -- melhor custo que valia imediatamente antes daquela data: e a base da comparacao.
       -- Nulo na primeira importacao, quando nao existe nada anterior com que comparar.
       (SELECT MIN(c.custo) FROM item_custos c
         WHERE c.item_id = i.id
           AND c.vigencia_inicio < (SELECT MAX(a.vigencia_inicio) FROM item_custos a
                                     WHERE a.item_id = i.id AND a.vigencia_fim IS NULL)
           AND (c.vigencia_fim IS NULL
                OR c.vigencia_fim >= (SELECT MAX(a.vigencia_inicio) FROM item_custos a
                                       WHERE a.item_id = i.id AND a.vigencia_fim IS NULL))
       )                                                                       AS melhor_custo_anterior
  FROM itens i;

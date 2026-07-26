# Motrix

Controle de peças catalogadas. Recebe os arquivos que as fábricas mandam (planilha, Word, PDF,
PSD), lê códigos e peças, consolida tudo em um catálogo único e deixa você editar cada item
para montar o seu catálogo de apresentação.

Preço não vem no catálogo de peças: entra por **tabela de preços separada**, por fornecedor,
com **faixa por volume** e histórico de reajuste.

## Rodando

### Programa para Windows (mais simples)

Gera o instalador e a versão portátil:

```bash
npm install && npm run dist
```

Saem dois arquivos em `dist/`:

| Arquivo | O que faz |
|---|---|
| `Motrix-0.2.0-instalador.exe` | instala, cria o atalho na Área de Trabalho e no menu Iniciar |
| `Motrix-0.2.0-portatil.exe` | roda direto, sem instalar — serve para pendrive |

A máquina que vai usar **não precisa de Node, Docker nem VS Code**: o Electron leva tudo dentro.
É o mesmo servidor Express rodando dentro do programa, numa porta livre escolhida na hora,
acessível só em `127.0.0.1` (não abre nada para a rede).

Seus dados ficam em `%APPDATA%\motrix\dados` — fora da pasta do programa, para sobreviverem a
uma reinstalação. O menu **Ajuda → Onde ficam meus dados** abre essa pasta; faça o backup dela.

O botão *Abrir catálogo* manda o catálogo exportado para o seu navegador padrão, que é onde
está o `Ctrl+P` para salvar em PDF e a sua pasta de downloads.

O executável **não é assinado digitalmente**. Na primeira execução o Windows mostra o aviso do
SmartScreen: *Mais informações → Executar assim mesmo*. Sumir com esse aviso exige um
certificado de assinatura de código (pago, emitido para pessoa física ou empresa).

#### O detalhe do módulo nativo

O `better-sqlite3` é compilado para uma versão específica do runtime, e o Node do sistema
(ABI 115) e o Electron (ABI 130) não usam o mesmo binário. Por isso existem dois scripts:

```bash
npm run preparar:desktop   # binário para o Electron — já roda dentro de `dist` e `desktop`
npm run preparar:node      # binário para o Node — necessário antes de `npm start` e do smoke
```

Na prática: depois de gerar o instalador, rode `npm run preparar:node` se for voltar a usar
`npm start` ou os testes. O Docker não é afetado — ele compila dentro da imagem.

O ícone é desenhado por código (`npm run icone`), sem editor de imagem: um "M" azul sobre
quadrado escuro, gerado em 16 a 256 px e empacotado como `.ico`.

### Docker (para servidor)

```bash
docker compose up -d
```

Sobe em `http://localhost:3000`. O banco, os uploads e as imagens ficam no volume
`motrix-dados`, então recriar o container não perde nada.
Para mudar a porta: `PORT=8080 docker compose up -d`.

### Local

```bash
npm install
npm start
```

Para gerar planilhas de exemplo e validar a instalação:

```bash
node scripts/gerar-exemplos.js && node scripts/gerar-pdf-psd.js && node scripts/smoke.js
```

## Como funciona

Você importa um arquivo dizendo **de qual fábrica** ele é e a **data-base**. O Motrix acha o
cabeçalho da tabela, reconhece as colunas por sinônimo e casa cada linha com uma peça que já
exista no catálogo (pelo código principal ou por qualquer código equivalente). Coluna que ele
não reconhece é preservada em `itens.dados_extra` — nada é descartado.

O mesmo upload serve para o catálogo de peças e para a tabela de preços: não há campo para
declarar o tipo, porque as colunas do arquivo já dizem o que ele é.

### Peça

| Campo | Vem de |
|---|---|
| código | coluna de código / referência / SKU |
| descrição | o que a peça é ("bucha traseira") — editável |
| aplicação | montadora, modelo, motor, **versão** (Comfortline/Highline) e faixa de ano |
| códigos equivalentes | OEM/original (`de`), interno (`para`), similar |
| fornecedores | quem cota a peça, via tabela de preços |

A descrição de vitrine é montada a partir disso:
`VOLKSWAGEN | Bucha traseira | FOX 1.6 COMFORTLINE 2015-2017`.

### Fotos

Imagem de planilha é vinculada à peça pela linha em que está ancorada. O que não dá para
amarrar sozinho — imagem de Word, logo no cabeçalho, foto flutuando entre linhas — fica na
lista de **fotos sem peça**, que aparece dentro do painel da peça para você adotar com um
clique. Também dá para subir uma foto direto na peça.

A foto **principal** é a que vai para a listagem e para o catálogo de apresentação; removendo
a principal, a próxima assume. Fotos idênticas são deduplicadas por hash.

### Preço por volume

A tabela da fábrica costuma dizer que a peça custa X na unidade, Y a partir de 100 e Z a partir
de 200. Cada faixa é uma linha própria em `item_custos`, com vigência e histórico próprios:

- `custo_base` — o que se paga comprando pouco (faixa que começa em 1);
- `melhor_custo` — o menor preço vigente em qualquer faixa, ou seja, comprando volume.

Reajustar a faixa de 1 unidade não mexe na faixa de 200.

Cabeçalhos reconhecidos como faixa: `1 a 99`, `100-199`, `200+`, `Acima de 200`,
`A partir de 50`, `Preço 100 un`. Também funciona com colunas explícitas
`Qtd mínima` / `Qtd máxima` + `Custo` (uma linha por faixa).

### Tema claro e escuro

O botão no cabeçalho alterna entre os dois. Enquanto você não escolher, o Motrix segue o tema do
sistema operacional; depois da primeira escolha, ela é gravada no navegador e passa a mandar.
Um script inline no `<head>` aplica o tema antes da primeira pintura, para a tela não piscar
branca ao abrir no escuro.

O catálogo exportado sai **sempre no claro**: é documento para impressão e envio ao cliente.

## Catálogo de apresentação

Na tela, o bloco **Catálogo de apresentação** gera o documento a partir do que estiver filtrado
na lista (montadora e fornecedor valem para a exportação também). Três saídas:

| Saída | Para quê |
|---|---|
| **Abrir catálogo** | HTML autocontido, agrupado por montadora, com foto, código, descrição, aplicação, equivalências e preço de venda. `Ctrl+P` → *Salvar como PDF* |
| **Baixar planilha** | XLSX com uma linha por peça, filtro pronto e aba de resumo |
| **Uso interno** | mesma peça mostrando custo por fornecedor, faixas de volume e margem |

O HTML embute as fotos como data URI, então o arquivo pode ser enviado por e-mail e aberto sem
o Motrix no ar. Não há gerador de PDF no servidor de propósito: o navegador já imprime em A4
com quebra de página correta, e isso evita mais uma dependência nativa no Docker.

**A versão do cliente não mostra fornecedor nem custo** — de quem você compra é justamente o
ativo do negócio. Só a exportação marcada como *uso interno* traz essa informação, e ela sai
com aviso no topo.

### Precificação em massa

`Aplicar margem` preenche o preço de venda de todas as peças que têm custo:
`preço = custo × (1 + margem%)`, arredondado para cima terminando em `,90`. Você escolhe se a
conta parte do **custo de 1 unidade** ou do **melhor custo** (comprando volume). Por padrão não
sobrescreve preço já definido — o que você ajustou à mão continua valendo.

Peça sem preço aparece no catálogo como **"sob consulta"**, nunca como zero.

## Modelo de dados

| Tabela | Papel |
|---|---|
| `catalogos` | agrupamento de trabalho |
| `arquivos` | cada arquivo importado, com fornecedor, data-base e resultado |
| `fornecedores` | as fábricas; nome normalizado evita "ACME Ltda" ≠ "ACME" |
| `itens` | a peça consolidada (uma só, ainda que venha de N arquivos) |
| `item_codigos` | equivalências: `de` (OEM), `para` (interno), `similar` |
| `item_aplicacoes` | montadora / modelo / motor / versão / faixa de ano |
| `item_custos` | **append-only**: faixa de volume × fornecedor × vigência, com variação % |
| `imagens` | fotos extraídas dos arquivos, vinculadas à peça quando possível |

O import **complementa** campos vazios e nunca sobrescreve o que você editou à mão.

## Formatos

| Formato | O que é aproveitado |
|---|---|
| `.xlsx` / `.xlsm` | tabelas + imagens ancoradas na linha da peça |
| `.docx` | tabelas + imagens embutidas (as fotos entram como "sem peça") |
| `.pdf` | tabelas reconstruídas por coordenada + imagens das páginas, amarradas à linha em que estão |
| `.psd` | imagem composta, arte de cada camada e camadas de texto (código, descrição, aplicação) |
| `.doc` / `.xls` (antigos) | aceitos e guardados, mas ficam `pendente`: salve como `.docx`/`.xlsx` |

O PDF não tem linha nem coluna — só texto com coordenada. O leitor agrupa os fragmentos por
altura para formar as linhas e agrupa as posições horizontais recorrentes para formar as
colunas; daí em diante é o mesmo reconhecimento de cabeçalho das planilhas. A imagem da página
é amarrada à peça cuja linha está na mesma altura.

**Limites conhecidos:** PDF escaneado (página que é só imagem) não tem texto para ler — as peças
não são criadas e as imagens caem na galeria de fotos sem peça; não há OCR. Imagem em JPEG2000
ou com máscara de transparência é ignorada. PSD sem camada de texto vira só fotos sem peça.
Quando o PSD descreve **uma única peça**, as imagens dele já entram vinculadas a ela.

## API

```
GET    /api/fornecedores                                POST /api/fornecedores
GET    /api/catalogos                                   POST /api/catalogos
GET    /api/catalogos/:id/arquivos                      POST /api/catalogos/:id/arquivos  (multipart)
POST   /api/catalogos/:id/arquivos/:arquivoId/reprocessar
GET    /api/catalogos/:id/itens?busca=&montadora=&fornecedor_id=&pagina=&limite=
GET    /api/catalogos/:id/itens/-/montadoras
GET    /api/catalogos/:id/itens/:itemId                 (inclui histórico de custo)
PATCH  /api/catalogos/:id/itens/:itemId                 DELETE .../itens/:itemId
POST   /api/catalogos/:id/itens/:itemId/aplicacoes      PATCH/DELETE .../aplicacoes/:aplicacaoId
POST   /api/catalogos/:id/itens/:itemId/codigos         DELETE .../codigos/:codigoId
POST   /api/catalogos/:id/itens/:itemId/custos          (lança preço de uma faixa)
GET    /api/catalogos/:id/imagens?soltas=1              POST /api/catalogos/:id/imagens  (multipart)
PATCH  /api/catalogos/:id/imagens/:imagemId             DELETE .../imagens/:imagemId
GET    /api/catalogos/:id/exportar/previa               (contagem antes de gerar)
GET    /api/catalogos/:id/exportar/html?titulo=&subtitulo=&agrupar=&preco=&montadora=&fornecedor_id=
GET    /api/catalogos/:id/exportar/xlsx                 (mesmos parâmetros)
POST   /api/catalogos/:id/exportar/precificar           { margem, base, sobrescrever }
```

## Demonstração

Sobe um catálogo completo (planilhas + PDF + PSD), precifica com 45% e imprime os links:

```bash
node scripts/semear-demo.js
```

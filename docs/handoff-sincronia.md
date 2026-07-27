# Handoff: sincronizar o progresso entre dispositivos

Documento de entrega para quem for implementar. Contém o que já foi decidido, o
que já está pronto no código, e as armadilhas que custam tempo se descobertas no
meio do caminho.

## Objetivo

Hoje o progresso vive só no `localStorage` do navegador, e trocar de máquina
exige exportar e importar um JSON à mão. O objetivo é: **abrir o site em
qualquer dispositivo, entrar com e-mail, e encontrar o histórico já lá** —
incluindo os rascunhos.

Um usuário só (o dono do repositório). Não é para virar produto multiusuário; a
autenticação existe apenas para identificar de quem são os dados.

## Decisões já tomadas

Não precisa reabrir estas discussões — foram decididas com os números da seção
seguinte na mesa.

| Decisão | Escolha | Motivo |
|---|---|---|
| Backend | **Supabase** (Postgres + Auth + Storage) | Site continua estático no GitHub Pages; o RLS resolve o isolamento por linha sem código de autorização |
| Login | **Link mágico por e-mail** | Sem senha para lembrar, sem gerenciar credencial |
| Rascunhos | **Sincronizam junto**, inclusive desenhos | Decisão explícita do dono, ciente do custo de armazenamento |
| Formato dos dados | **Um `jsonb` por usuário**, não tabelas normalizadas | Ver números abaixo: o app sempre carrega tudo de uma vez, e normalizar só serviria para consulta no servidor, que ninguém faz |
| Arquitetura | **Local-first**: `localStorage` continua sendo a cópia de trabalho | Ver "A restrição que manda em tudo" |

## Números medidos

Medidos no banco real de questões (1538 questões, 22 provas), não estimados:

| | Tamanho |
|---|---|
| Uma sessão completa de 70 questões | 3,0 KB |
| As 70 tentativas correspondentes | 9,2 KB |
| **Por simulado completo** | **12,3 KB** |
| SRS cobrindo o banco inteiro | 208,8 KB |
| SRS por tema (30 temas) | 4,4 KB |
| **Total após 100 simulados** | **1,4 MB** |
| Um desenho de rascunho (PNG) | ~28,5 KB |
| **Uma prova com desenho nas 70 questões** | **~1,9 MB** |

Duas conclusões que definem o desenho:

1. **O histórico é minúsculo.** 1,4 MB depois de 100 simulados cabe folgado num
   único `jsonb`. Não normalize por medo de volume.
2. **Os desenhos são o peso real** — uma única prova desenhada pesa mais que
   todo o histórico. Por isso eles vão para o Storage (arquivos), nunca dentro
   do `jsonb` do histórico.

## A restrição que manda em tudo: local-first

O site hoje funciona offline e carrega instantaneamente. A prova simulada dura
**4 horas**. Se a sincronia virar dependência de rede no caminho crítico, uma
oscilação de conexão no meio de um simulado pode custar respostas.

**Portanto: o `localStorage` continua sendo a fonte de verdade durante o uso.**
A sincronia é um processo de fundo que lê e escreve nele.

A consequência prática é a melhor notícia deste documento: **a camada de storage
continua síncrona e os ~28 pontos de chamada espalhados pelas páginas não mudam.**
Se você começar tornando `storage.ts` assíncrono, vai propagar `async` por
`Home`, `Exam`, `Results`, `Stats` e `Topics`, inventar estados de carregamento
onde hoje não existem, e ainda quebrar o modo offline. Não faça isso.

## O que já está pronto

O trabalho de preparação foi feito no commit `f2336ef`. O terreno está limpo:

- **`localStorage` está 100% encapsulado** em `src/lib/storage.ts` e
  `src/lib/scratch.ts`. Nenhuma página o acessa diretamente — confira com
  `grep -rn localStorage src/`.
- **Toda escrita passa por `saveData()`** (`src/lib/storage.ts:52`). É o único
  ponto onde pendurar a notificação de "algo mudou, agende um envio".
- **`loadData()` tem cache em memória** e invalida pelo evento `storage` de
  outra aba. A sincronia precisa invalidar esse cache ao aplicar dados remotos.
- **A lógica de merge já existe e está em produção**: `importData()`
  (`src/lib/storage.ts:131`) resolve conflito por timestamp, campo a campo.
  Extraia dali um `mergeAppData(local, remoto): AppData` e reaproveite nos dois
  lugares — é lógica já exercitada, não reescreva.
- **`examLogic.ts` não lê mais o storage.** As funções de montagem de prova
  recebem `attempts` por parâmetro.

### Formato atual dos dados

```ts
interface AppData {
  version: 3
  sessions: ExamSession[]
  attempts: QuestionAttemptRecord[]
  srs: Record<string, SrsState>          // por questão
  topicSrs: Record<string, TopicSrsState> // por tema
}
```

Rascunhos ficam **fora** do `AppData`, numa chave por sessão:
`poscomp-simulado:scratch:{sessionId}` → `Record<questionId, { text, drawing }>`,
onde `drawing` é um PNG em data URL. API em `src/lib/scratch.ts`.

`migrate()` em `src/lib/storage.ts:14` preenche campos novos ao carregar. Se
você acrescentar campo, acrescente o default ali e suba a `version`.

## Schema

Rodar no SQL Editor do projeto Supabase.

```sql
-- Histórico: uma linha por usuário, o AppData inteiro em jsonb.
create table public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy user_data_own on public.user_data
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Rascunhos: um arquivo JSON por sessão, em {user_id}/{session_id}.json
insert into storage.buckets (id, name, public)
values ('scratch', 'scratch', false)
on conflict (id) do nothing;

create policy scratch_own on storage.objects
  for all to authenticated
  using (
    bucket_id = 'scratch'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'scratch'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

O prefixo da pasta ser o `user_id` não é cosmético: é o que a política de acesso
usa para impedir leitura cruzada. Mantenha a convenção de caminho.

## Plano de implementação

### 1. Configuração e degradação graciosa

Dependência: `npm i @supabase/supabase-js`.

Variáveis: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, num `.env.local`
(adicione `.env*.local` ao `.gitignore`). A chave anônima é pública por design —
ela vai no bundle JavaScript de qualquer forma; quem protege os dados é o RLS.

**Requisito não negociável:** sem as variáveis definidas, o site tem que
funcionar exatamente como hoje, em modo local, sem erro e sem interface de
login. O site publicado continuará sendo construído sem elas até que os segredos
sejam configurados no GitHub — se faltar variável e o app quebrar, o site sai do
ar. Exponha um `isSyncConfigured()` e feche todos os caminhos por ele.

### 2. Autenticação — atenção ao HashRouter

O app usa `HashRouter` (`src/main.tsx:9`). O fluxo implícito do Supabase devolve
os tokens no fragmento (`#access_token=...`), que **colide com o roteador** — o
`HashRouter` vai tentar interpretar aquilo como rota.

**Use o fluxo PKCE**, que devolve `?code=...` como query string e não encosta no
fragmento:

```ts
createClient(url, key, { auth: { flowType: 'pkce' } })
```

Cadastre as URLs de redirecionamento em Authentication → URL Configuration:

- `https://gabrielfquaresma.github.io/poscomp-simulado/`
- `http://localhost:5173/poscomp-simulado/`

Interface mínima: campo de e-mail e botão na Home; quando logado, mostrar o
e-mail, o estado da sincronia e um botão de sair. Sair **não** deve apagar o
`localStorage` — os dados locais continuam valendo em modo offline.

### 3. Sincronia do histórico

- **Ao entrar e ao carregar o app logado:** baixar remoto, `mergeAppData` com o
  local, gravar o resultado local, subir o resultado. Sempre merge — nunca
  "o remoto vence" ou "o local vence", ou um dos dispositivos perde trabalho.
- **A cada escrita local:** agendar envio com atraso (3–5s após a última
  escrita), mais um envio em `visibilitychange` e `beforeunload`. Pendure em
  `saveData()`, que é o único ponto de escrita.
- **Durante a prova:** o `Exam.tsx` grava a cada 5 segundos. Não suba a cada
  gravação — junte com o mesmo atraso.
- **Ao aplicar dados remotos:** invalide o cache de `loadData()`.

### 4. Sincronia dos rascunhos

Um objeto por sessão em `scratch/{user_id}/{session_id}.json`, com o
`Record<questionId, Scratch>` inteiro.

- **Subir:** ao finalizar a sessão, e com atraso enquanto ela está aberta.
  ~1,9 MB no pior caso, então nunca a cada traço.
- **Baixar:** sob demanda. Ao abrir `Results` ou `Exam` de uma sessão cujo
  rascunho não existe localmente, buscar o arquivo. Não baixe tudo no login.
- **Apagar:** `deleteSession()` e `resetAll()` já limpam o local
  (`src/lib/storage.ts:65` e `:118`); acrescente a remoção do objeto remoto.

### 5. Publicação

O `deploy.yml` constrói sem as variáveis. Adicione os segredos no repositório e
repasse-os ao passo de build:

```yaml
- run: npm run build
  env:
    VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
    VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
```

O `ci.yml` (que roda em pull request) constrói **sem** os segredos de propósito —
é justamente o teste de que a degradação graciosa funciona. Não adicione as
variáveis lá.

## Armadilhas

**Exclusão não se propaga.** O merge é last-write-wins por id. Uma sessão
apagada no dispositivo A **volta** na próxima sincronia com o B, que ainda a
tem. O `importData` atual convive com isso porque a importação é um ato
manual e raro; numa sincronia contínua, vira bug visível. Resolva com marcações
de exclusão (uma lista de ids apagados no `AppData`, consultada no merge) ou
decida conscientemente conviver — mas decida, não descubra depois.

**Relógio do dispositivo.** O merge compara timestamps gerados pelo cliente. Um
aparelho com a hora errada pode fazer dados velhos vencerem os novos. Para uso
pessoal é aceitável; se quiser blindar, use o `updated_at` do servidor como
desempate.

**Modo estrito do React.** `main.tsx` usa `StrictMode`, que monta os efeitos
duas vezes em desenvolvimento. Um efeito de sincronia mal protegido vai disparar
duas sincronizações e possivelmente dois envios. Proteja com referência de
controle.

**Cota do plano gratuito.** 500 MB de banco e 1 GB de Storage. O histórico não
chega perto. Os desenhos, a 1,9 MB por prova desenhada, chegam em algumas
centenas de provas — longe, mas não infinito. Considere não subir desenho de
sessão descartada.

**Não normalize o `AppData` em tabelas** sem um motivo novo. Custa muito mais
código, e o único ganho real seria consulta no servidor, que este app não faz.

## Como verificar

Aceite a implementação quando:

1. **Sem as variáveis de ambiente**, o site funciona igual a hoje: sem login,
   sem erro no console, todos os modos de prova funcionando.
2. **Dois navegadores diferentes**, mesmo login: uma prova finalizada em um
   aparece no outro após recarregar. Os rascunhos também, inclusive desenhos.
3. **Conflito real:** com o mesmo login em dois navegadores, finalize provas
   diferentes em cada um **enquanto o outro está offline**. Ao reconectar, as
   duas provas têm que sobreviver. Se uma sumir, o merge está errado.
4. **Offline durante a prova:** desligue a rede no meio de um simulado. Responder,
   navegar, desenhar e finalizar têm que continuar funcionando; a sincronia
   recupera ao voltar a conexão.
5. **Isolamento:** com dois usuários diferentes, nenhum consegue ler os dados do
   outro. Teste chamando a API diretamente com o token do usuário errado, não só
   pela interface.
6. `npm run lint` e `npm run build` passam.

Vale escrever teste automatizado para o `mergeAppData` — é a lógica com risco
real de perder dados, e é pura, então testa fácil sem rede.

## Estado atual do repositório

Branch `claude/study-strategies-integration-2j91xg`, três commits à frente da
`main`, nenhum pull request aberto:

- `f2336ef` — prepara a camada de storage (é a base deste trabalho)
- `4ffdf0e` — confirmação de envio, saídas de aba, aviso de 4 alternativas
- `2b3edb4` — rascunho eletrônico e CI de pull request

O `deploy.yml` publica no GitHub Pages a cada push na `main`. O `ci.yml` roda
lint e build em pull request.

---

# Implementado

O que este documento pediu está no ar. O que segue é o registro operacional:
onde as coisas ficaram e o que foi decidido nos pontos que o handoff deixou
em aberto.

## Infraestrutura

Projeto Supabase `poscomp-simulado`, ref `nrtmgvgaxyafnjticyhr`, região
`sa-east-1` — separado do projeto `finance-control`, que continua intocado.

- Schema aplicado e versionado em `supabase/schema.sql`, para o banco poder ser
  recriado do zero sem depender do que ficou no dashboard.
- URLs de redirecionamento cadastradas: produção e `localhost:5173`, ambas com
  o `/poscomp-simulado/`.
- Segredos `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no repositório,
  repassados ao passo de build do `deploy.yml`. O `ci.yml` continua sem eles de
  propósito.
- Cadastro aberto: qualquer e-mail pode entrar e terá os próprios dados,
  isolados pelo RLS. É o que a verificação nº 5 deste documento pressupõe.

**Limite do plano gratuito que vale saber:** o SMTP embutido do Supabase manda
poucos e-mails por hora. Para uso pessoal sobra, mas se um dia o link demorar,
é aí que olhar primeiro.

## Decisões tomadas nos pontos em aberto

**Exclusão agora se propaga.** O documento mandava decidir em vez de descobrir
depois: foi implementada a marcação de exclusão. `AppData` ganhou
`deletedSessions` (id → instante), consultada no merge, e a versão subiu para 4.
Uma prova apagada num aparelho não volta mais pelo outro.

As tentativas **sobrevivem** à exclusão da sessão, como já acontecia no
`deleteSession` local: o que se apaga é a prova, não o fato de a questão ter
sido respondida um dia — é disso que vivem as estatísticas e o SRS.

**Relógio do dispositivo:** mantido o critério por timestamp de cliente, como o
documento autorizou para uso pessoal. Mas `ExamSession` ganhou `updatedAt`,
porque sem ele uma prova **em andamento** só teria o `createdAt`, que nunca
muda: dois aparelhos com o mesmo simulado aberto empatariam sempre e a cópia
velha poderia vencer a nova. Esse era um caminho real de perda de dados.

**"Resetar tudo" agora também limpa o servidor.** Sem isso a sincronia seguinte
traria tudo de volta e o botão pareceria não funcionar. O aviso de confirmação
muda de texto quando há sessão ativa, para deixar claro que o apagamento
alcança os outros dispositivos.

## Onde está o código

| Arquivo | Papel |
|---|---|
| `src/lib/merge.ts` | `mergeAppData`, `migrate`, `emptyData` — puro, sem I/O |
| `src/lib/supabase.ts` | cliente PKCE e `isSyncConfigured()` |
| `src/lib/sync.ts` | motor: auth, baixa-mescla-sobe, atraso de envio, flush |
| `src/lib/scratchSync.ts` | rascunhos no Storage, sob demanda |
| `src/components/SyncPanel.tsx` | interface de login e estado da sincronia |

`importData()` passou a usar o mesmo `mergeAppData` da sincronia: é a mesma
pergunta, e manter duas respostas para ela seria manter dois jeitos de perder
dados.

## O que foi verificado

- `npm run test` — 10 casos do `mergeAppData`, incluindo os dois cenários de
  perda de dados (prova apagada que volta, cópia velha que vence a nova).
- `npm run lint` e `npm run build`, com e sem as variáveis de ambiente. Sem
  elas, nenhuma credencial entra no bundle e o site não mostra login.
- Isolamento (verificação nº 5) testado **pela API, não pela interface**: dois
  usuários criados na mão, 11 checagens — ler a linha do outro, gravar em nome
  do outro, apagar a linha do outro, baixar e escrever na pasta de rascunho do
  outro, e ler sem login. Todas barradas. Os usuários de teste foram removidos.
- Um `?code=` na URL não confunde o `HashRouter`: a Home carrega normalmente.

**Ainda não verificado, porque depende de dois aparelhos reais e do link no
e-mail:** as verificações 2, 3 e 4 (dois navegadores com o mesmo login, o
conflito com os dois offline, e o comportamento offline no meio da prova).

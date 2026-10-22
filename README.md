# pickgo — mercado autônomo

Sistema para minimercado de condomínio sem caixa: painel do administrador
(produtos, estoque, vendas, relatórios) e totem de autoatendimento com PIX e cartão.

**Stack:** React + TypeScript + Tailwind + Recharts · Supabase (PostgreSQL, Auth,
Realtime, Storage, Edge Functions) · Mercado Pago (PIX, maquininha Point, Checkout Pro).

**Site de demonstração:** https://henriquecassou-stack.github.io/Pickgo/

## Testar agora (modo demonstração)

Abra o site acima ou rode no seu computador:

```bash
npm install
npm run dev
```

Sem `.env.local`, o app abre em **modo demonstração**: a mesma migração e o mesmo
seed do Supabase rodam dentro do navegador (PGlite) e os pagamentos são simulados.
Entre como `admin@demo.com` ou `totem@demo.com` (qualquer senha).
Os dados ficam só naquele navegador; cada aba tem sua cópia.

### Atualizar o site

```bash
npm run publicar
```

Gera o build para a pasta `/Pickgo/` e envia para o branch `gh-pages`
(GitHub Pages). O site publicado é sempre o modo demonstração: os dados
ficam no navegador de quem acessa.

## Estrutura

| Caminho | O quê |
|---|---|
| `supabase/migrations/…_schema.sql` | Tabelas, regras de estoque, funções de pagamento, relatórios, RLS |
| `supabase/migrations/…_moradores.sql` | Moradores cadastrados, PIN (hash), tipo de cliente da venda |
| `supabase/migrations/…_autocadastro.sql` | Autocadastro do morador no totem e revisão pelo admin |
| `supabase/migrations/…_avaliacoes.sql` | Avaliação da compra (1 a 5 estrelas + observação) |
| `supabase/migrations/…_avisos.sql` | Avisos automáticos ao administrador (estoque, validade, avaliações) |
| `supabase/functions/enviar-avisos` | Envia os avisos por e-mail (na hora e resumo diário) |
| `supabase/migrations/…_cpf.sql` | CPF obrigatório no cadastro do morador e do visitante (validado no banco) |
| `supabase/migrations/…_pix_offline.sql` | Chave PIX, vendas feitas sem internet e conferência |
| `src/lib/pix.ts` | Gera o PIX copia e cola estático (BR Code) no próprio aparelho |
| `public/sw.js` | Guarda o app no aparelho para abrir sem internet |
| `supabase/seed.sql` | 7 categorias, 4 fornecedores, 20 produtos, 8 moradores (PIN `1234`) e 60 dias de vendas |
| `supabase/functions/criar-pagamento` | Cria a venda (preços lidos do banco) e a cobrança PIX/cartão |
| `supabase/functions/webhook-pagamento` | Recebe o Mercado Pago, confere na API e aprova/recusa |
| `supabase/functions/cancelar-pagamento` | Cancelamento pelo morador ou expiração do QR (5 min) |
| `supabase/functions/simular-pagamento` | Sandbox sem provedor: aprova/recusa pelo próprio totem |
| `supabase/functions/enviar-comprovante` | Comprovante por e-mail (Resend) |
| `src/paginas/admin` | Dashboard, Produtos, Histórico, Movimentações, Vendas, Cadastros |
| `src/paginas/totem/Totem.tsx` | Totem (tablet em pé) |
| `src/lib/api` | Acesso a dados: `supabase.ts` (produção) e `demo.ts` (navegador) |
| `scripts/testar-sql.mjs` | Testes do banco sem Docker (`npm run test:sql`) |

## Regras garantidas pelo banco

- `produtos.estoque_atual` **não pode** ser alterado diretamente (trigger bloqueia).
  Só muda quando se insere uma linha em `movimentacoes_estoque`, que grava saldo
  anterior/posterior e o usuário responsável. Estoque inicial também é uma entrada.
- Movimentações são imutáveis: correção = nova movimentação de ajuste.
- Saída manual não deixa o saldo negativo; saída por venda pode (o morador já
  levou o produto — o negativo indica erro de inventário).
- Entrada de reposição atualiza o preço de custo para o último custo pago.
- A venda só vira `paga` e o estoque só baixa em `finalizar_pagamento()`, que só o
  backend (service role) executa. É idempotente: webhook repetido não baixa duas vezes.
- O totem não lê a tabela `produtos` (custos protegidos): usa a view `catalogo_totem`.
- Produtos não são apagados; são desativados e o histórico continua.

## Colocar no ar com Supabase

1. Crie um projeto em supabase.com e instale a CLI (`npm i -g supabase`).
2. Vincule e aplique o banco (com os dados de exemplo):
   ```bash
   supabase link --project-ref SEU_PROJETO
   supabase db push --include-seed
   ```
   Para começar sem os dados de exemplo, rode só `supabase db push`.
3. Crie as contas (admin e totem). Não há cadastro público:
   ```bash
   node scripts/criar-usuarios.mjs admin@seu-condominio.com SENHA_FORTE totem@seu-condominio.com OUTRA_SENHA
   ```
   (precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente ou no `.env.local`.)
4. Frontend: copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY`. Depois `npm run build` e publique a pasta `dist`
   (Vercel, Netlify, Cloudflare Pages…). Configure o fallback de SPA para `index.html`.
5. Edge Functions e segredos:
   ```bash
   cp supabase/functions/.env.example supabase/functions/.env   # preencha
   supabase secrets set --env-file supabase/functions/.env
   supabase functions deploy criar-pagamento
   supabase functions deploy cancelar-pagamento
   supabase functions deploy simular-pagamento
   supabase functions deploy enviar-comprovante
   supabase functions deploy webhook-pagamento --no-verify-jwt
   supabase functions deploy enviar-avisos --no-verify-jwt
   ```
6. No totem (tablet), abra o site, entre com a conta do totem e deixe em tela cheia
   (modo quiosque / "fixar tela"). Para sair do totem, segure o logo por 3 segundos.

## Pagamentos (Mercado Pago)

As chaves ficam **só** nos segredos das Edge Functions; o navegador nunca as vê.

- **Sem `MP_ACCESS_TOKEN`** → provedor `simulado`: o totem mostra um QR fictício e
  botões "Aprovar/Recusar" que passam pelas mesmas funções do webhook real.
- **Sandbox do Mercado Pago** → use o *Access Token de teste* (credenciais de teste)
  em `MP_ACCESS_TOKEN`.
  - Cadastre o webhook no painel do MP: `https://SEU_PROJETO.supabase.co/functions/v1/webhook-pagamento`,
    evento *Pagamentos*. Copie a chave secreta para `MP_WEBHOOK_SECRET` (a assinatura
    `x-signature` é validada).
  - **PIX:** QR Code dinâmico com o valor exato, expiração de 5 min (`date_of_expiration`).
  - **Cartão com maquininha Point:** coloque a maquininha em modo PDV e informe
    `MP_POINT_DEVICE_ID`; o totem envia a cobrança direto para ela.
  - **Cartão sem maquininha:** o totem mostra um QR do Checkout Pro para o morador
    pagar pelo celular.
- O webhook nunca confia no corpo da notificação: consulta o pagamento na API do MP,
  confere o valor e só então aprova.
- Trocar de provedor (Asaas, Efí): reescreva `supabase/functions/_shared/mercadopago.ts`
  e o webhook; o banco e o frontend não mudam.

## Comprovante

- **E-mail:** pelo **Brevo** (envia de um e-mail verificado, pode ser Gmail, sem domínio próprio):
  rode `node scripts/configurar-email.mjs` e cole a chave de API (`xkeysib-…`). Ou use o Resend
  com `RESEND_API_KEY` e `EMAIL_FROM` de um domínio verificado. As Edge Functions não usam SMTP
  (portas 25/587 bloqueadas), só API HTTPS.

## Totem

- Tela inicial: **Sou morador** ou **Sou visitante**.
  - Visitante → informa o **CPF (obrigatório)** num teclado numérico e vai para os produtos
    (não pede apartamento). O CPF fica na venda e aparece mascarado no painel (***.456.789-**).
  - Morador → escolhe **Usar meu cadastro** (apartamento + PIN no teclado da tela),
    **Fazer meu cadastro** ou **Iniciar sem cadastro** (CPF obrigatório; apartamento opcional no pagamento).
  - **Fazer meu cadastro:** nome, **CPF (obrigatório, único)**, apartamento, bloco, e-mail (opcional), PIN e
    autorização de uso dos dados (LGPD). Ao concluir, já compra identificado. O cadastro
    aparece em **Moradores** como "A revisar" para o administrador confirmar.
    Proteções: PIN único por apartamento (tentar um PIN já usado conta como erro e entra no
    bloqueio de 5 tentativas), no máximo 3 autocadastros por apartamento por hora.
  - Morador identificado vê "Olá, Nome!" e envia o comprovante com um toque para o
    e-mail do cadastro (o totem só mostra o e-mail mascarado).
  - 5 PINs errados bloqueiam o apartamento por 15 min; o admin desbloqueia em Moradores.
- Depois: produtos (toque ou leitura de código) → carrinho → forma de pagamento
  → aguardando (QR/maquininha, contagem de 5 min) → aprovado (comprovante) ou recusado.
- Moradores são cadastrados pelo administrador em **Moradores** (o PIN é guardado só como hash).
  Exemplo no modo demonstração: apartamento `101`, PIN `1234`.
- Depois do pagamento aprovado o cliente pode **avaliar a compra** com 1 a 5 estrelas e uma
  observação opcional (com sugestões rápidas) e a caixa **"Algo a adicionar?"** para sugerir
  um produto que gostaria de encontrar no mercado (o painel agrupa os "Produtos mais pedidos"). A nota é gravada no toque; dá para completar
  ou mudar por até 30 min. No painel: menu **Avaliações** (média, distribuição, comentários,
  filtro por nota) e o cartão **Satisfação** no Dashboard.
- Leitor de código USB funciona em qualquer tela de compra (ele "digita" o código + Enter);
  também há leitura pela câmera.
- Volta sozinho ao início após 30 s sem toque (aviso aos 20 s). Durante a espera do
  pagamento vale a expiração de 5 min.

## Avisos ao administrador

O próprio banco gera os avisos; eles aparecem no **sino** do painel (com contador e alerta
na tela para os urgentes) e na tela **Avisos**:

| Aviso | Quando | Nível |
|---|---|---|
| Estoque zerado | o saldo chega a 0 | Urgente |
| Produto vencido | passou da validade e ainda há estoque | Urgente |
| Estoque baixo | o saldo cai até o mínimo | Atenção |
| Validade próxima | vence em até 7 dias e há estoque | Atenção |
| Avaliação ruim | nota 1 ou 2 | Atenção |
| Sugestão de produto | cliente preencheu "Algo a adicionar?" | Informativo |

Avisos de estoque e validade **se resolvem sozinhos** quando a situação é corrigida
(reposição, saída do vencido, produto desativado) e não se repetem enquanto estão abertos.

**Envio por e-mail:** configure o e-mail em **Avisos → Receber por e-mail** e agende a Edge Function (SQL Editor do Supabase, com `pg_cron` e `pg_net` ativos):

```sql
-- urgentes/atenção assim que surgirem (a cada 10 min)
select cron.schedule('avisos-pendentes', '*/10 * * * *', $
  select net.http_post(
    url := 'https://SEU_PROJETO.supabase.co/functions/v1/enviar-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'SEU_AVISOS_CRON_SECRET'),
    body := '{"modo":"pendentes"}'::jsonb)
$);
-- resumo diário às 8h de Brasília (11h UTC)
select cron.schedule('avisos-resumo', '0 11 * * *', $
  select net.http_post(
    url := 'https://SEU_PROJETO.supabase.co/functions/v1/enviar-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'SEU_AVISOS_CRON_SECRET'),
    body := '{"modo":"resumo"}'::jsonb)
$);
```

A verificação diária de validade (`verificar_avisos()`) é agendada pela própria migração
quando o `pg_cron` está ativo, e também roda sempre que o painel é aberto.

## Sem internet no mercado

Se a internet do estabelecimento cair, o totem **continua vendendo**:

1. O catálogo e a chave PIX ficam guardados no próprio totem (atualizados sempre que há internet),
   e o app fica salvo no aparelho (service worker), abrindo mesmo se a página for recarregada.
2. Uma faixa amarela avisa "Sem internet". O pagamento passa a ser **PIX direto**: o totem gera,
   sem internet, um QR Code PIX estático com a **chave do mercado, o valor exato e um identificador**
   (txid). O morador paga pelo celular (com os dados móveis dele) e toca em "Já paguei".
3. A venda fica numa fila no totem e é **enviada sozinha quando a conexão volta** (sem duplicar),
   já baixando o estoque. Cartão e cadastro ficam indisponíveis enquanto estiver sem internet.
4. No painel, **PIX sem internet** lista essas vendas como "A conferir" (e o sino avisa). Confira no
   extrato pelo valor, horário e identificador e marque **Recebido** ou **Não recebido** (sai do
   faturamento; o estoque não volta, porque o produto saiu da loja).

Configure a chave em **Painel → PIX sem internet** (tipo, chave, nome do recebedor e cidade).
Na mesma tela dá para **imprimir um cartaz** com o QR fixo (sem valor) para colar no mercado:
serve até se o totem desligar de vez, por exemplo, numa falta de energia.

> Sem internet o totem não consegue confirmar o PIX sozinho: o "Já paguei" é declarado pelo
> cliente. Por isso essas vendas sempre passam pela conferência.

## Testes

```bash
npm run test:sql   # migração + seed + regras de estoque, RLS e fluxo de pagamento (PGlite)
npm run build      # checagem de tipos + build de produção
```

# Consta API

API nativa de apoio ao aplicativo; Node 22, Fastify 5 e PostgreSQL 16. Não tem participantes/resultados de demonstração na execução normal.

## Configuração

Na raiz do monorepositório, copie `.env.example` e configure:

- `DATABASE_URL`: PostgreSQL; em produção use TLS com validação da cadeia de certificados do provedor.
- `JWT_SECRET`: pelo menos 32 bytes UTF-8 aleatórios (por exemplo, gere localmente com `openssl rand -base64 48`).
- `GOOGLE_CLIENT_IDS`: identificadores OAuth aceitos, separados por vírgula. Inclua os audiences efetivamente usados pelos SDKs Android/iOS. Cadastre package/bundle ID, SHA-1/SHA-256 e clientes de plataforma no provedor conforme o guia nativo.
- `APPLE_CLIENT_IDS`: identificadores Apple aceitos. O backend usa JWKS oficial, issuer, audience e nonce de uso único. A distribuição iOS ainda depende da configuração da capacidade Sign in with Apple e da revisão dos requisitos vigentes da loja.
- `PORT` (3000) e `HOST` (0.0.0.0), opcionais.

Não coloque client secrets, JWT_SECRET, arquivos de conta de serviço ou credenciais de assinatura no aplicativo. Os client IDs são configuração pública; a chave JWT pertence somente ao servidor. Não há serviço pago ativado. Hospedagem de API/PostgreSQL, domínio/HTTPS e contas das lojas podem ter custos conforme o provedor escolhido.

Na raiz:

```sh
npm install
docker compose up -d postgres
npm run api:migrate
npm run api:dev
```

O Compose usa `local_dev_only` somente como senha de desenvolvimento local. Defina `POSTGRES_PASSWORD` no ambiente antes de uma instalação própria e mantenha o banco em rede privada. A porta do banco e a API são expostas no loopback por padrão. Para teste Android use `adb reverse tcp:3000 tcp:3000` ou configure uma URL da sua rede acessível pelo aparelho.

Produção:

```sh
npm run build --workspace @consta/api
npm run migrate:prod --workspace @consta/api
npm run start --workspace @consta/api
```

`build.mjs` incorpora os pacotes internos TypeScript em bundles Node ESM. Dependências externas ficam no node_modules. A imagem Docker copia o monorepositório, instala pelo lockfile e executa o bundle; o Compose aplica migrações antes de iniciar. Coloque HTTPS e limites operacionais do seu provedor na frente da API. Não exponha o tráfego de autenticação por HTTP em produção.

## Contrato e autorização

Prefixo `/v1`. Listas usam `{items:[...]}`, objetos únicos são retornados diretamente; erros usam `{error:{code,message,fields?}}`. IDs de grupo/desafio nunca concedem autorização: cada operação consulta a associação no banco. E-mails não são armazenados nem enviados a participantes. Percursos, notas e adaptações privadas não aparecem no ranking.

`GET /config` informa `authenticationConfigured` e `providers.google/apple` (booleanos). Sem chave ou client IDs, o login correspondente retorna erro de configuração. Não existe autenticação por e-mail recebido do cliente, usuário de demonstração ou rota HTTP de teste.

- Google: `POST /auth/google {idToken}`; verificação oficial com google-auth-library, audience, issuer e identidade por sub.
- Apple: `POST /auth/apple/nonce` retorna nonce, nonceHash SHA-256 e nonceId. O SDK usa o nonce conforme sua API; `POST /auth/apple {identityToken,nonceId,displayName?}` valida o token e consome o nonce uma única vez.
- Login/refresh retornam `{accessToken,refreshToken,expiresIn:900,user}`. Bearer access token com sessão verificável no banco. Refresh opaco de 256 bits, somente hash SHA-256 persistido, rotação transacional e revogação de toda a família em reutilização.
- `POST /auth/refresh {refreshToken}`; o cliente deve serializar renovações. Uma corrida com o mesmo refresh é tratada como reutilização por segurança.
- `POST /auth/logout {refreshToken?}` autenticado revoga a família atual. `DELETE /me {confirm:true}` remove a conta e registros relacionados; grupos com outros participantes transferem a administração quando necessário. Grupos vazios são removidos.
- `GET/PATCH /me`, `POST /me/avatar {base64,mimeType}`, `GET/PATCH /me/preferences`, `GET/PATCH /me/notifications`.
- `GET/POST /groups`, `GET/PATCH/DELETE /groups/:id`, `GET/PATCH/DELETE /groups/:id/members/:userId` (listagem em `/members`). Ao excluir grupo, envie `{confirm:true}`.
- `GET/POST /groups/:id/invites`, `DELETE /groups/:id/invites/:inviteId`, `POST /invites/accept {code}`. Convites têm 192 bits, hash persistido, expiração/revogação; a URL `consta://invite/<code>` é compartilhada pelo aplicativo.
- `GET/POST /groups/:id/challenges`, `GET/PATCH /challenges/:id`, `POST /challenges/preview {rules}`, `GET /challenges/:id/ranking`, `POST /challenges/:id/duplicate {name?,startsAt,endsAt}`.
- `GET /notifications`, `PATCH /notifications/:id/read` e `GET /groups/:id/audit`.

Preferências: `goal health|strength|conditioning`, `level beginner|intermediate|advanced`, dias ISO 1..7, duração, ambiente home|gym|outdoor, equipamentos, modalidades, exercícios a evitar e fuso IANA. Agenda/notificações pessoais não alteram regras de desafio.

## Regras, integridade e revisão

Regras são validadas pelo pacote `@consta/domain`. Datas UTC e fuso IANA, dias válidos/reposições, início da semana, limites diário/semanal, janela opcional, fontes aceitas, prazo de sincronização e desempate fazem parte do regulamento. A prévia calcula máximo e semanas incompletas. Constância não depende de dificuldade, quilômetros ou passos.

Após o início, toda alteração exige motivo e gera auditoria e avisos persistidos para os participantes. Alterar regras com impacto exige:

1. `POST /challenges/:id/preview-change {rules,reason}`, retornando classificação anterior/nova, revision e changeToken válido por 10 minutos.
2. `PATCH /challenges/:id {rules,reason,changeToken}`. Token, autor, motivo, regulamento e revisão devem corresponder. Somente então o recálculo retroativo é confirmado, auditado e comunicado. Uma revisão alterada invalida a prévia.

Não há push remoto anunciado: os avisos administrativos aparecem no aplicativo quando ele consulta o feed. Lembretes locais são responsabilidade do aplicativo nativo.

Pontos e quilômetros são calculados no servidor em transação. Um lock por desafio serializa recálculos, scores têm chave única por desafio/usuário e créditos de constância têm chave única por desafio/usuário/dia. Reenvios de início usam clientId; conclusão usa fingerprint imutável. Exclusão e revisão recalculam a classificação.

Sessões devem estar inteiramente dentro do período/janela do regulamento; o início verificado no fuso do desafio determina o dia. A política exata de cruzamento de meia-noite/janelas está documentada e testada em `packages/domain`. Não se atribuem dados importados à data da sincronização.

## Atividades e privacidade

- `POST /activities/start {clientId,modality,source,environment,planId?}` grava início pela hora do servidor.
- `POST /activities/:id/complete {activeSeconds,distanceMeters?,steps?,notes?,adaptations?,completedOffline?,endedAt?,anomalies?}` grava encerramento do servidor. Tempo ativo não pode exceder o intervalo. O horário do celular não decide pontos. `completedOffline:true` preserva o encerramento original como recordedEndAt e impede pontuação automática.
- `POST /activities/import {clientId,modality,source,environment,startedAt,endedAt,activeSeconds,distanceMeters?,steps?,sourceRecordId?,notes?}` preserva o intervalo original, deduplica identidade externa e sinaliza intervalos sobrepostos. Históricos sem âncora temporal ficam pending_review se um desafio permite revisão, ou ineligible. Nunca são promovidos a verified pela importação.
- `GET /activities`, `GET/DELETE /activities/:id`. A exclusão apaga execução/notas e revisões, preservando apenas o snapshot estrutural do plano concluído para não reabrir uma sessão diária.
- `GET /challenges/:id/review-queue` e `POST /activities/:id/review {challengeId,decision,reason,correctedStartAt?,correctedEndAt?,distanceMeters?,activeSeconds?}` exigem administração. A revisão afeta somente o desafio especificado. Horários offline só podem ser aprovados quando o regulamento aceita revisão.

O ranking compartilha somente nome/avatar e totais. A fila administrativa mostra o mínimo necessário à revisão do regulamento (fonte, modalidade, intervalo e métrica pertinente), sem percurso, notas privadas ou dados adicionais de saúde. Não coletamos frequência cardíaca, publicidade de saúde ou rotas no servidor; payloads contendo trajetos são rejeitados. Não há logs de tokens, corpos de requisições ou métricas privadas.

Força é autodeclarada. Horários de servidor confirmam o registro, não o esforço físico. Distância é calculada no dispositivo por GPS filtrado; o servidor verifica limites básicos e sinaliza anomalias. Nenhum mecanismo é anunciado como proteção absoluta contra fraude. Ciclismo não recebe passos; esportes/força são registrados por duração; cardio estacionário usa distância manual identificada.

## Testes

```sh
npm run typecheck --workspace @consta/api
npm test --workspace @consta/api
RUN_DB_TESTS=1 TEST_DATABASE_URL=postgresql://... npm test --workspace @consta/api
```

A integração real PostgreSQL aplica as migrações e trunca as tabelas de fixture. Use somente um banco de teste. Ela cobre duas identidades, isolamento, convites, rotação/reutilização, nonce, exclusão, recálculo, concorrência, sincronização/offline, importação sobreposta, prévia/auditoria/avisos e ciclo de treino diário.

O verificador de identidade substituído existe somente na factory `buildApp({pool,verifyIdentity,config})` dos testes; não há backdoor HTTP ou alternativa de login em produção. Esses testes não comprovam Google/Apple com credenciais reais, GPS/Health Connect/HealthKit, segundo plano, desempenho, emulador ou aparelho físico. Essas verificações são separadas na documentação de entrega.

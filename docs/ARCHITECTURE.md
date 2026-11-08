# Arquitetura

Monorepo npm com aplicativo React Native/TypeScript e módulos nativos Expo SDK54; backend Fastify/Node22; PostgreSQL16. Não há autenticação por e-mail enviado pelo cliente nem backend em memória como substituto de produção.

```text
apps/mobile ── HTTPS /v1 ── apps/api ── PostgreSQL
  │                           │
  ├─ SQLite (rotas/filas)      ├─ packages/domain (calendário e pontuação)
  ├─ SecureStore (refresh)    └─ packages/training (planos e biblioteca)
  └─ módulos nativos
```

## Fronteiras de confiança

A API valida ID tokens Google/Apple antes de emitir tokens próprios. Access tokens curtos e refresh rotacionável separam sessão e provedor. Authorization no backend consulta usuário e associação/role do grupo em cada operação; UUIDs não são credenciais.

Banco e migrações mantêm restrições de unicidade/idempotência. Ranking é calculado com regras persistidas e timestamps do servidor. Datas do telefone não dão autorização para pontuar no passado. Testes de API usam Postgres real e identidade injetada apenas no construtor em memória do servidor de teste.

## Local e sincronização

SQLite guarda progresso, trajetos privados e fila por pessoa. Activity IDs/chaves estáveis permitem reenvio idempotente. Access token não vai ao SQLite; refresh usa armazenamento seguro do sistema. Exclusão de conta limpa o espaço local da pessoa.

Resumos sincronizados não incluem coordenadas. Sessões sem hora verificável continuam úteis no histórico e recebem estado de elegibilidade próprio. Captura local de GPS funciona sem internet; mapa e sincronização têm dependências separadas.

## Módulos nativos

Google Sign-In e Apple Authentication, localização/TaskManager com serviço Android, Pedometer opcional, notificações locais, seletor de imagens, compartilhamento e SecureStore exigem development build ou build release. O Expo Go não é ambiente suficiente.

No Android, a gravação é iniciada pela pessoa e continua por foreground service enquanto permitido pelo sistema; no iOS a continuidade exige permissões e configuração adequadas. Não se garante rastreamento após fechamento forçado. Pedômetro em primeiro plano tem limites distintos do GPS; passos incompletos devem permanecer identificados.

## Build e operação

O CI usa ações oficiais fixadas por SHA, permissões somente de leitura nos jobs que executam código de PR e escrita apenas no job de lockfile, restrito ao push da branch de trabalho. Não usa pull_request_target, EAS ou runner maior. APK é release assinado para testes internos; publicação exige assinatura própria privada e configuração da loja.

Scripts não implantam backend, habilitam cobrança nem criam contas OAuth. `docs/SETUP.md` lista configuração externa; `docs/TEST_MATRIX.md` separa automação de verificação nativa/física.

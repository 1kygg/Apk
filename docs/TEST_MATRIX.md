# Matriz de verificação

**Estado inicial:** código e suites entregues para execução; resultados devem ser vinculados a um run do CI e a uma revisão. Este arquivo não declara testes físicos realizados. O terminal da sessão de implementação não estava utilizável; o CI remoto é o caminho de execução automatizada.

Registre a revisão, data, sistema, aparelho e resultado em cada execução. Não marque um item como aprovado apenas porque existe teste, mock, tela ou integração compilável.

## Automação

Comandos: `npm run typecheck`, `npm test`, `npm run api:migrate`, `npm run api:build`. Integração real: `RUN_DB_TESTS=1` com DATABASE_URL/TEST_DATABASE_URL apontando a **PostgreSQL 16 descartável**, e `npm run test:integration`. Fixtures removem tabelas/dados de teste; nunca use banco pessoal ou de produção.

O [workflow](../.github/workflows/ci.yml) executa TypeScript, migrações, suites de todos os workspaces, integração com PostgreSQL e build da API. O resultado de cada etapa é a evidência; uma execução interrompida ou falha não é aprovação.

| Área | Verificação automatizada prevista | Evidência necessária |
| --- | --- | --- |
| Identidade/sessão | rejeição de tokens, refresh, revogação/logout, acesso privado; identidade de teste somente por injeção interna | log do suite API; provedor real separado |
| Grupos/convites | associação exigida, isolamento, convites revogáveis e gestão administrativa | integração PostgreSQL |
| Treino diário | critérios de ambiente/equipamentos, estabilidade e histórico recente | suite training e integração de planos |
| Execução | substituição válida, adaptações, snapshot imutável após início | suite training/API |
| Calendário | fuso IANA, semana configurável, semanas incompletas, limite diário/semanal e máximo possível | suite domain |
| Reposição/empate | recuperar oportunidade anterior na semana, sem ampliar teto; semanas com meta e empate compartilhado | suite domain |
| Limites de tempo | meia-noite, mudança de fuso/DST, início inclusivo, encerramento, janela noturna e sincronização atrasada | suite domain/API |
| Idempotência | reenvios da mesma atividade e restrições transacionais concorrentes | integração PostgreSQL |
| Pontuação | servidor como autoridade, fontes distintas, offline sem horário verificável e atividades excluídas | suite domain/API |
| GPS matemático | precisão ruim, ruído, salto, tempo fora de ordem, lacuna, pausa e velocidade implausível | suite GPS; não valida sensor |
| Privacidade | endpoints de membros não expõem e-mails/rotas, acesso entre grupos negado e exclusões | integração API |
| Build Android | Expo prebuild e Gradle release; APK + checksum + certificado público | job Android concluído |

Teste automatizado de GPS recebe posições controladas; não mede recepção real, bateria ou continuidade. Teste de autenticação por identidade injetada não comprova Google/Apple reais. Não há importação Health Connect/HealthKit implementada para testar; o app não deve anunciá-la.

## Emulador Android

Pendentes até uma execução em emulador com development/release build, API e OAuth configurados. Use duas contas reais e, para sincronização entre dispositivos, duas instâncias independentes. Emulador valida fluxo, permissões e rotas injetadas; não substitui aparelho.

| Caso | Procedimento e resultado esperado |
| --- | --- |
| Login | entrar com Google; cancelar; negar/invalidar credencial; desligar rede. Falha legível, sem sessão falsa |
| Sessão | reiniciar app, expirar access token e renovar, fazer logout. Token de refresh revogado não reabre sessão |
| Duas contas | contas A e B no mesmo grupo, C em outro. A/B veem atualização sincronizada; C recebe acesso negado |
| Convite | compartilhar pelo menu nativo, abrir link após autenticar; revogar e tentar novamente |
| Onboarding | alterar objetivo, dias/tempo, ambiente, equipamentos, modalidades e exercícios evitados; persistir ao reiniciar |
| Plano diário | abrir repetidamente sem troca arbitrária; substituir, reduzir séries e iniciar; preservar snapshot |
| Calendário | criar/duplicar desafio com novas datas; validar ausência de dias, fim anterior e limites incompatíveis; conferir resumo |
| Alteração em andamento | exigir motivo, prévia/confirmacão e auditoria; outro participante vê aviso |
| Ranking | confirmar fonte/modalidade, empates, última atualização e motivo de inelegibilidade; sem participantes inventados |
| GPS | injetar percurso com salto e perda de sinal; pausar, deslocar, retomar; não ligar a lacuna nem somar a pausa |
| Offline | iniciar offline, salvar, fechar/reabrir, sincronizar duas vezes; histórico preservado sem crédito indevido/duplicado |
| Interrupção | matar processo durante gravação, recuperar; indicar intervalo sem dados, sem inventar pontos |
| Permissões | negar/revogar localização, atividade e notificações durante fluxo; poder continuar outras funções |
| Passos | distinguir sessão, diário indisponível e incompleto; não mostrar no ciclismo nem estimativa como GPS |
| Avatar | selecionar pelo seletor do sistema, cancelar e trocar; nenhuma solicitação de câmera obrigatória |
| Exclusões | excluir atividade e verificar ranking; excluir conta e verificar sessão, cache e dados associados |
| Notificações | habilitar, alterar agenda pessoal e horários de silêncio; desafio mantém calendário próprio |
| Acessibilidade | TalkBack, fontes ampliadas, contraste, foco, controles >=48dp, erros/estados anunciados e rotação/teclado |

## Aparelho físico Android

**Não executado nesta sessão.** Requer aparelho Android intermediário, localização real e duas contas/provedores configurados. Registre fabricante/modelo, SoC/RAM, Android, build, bateria inicial, rede, permissões e revisão.

1. Instale o **APK release**, com API HTTPS real. Entre e execute os fluxos de duas contas e sincronização também em outro aparelho.
2. Registre caminhada/corrida em percurso conhecido e seguro; compare distância com referência independente, relatando margem e condições, sem afirmar precisão absoluta. Repita com sinal ruim, parada, retomada e perda de sinal.
3. Grave por pelo menos 20 minutos com tela bloqueada e app minimizado, incluindo pausa manual. Confira notificação do serviço, horário, quilômetros, segmentos e persistência. Repita com economia de bateria e mudança Wi-Fi/dados.
4. Teste chamada/interrupção, negação/revogação de permissão, encerramento de processo pelo sistema e fechamento forçado. Após retomada, confira que o período perdido não foi inventado. Fechamento forçado não garante continuidade.
5. Ative pedômetro para caminhada/corrida. Confira origem, sessão, indisponibilidade diária no Android e marcação de dados incompletos após segundo plano. Não atribua total diário à sessão.
6. Reinicie offline e sincronize após prazos distintos. Confira estados salvo localmente, pendente, confirmado e inelegível. Reenvio não duplica registro ou pontos.
7. Execute exclusão e compartilhamento GPX opt-in com ocultação das extremidades; confira que resumo do ranking não expõe trajeto.

## Desempenho e bateria em release

Sem hardware disponível, **não há resultados de FPS, memória ou autonomia**. O objetivo de transições estáveis não é garantia para todo aparelho.

Procedimento repetível:

- Use build release, aparelho intermediário e brilho/rede comparáveis; registre ao menos três repetições de 60 segundos em navegação, lista de atividades, treino e mapa durante sessão. Evite gravador de tela se ele alterar a medição.
- Android Studio Profiler/Perfetto: observe frames atrasados, jank, CPU, memória, GC e trabalho do serviço. Para uma amostra complementar: `adb shell dumpsys gfxinfo app.consta.mobile reset`; execute o cenário; depois `adb shell dumpsys gfxinfo app.consta.mobile framestats > framestats.txt`. Isso mede o pipeline do sistema e deve ser interpretado junto ao trace, não como prova isolada de FPS JavaScript.
- Compare quantidade e duração de frames com o orçamento da taxa de atualização do aparelho. Registre percentis e cenários de travamento; não transforme média em promessa universal.
- Bateria: `adb shell dumpsys batterystats --reset`, gravação de GPS com tela bloqueada por duração definida, depois `adb shell dumpsys batterystats app.consta.mobile > battery.txt`. Use aparelho desconectado da carga e compare cenários equivalentes; o teste pode exigir permissões ADB.
- Teste fontes do sistema em 130%/200%, TalkBack, reduzir movimentos, contraste, foco e controles. Verifique os estados de carregamento, vazio, erro, offline e pendente. Não esconda informações essenciais em animações.
- Guarde traces somente após verificar que não contêm dados sensíveis, coordenadas ou tokens. Publique relatório agregado, sem trajetos privados.

## iOS e distribuição

Pendentes: build macOS/Xcode, Sign in with Apple com nonce real, Google iOS/URL scheme, permissão de movimento, pedômetro diário, localização bloqueada/segundo plano, notificações, Dynamic Type/VoiceOver e exclusão de conta/autorização Apple. Aprovação de loja e formulários de privacidade não são testes automatizados.

## Registro de execução

| Revisão / run | Ambiente | Casos | Resultado / evidências |
| --- | --- | --- | --- |
| A preencher após execução | CI PostgreSQL 16 / Ubuntu | typecheck, suites, build | Link exato do run e falhas corrigidas |
| Pendente | Emulador Android | Fluxos e permissões | Sem evidência ainda |
| Pendente | Android físico intermediário | GPS, bloqueio, bateria, a11y, release | Sem evidência ainda |
| Pendente | iOS físico | OAuth, localização, passos e a11y | Sem evidência ainda |

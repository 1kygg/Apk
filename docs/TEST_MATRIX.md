# Matriz de verificação da versão local

O código atual é o Consta 1.1.0 com perfil local. **Nenhum teste físico, emulador ou medição de FPS/bateria é declarado neste documento sem evidência específica.** Código compilável e mocks não comprovam sensores ou comportamento do Expo no aparelho.

## Testes automatizados

```sh
npm run typecheck
npm test
```

As suites mobile usam testes de cálculo, ciclo de perfil, contratos de registros, histórico e SQL/rollback com **SQLite real do Node através de um adaptador**. As APIs de localização, tarefas, seletor de foto, notificações e sensores usam mocks quando executadas no Node. Isso não verifica o Expo SQLite, permissões ou hardware nativos.

| Área atual | Casos automatizados esperados | Evidência |
| --- | --- | --- |
| Perfil local | nome/foto opcional, persistência, retomada sem rede, rejeição de nome inválido e criação concorrente | suite `auth.test.ts`, sem login simulado ou provedor |
| Isolamento/exclusão | impedir callback de outro perfil, apagar somente os dados próprios, fila e preferências | SQLite por adaptador e fences locais |
| Biblioteca/plano | gerar e persistir sugestão diária, recuperar histórico, equipamentos e substituições compatíveis | suites training e local-service |
| Execução | snapshot após início, séries/adaptações, conclusão idempotente e exclusão sem recriar sessão | SQLite local-service/trainingStore |
| Pontuação | 1 ponto por dia, limite semanal, fuso, meia-noite, semanas, IDs repetidos, exclusão e versões adaptadas | suite local-score |
| Modalidades | quilômetros separados, esportes sem distância, passos sem bônus e sem ciclismo | local-score e contratos de registros |
| GPS matemático | precisão ruim, saltos, pausa, perda de sinal, tempo fora de ordem e velocidade incompatível | suite GPS com posições controladas |
| Cardio local | salvar sem HTTP, consolidar histórico, pausa sem quilômetros artificiais, recuperação sem inventar tempo | tracking com SDK nativo mockado e SQLite real do Node |
| Compartilhamento | GPX opt-in, remover extremos e conexões que atravessam áreas ocultas, manter segmentos | suite sharing-model |
| Gravação local | transações, ACK, rollback, isolamento e tratamento de concorrência | storage/local-service; não comprova bloqueios no Expo real |
| Android | export, prebuild, Gradle release, assinatura, pacote e checksum | somente o run efetivamente concluído |

As suites de `packages/domain` também preservam regras do backend anterior. `apps/api` mantém testes unitários e integração PostgreSQL opcionais para seu próprio módulo; eles não são dependência do app local e não provam ranking online nesta versão.

Para rodar a integração histórica, use banco **descartável de teste**, `TEST_DATABASE_URL` e `npm run test:integration`. Fixtures removem dados; nunca aponte para produção ou um banco pessoal. Identidades injetadas na factory de testes do backend não são login real Google/Apple.

## Emulador Android

Execução registrada em [Android 35/x86_64, run 42608028196](https://github.com/1kygg/Apk/actions/runs/42608028196): instalação do APK release, modo avião com Wi-Fi/dados desativados, criação de nome pela interface, registro manual de futebol, 1 ponto exibido e persistência após force-stop/reabertura. Foto não foi selecionada nesse teste. Sensores, permissões, segundo plano, acessibilidade e os demais casos abaixo continuam sem comprovação nativa. O código do aplicativo testado é idêntico ao da revisão 746bd0d; o commit do teste altera somente o workflow do emulador.

| Caso | Procedimento e resultado esperado |
| --- | --- |
| Primeira abertura offline | desligar Wi-Fi/dados, criar nome e foto opcional; entrar no app sem tela Google ou configuração de servidor |
| Persistência | fechar e reabrir; mesmo perfil, foto e histórico permanecem |
| Foto | escolher, cancelar, trocar; reabrir depois de encerrar seletor/processo, sem URI temporária quebrada |
| Preferências | revisar objetivo, dias, tempo, ambiente, materiais e exercícios evitados; persistir alterações |
| Treino do dia | reabrir sem trocar arbitrariamente, substituir antes de iniciar, preservar snapshot depois do início |
| Execução | reduzir séries, versão mais fácil, observações, descanso e conclusão; versões adaptadas valem o mesmo |
| Pontos | várias conclusões no dia continuam valendo 1; respeitar teto semanal e regras pessoais |
| Regra editada | mostrar aviso de recálculo de todo o histórico; salvar sem rede e atualizar resultado |
| Datas | fuso da rotina, começo de semana e sessão cruzando meia-noite; horários do aparelho explicitamente locais |
| Manual/esportes | registrar esteira/bicicleta interna sem chamar distância de GPS; esporte pode ter somente duração |
| GPS injetado | percurso com saltos/lacunas; pausar, mover e retomar sem criar reta ou distância durante pausa |
| Traçado | desenhar pontos em SVG sem baixar mapa; mostrar quebra entre segmentos |
| Interrupção | matar processo e recuperar; não inventar tempo ativo ou trajeto do intervalo perdido |
| Permissões | negar/revogar localização, movimento, foto ou notificações; funções não relacionadas continuam disponíveis |
| Passos | sessão distinta de total diário; ausência de dados diferente de zero; não mostrar no ciclismo |
| Exclusão | excluir atividade e recalcular pontos; apagar perfil e conferir nome/foto/rotas/preferências/lembretes |
| Compartilhamento | resumo sem rota por padrão, GPX opcional com ocultação dos extremos; não publicar automaticamente |
| Acessibilidade | TalkBack, fontes ampliadas, contraste, foco, erro/estado anunciado e controles confortáveis |

Um emulador comprova fluxos e posições injetadas, não recepção GPS, pedômetro ou bateria de aparelho físico. Não use participantes fictícios ou registros de teste em um APK distribuído como se fossem dados reais.

## Aparelho físico Android

**Pendente.** Use aparelho intermediário e APK release. Registre modelo, SoC/RAM, Android, revisão, versão do app, bateria, rede e permissões.

1. Desative Wi-Fi/dados, mantenha localização disponível, crie o perfil e execute treinos/histórico/pontos. Confirme que não aparece exigência de conexão.
2. Escolha e troque foto; reinicie o aparelho e confira persistência. Negar/cancelar a foto não bloqueia o perfil.
3. Registre caminhada/corrida em percurso conhecido; compare distância com referência independente e registre condições/margem, sem promessa de precisão absoluta.
4. Teste sinal fraco, parada, pausa manual e retomada. O desenho e os quilômetros não podem conectar a pausa ou uma lacuna sem registro.
5. Registre por ao menos 20 minutos com a tela bloqueada, depois minimizado e em economia de bateria. Confira serviço visível, tempos e dados preservados.
6. Faça interrupção/chamada, negação/revogação de permissão, encerramento pelo sistema e fechamento forçado. Não prometa rastreamento após force-stop; retomar não inventa o período perdido.
7. Ative pedômetro em caminhada/corrida e confira origem/contagem parcial. Android pode não oferecer total diário; esse estado não é zero confirmado.
8. Conclua registros repetidamente e reabra o app; não duplicar histórico ou ponto diário. Apague uma atividade e confira recálculo.
9. Apague o perfil e confirme limpeza local e de lembretes. Criar outro perfil não deve mostrar dados do anterior.

## Desempenho, bateria e acessibilidade em release

**Não há resultados medidos de FPS, memória ou autonomia nesta revisão.** A meta de transições estáveis não é uma garantia para todo aparelho.

- Faça pelo menos três amostras de 60 segundos com navegação, biblioteca, treino, histórico e traçado GPS. Use Android Studio Profiler/Perfetto para frames, CPU, memória e GC; evite gravador de tela quando ele alterar a medição.
- Como amostra complementar, execute `adb shell dumpsys gfxinfo app.consta.mobile reset`, reproduza o cenário e salve `adb shell dumpsys gfxinfo app.consta.mobile framestats`. Interprete junto ao trace, sem tratá-lo isoladamente como FPS JavaScript.
- Para bateria, use `adb shell dumpsys batterystats --reset`, faça sessão de duração definida com o aparelho fora da carga e depois salve `adb shell dumpsys batterystats app.consta.mobile`. Compare condições equivalentes e registre permissões/estado da tela.
- Verifique fontes em 130%/200%, TalkBack, foco, contraste, teclado e preferência por reduzir movimentos. Confira estados vazio, carregando, erro de armazenamento e sessão recuperada.
- Revise traces antes de compartilhar: não publique nome, foto, observações ou coordenadas privadas. Registre resultados agregados.

## iOS

Pendentes: compilação Mac/Xcode, instalação, foto persistente, permissões de movimento, pedômetro diário, segundo plano/tela bloqueada, lembretes, VoiceOver/Dynamic Type e exclusão local. O app local não depende de login Apple/Google. Build Android não comprova esses fluxos.

## Evidências e histórico

| Revisão/run | Ambiente | Resultado e limite |
| --- | --- | --- |
| Implementação local 1.1.0, 09/11/2026 | Linux, testes Node/SQLite por adaptador | Suites locais de perfil, pontuação, armazenamento, cardio mockado e treinos executadas durante a implementação. 157 testes locais aprovados: 74 mobile, 66 domínio, 12 treino e 5 API; 20 testes PostgreSQL não foram executados localmente nesta revisão; não comprova SDK em aparelho |
| [746bd0d / run 42604239761](https://github.com/1kygg/Apk/actions/runs/42604239761) | Node 22, PostgreSQL 16 e build Android arm64 | 177 testes aprovados, TypeScript, prebuild, compilação e [assinatura/checksum](https://github.com/1kygg/Apk/releases/tag/consta-offline-v1.1.0-746bd0d) conferidos |
| [893bed7 / run 42487145111](https://github.com/1kygg/Apk/actions/runs/42487145111) | Entrega histórica com servidor, Node 22/PostgreSQL 16 | 138 testes e APK anterior aprovados, com [assinatura/checksum](https://github.com/1kygg/Apk/releases/tag/consta-android-893bed7). Não comprova a criação de perfil offline da versão 1.1.0 |
| [Run 42608028196](https://github.com/1kygg/Apk/actions/runs/42608028196) | Emulador Android 35/x86_64, release, modo avião | Perfil, esporte manual, 1 ponto e persistência após reabrir aprovados pela interface real; foto/sensores não testados |
| Android físico intermediário | Pendente | GPS, tela bloqueada, pedômetro, permissões, acessibilidade e release |
| iOS físico | Pendente | Instalação, movimento, localização, notificações e acessibilidade |

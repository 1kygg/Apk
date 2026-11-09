# @consta/domain

Motor compartilhado de regras, calendários, pontuação e GPS. Não contém rede, credenciais, dados de demonstração ou APIs de sensores.

## Contrato de confiança e unidades

- Valide entradas com os schemas Zod. validateRules preenche defaults; não codifica datas fixas de competição.
- ChallengeRules usa dias ISO (segunda=1, domingo=7), fuso IANA e instantes com offset normalizados para UTC.
- dailyCap, weeklyCap, weeklyGoal e resultados usam pontos em constância, quilômetros nas classificações de distância e contagens no desafio de passos. ActivityRecord.distanceMeters permanece em metros.
- Só o backend deve atribuir eligibility=verified e verifiedStartAt/verifiedEndAt. Não copie valores homônimos enviados pelo cliente. O motor exige esses valores; não verifica Google, HealthKit ou Health Connect.
- O backend aplica offlinePolicy ao receber dados: reject_scoring mantém histórico sem pontuação; review mantém pending_review até decisão auditada. A política não torna um horário do aparelho confiável.
- scoreActivities deve receber asOf da hora do servidor. Um registro não pode terminar ou ser recebido no futuro nem ser recebido antes de concluir. O prazo de sincronização termina em endsAt + syncGraceHours. Dados importados precisam da hora original verificada e ID externo deduplicado pelo adaptador.

## Datas, janelas e oportunidades

O início do desafio é inclusivo. O início da atividade deve ser anterior a endsAt e a conclusão pode ser exatamente em endsAt. Ambos os instantes devem estar no período, sem corte artificial para ganhar elegibilidade. Atribui-se a sessão à data local do início, nunca à data de sincronização.

Sem janela, sessões podem atravessar a meia-noite. Com janela, a sessão inteira deve caber em uma única ocorrência. windowStartMinute=1320 e windowEndMinute=120 significam 22:00–02:00. Uma sessão iniciada às 01:00 pertence à data local desse início, e não à véspera. Uma janela comum não aceita cruzamento para o dia seguinte. Para o dia inteiro, omita os dois campos; valores iguais são inválidos.

Datas usam aritmética de calendário em Luxon. No retorno do horário de verão, o começo ambíguo usa a primeira ocorrência e o fim usa a última. Uma fronteira inexistente no avanço do relógio passa para o primeiro minuto existente. calculateMaximum considera oportunidades com interseção real entre período, dia e janela, inclusive semanas incompletas. Não há duração ou teto total de competição fixados no código.

Reposição recupera uma oportunidade regular anterior não utilizada na mesma semana configurada. Não antecipa dias futuros, não recupera outra semana, não soma oportunidades ao máximo teórico e não aumenta o limite semanal. A meta semanal permanece fixa mesmo em semanas incompletas. Constância concede um único crédito por data e usuário, independentemente de dificuldade, adaptações ou quantidade de sessões.

IDs repetidos idênticos são idempotentes; IDs com payloads conflitantes não pontuam. No backend, isso complementa transações, unicidade e isolamento, sem substituí-los. A classificação não mistura modalidades e usa posições compartilhadas com saltos quando persistem empates. Nomes só ordenam a apresentação dos empatados.

## GPS

GpsFilter recebe fixes nativos em UNIX milissegundos. Os defaults rejeitam precisão horizontal maior que 35 m, idade maior que 15 s, horários não crescentes e velocidades acima de 4/12/30 m/s para caminhada/corrida/ciclismo. Lacunas maiores que 30 s e rejeições relevantes quebram a linha; nunca se interpola o trecho perdido. Jitter mantém uma âncora de movimento e não soma cada fix ruidoso. Distância não cresce durante pause(); resume() exige nova âncora. snapshot/restore permitem persistência local, mas não asseguram captura quando o sistema encerra o aplicativo.

O aplicativo deve guardar e renderizar segmentos separados sempre que breakSegment=true. O filtro calcula distância de posições, não comprova atividade física nem oferece prevenção absoluta de fraude. Ritmo e velocidade devem usar tempo ativo quando assim identificados na interface; o filtro não decide o cronômetro.

## Verificação

npm test --workspace @consta/domain
npm run typecheck --workspace @consta/domain

Os testes são unitários: schemas, datas/DST, fronteiras, janelas noturnas, reposições, limites, empates, idempotência e séries sintéticas de GPS. Não equivalem a testes de sensores, tela bloqueada, permissões ou desempenho em aparelhos.

# Regras locais de treinos, atividades e pontuação

## Perfil e primeira utilização

O perfil é criado com nome ou apelido e foto opcional, sem conta online. As opções iniciais de treino são de iniciante, em casa, sem materiais, com tempo disponível inicialmente de 25 minutos e rotina pessoal às segundas, quartas e sextas. Essas preferências podem ser alteradas no Perfil; são organização de atividade, não avaliação ou prescrição médica.

Objetivo, experiência, dias, tempo, ambiente, equipamentos, modalidades, exercícios evitados e histórico recente orientam sugestões diárias. Em casa sem equipamentos, são priorizados movimentos com peso corporal. Recuperação e descanso fazem parte do planejamento; não há mensagem de culpa por não realizar atividade.

## Plano e execução

O treino do dia fica salvo por perfil, data local e ambiente. Reabrir a tela não sorteia uma ficha nova. Antes de iniciar, podem ser escolhidas alternativas compatíveis com ambiente, nível e materiais. A versão iniciada é preservada no histórico; adaptações e séries marcadas ficam separadas dela.

Uma sessão iniciada não cria outra oportunidade apenas por trocar de ambiente ou reenviar a conclusão. Excluir uma atividade ligada a um treino mantém esse treino como registro encerrado, evitando recriá-lo para multiplicar pontos.

Execução de força é **autodeclarada**: cronômetro, passos e GPS não comprovam séries, carga, repetições ou movimentos. Reduzir séries ou usar alternativa mais fácil não reduz o valor da constância.

## Pontos pessoais

A aba Ranking mostra a evolução do próprio perfil neste celular. Não lista amigos inventados, não sincroniza celulares e não usa autenticação por servidor.

Nas opções iniciais:

- Um dia válido com pelo menos uma sessão concluída vale **1 ponto**.
- Várias sessões no mesmo dia continuam valendo 1 ponto.
- O limite é de **5 pontos por semana**, começando na segunda-feira.
- Todos os dias da semana são válidos; não há sábado reservado a reposição nem domingo imposto como descanso.
- Quilômetros, passos, dificuldade, carga e repetições não criam bônus de constância.

Em **Ajustar regras pessoais**, podem ser alterados dias válidos, primeiro dia da semana e limite semanal de 1 a 7 pontos. O valor de um dia permanece 1 ponto. Salvar novas regras **recalcula todo o histórico local**, com aviso na tela. Essas opções não são regulamento compartilhado de um grupo.

O total do histórico soma os créditos de cada semana conforme as regras atuais. Atividades repetidas com o mesmo identificador não duplicam histórico ou pontos. Sessões ainda em andamento não pontuam. Excluir um registro recalcula o resultado; se outra sessão concluída no mesmo dia continuar salva, esse dia ainda poderá valer 1 ponto.

## Datas e fontes

A data de pontuação é o **dia local do início** da atividade, no fuso da rotina. Cruzar a meia-noite não divide a sessão nem cria crédito para dois dias. Relógio, fuso e horários são do aparelho: mudar essas informações pode afetar a pontuação. Não existe validação por servidor ou proteção absoluta contra manipulação.

Uma sessão concluída deve ter intervalo coerente e tempo ativo compatível com a duração. Registros incompletos, inválidos ou no futuro não entram no cálculo atual. Atividades em casa, academia, cardio e esportes podem contribuir para constância, sem distância mínima universal.

GPS, manual e autodeclarado são origens distintas. Esteira e bicicleta ergométrica recebem duração e distância informadas pela pessoa; não são quilômetros medidos por GPS. Futebol, basquete e vôlei podem ser registrados somente por modalidade e duração.

## Quilômetros, passos e percurso

Caminhada, corrida e ciclismo têm totais separados; quilômetros das modalidades não são misturados. O total informa registros de suas fontes, incluindo manuais identificados no histórico. GPS sinalizado com anomalias não contribui aos totais de quilômetros mostrados, mas uma conclusão autodeclarada continua no histórico de constância. Anomalia é um sinal de qualidade, não uma acusação.

Posições imprecisas, saltos, horários fora de ordem e velocidades implausíveis são filtrados. Pausas e perda de sinal quebram segmentos. Nenhuma reta deve ligar o deslocamento feito durante uma pausa ou período sem posições válidas.

Ritmo e velocidade usam **tempo ativo**, sem pausas; o tempo total é apresentado separadamente. O traçado em SVG mostra os pontos reais de forma relativa e offline. Não é mapa de ruas nem método alternativo de cálculo de quilômetros.

Passos são opcionais em caminhada/corrida. Não comprovam treino de força, não aparecem como métrica de ciclismo, não viram quilômetros GPS nem bônus de pontos. O app distingue sessão, total diário disponível e contagem parcial. Não há importação de Health Connect/HealthKit ou relógio.

## Persistência e limitações

Registros e conclusões são gravados localmente e operações repetidas usam identificadores estáveis. Uma falha de gravação precisa aparecer como erro; não deve virar confirmação falsa. O app tenta preservar progresso em interrupções, sem inventar distância ou tempo ativo do período perdido.

Internet não é requisito para concluir ou registrar pontos. Permissões, localização ativada e sinal ainda são necessários para GPS. Fechamento forçado pode interromper captura; a retomada exige revisar o estado recuperado.

As antigas regras de desafios compartilhados, auditoria e autoridade do servidor estão preservadas somente como referência em [RULES_ONLINE_LEGACY.md](RULES_ONLINE_LEGACY.md). Elas não são regras operacionais do perfil local 1.1.0.

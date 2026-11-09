# Referência histórica da versão com servidor

Este documento descreve a arquitetura anterior à versão local 1.1.0, preservada no código do backend e no APK da revisão `893bed7`. Não é necessário segui-lo para criar perfil ou usar a versão local. As variáveis OAuth/API não reativam login online no novo aplicativo; isso exigiria outra implementação e build.

# Regras de treinos, atividades e desafios

## Treinos e constância

Preferências de objetivo, experiência, dias, tempo, ambiente, equipamentos, modalidades e exercícios a evitar orientam a biblioteca. Em casa sem materiais cadastrados, a sugestão prioriza peso corporal. Histórico recente e descanso entram na seleção; variação não significa trocar tudo diariamente.

O plano é persistido por usuário/data/ambiente. Ao iniciar, a versão é preservada como snapshot da sessão. Substituições precisam ser compatíveis com ambiente, equipamentos e nível. Adaptações e redução de séries não reduzem pontos de constância. Outra sugestão no mesmo dia não cria nova oportunidade.

Força é autodeclarada: sensores não comprovam séries, carga, repetições ou execução. O regulamento deve mostrar as condições de conclusão aceitas; não existe distância mínima universal. Descanso não gera mensagem de culpa.

## Calendário do desafio

- Início/encerramento são instantes; o fuso IANA do desafio determina a data local e o início da semana de pontuação.
- O início da atividade deve estar em `[startsAt, endsAt)`; conclusão deve ocorrer até endsAt. Sessão iniciada antes do desafio ou terminada depois dele fica no histórico sem crédito.
- O dia creditado é o **dia local de início** da sessão. Sem janela de horário, atravessar meia-noite não divide a atividade nem cria crédito no dia seguinte.
- Quando há janela diária de horário, a sessão inteira precisa caber nela. Janelas noturnas são permitidas; essa regra é exibida no regulamento.
- A sincronização deve chegar até encerramento + prazo de tolerância configurado, além de atender à política de horários verificáveis.
- Agenda e lembretes pessoais não alteram nenhum desses limites. Viajar ou mudar o relógio do celular não modifica o fuso do desafio.

Os dias válidos, dias de reposição, início da semana, limites diário/semanal, meta semanal, modalidades, fontes e critérios de empate são configurados por desafio. Sábado e domingo não têm significado fixo.

## Limites, reposições e máximo

Constância concede no máximo um crédito por pessoa e dia, no valor configurado por dia. O limite semanal também se aplica. A sugestão inicial é um ponto por dia e cinco por semana, mas o administrador pode ajustar antes do início.

Reposição recupera uma oportunidade de um dia regular anterior perdido **na mesma semana**. Ela não aumenta o limite semanal nem o máximo teórico do calendário. Dias regulares e de reposição não podem se sobrepor.

O máximo é calculado sobre as oportunidades reais do período, com semanas incompletas e limites. Em constância, o crédito diário é limitado ao menor valor entre pontos por dia e teto diário. Em caminhada/corrida/ciclismo, os tetos são quilômetros; em passos, são passos. O máximo semanal é o menor entre as oportunidades regulares multiplicadas pelo teto diário e o teto semanal. A meta semanal configurada permanece fixa no desempate mesmo em semanas incompletas.

## Rankings separados

Constância soma pontos; caminhada, corrida e ciclismo somam os quilômetros elegíveis da modalidade correspondente. Passos somam apenas registros aceitos conforme fonte e regulamento. As modalidades não são misturadas e passos não viram quilômetros GPS nem bônus de constância.

Desempate sugerido: semanas em que a meta configurada foi atingida; persistindo, mesma posição. A opção de empate compartilhado direto também fica explícita. O ranking expõe atualização e motivo de exclusão do próprio registro, sem divulgar e-mails, trajeto ou dados detalhados dos colegas.

## Offline e integridade

O servidor é a autoridade para pontos. Unicidade, chaves de idempotência e transações evitam duplicação por repetição ou concorrência. A mesma conclusão não ganha novos pontos ao reenviar ou mudar o treino sugerido.

Horários declarados pelo aparelho não bastam para pontuar. Inícios/conclusões verificados pelo servidor usam hora do servidor; dados offline não verificáveis ficam preservados como inelegíveis ou pendentes de revisão conforme a política. Prazo de tolerância não transforma automaticamente um horário arbitrário em horário confiável. Revisão administrativa requer motivo e auditoria.

Registros manuais, GPS e importados são fontes distintas; uma fonte descrita no regulamento não prova que sua integração esteja disponível. Esta versão não importa dados de Health Connect/HealthKit. Anomalias de GPS geram indicação para revisão, não acusação automática. Não há proteção absoluta contra fraude.

Uma atividade pode estar salva localmente, aguardando sincronização, confirmada pelo servidor e ainda assim inelegível para o desafio. O histórico pessoal não é apagado por falta de pontos.

## Alterações e exclusão

Antes do início, configurações podem ser editadas livremente. Após o início, alteração precisa de motivo, auditoria, comunicação e confirmação explícita do recálculo. O resultado não muda silenciosamente.

Excluir ou corrigir uma atividade exige recalcular os resultados relacionados de forma consistente. Duplicar um desafio copia configurações, mas exige novas datas; encerrar um desafio não encerra o aplicativo.

## GPS e métricas

São filtradas posições sem qualidade suficiente, horários fora de ordem, saltos e velocidades incompatíveis com a modalidade. Lacunas e pausas interrompem segmentos: não se soma uma linha atravessando um período sem dados. O trajeto pode ter partes sem registro, e isso permanece visível.

Ritmo e velocidade usam **tempo ativo**, excluindo pausas; tempo total é mostrado separadamente. Esteira, bicicleta ergométrica e esportes podem ser registrados manualmente, com origem explícita. Distância manual não é apresentada como GPS.

## Limite de processamento

Datas, duração e limites de pontuação são definidos por desafio. O calendário materializado tem uma proteção técnica de 100.000 dias por intervalo para impedir requisições que consumam memória e CPU enumerando milênios de datas. Intervalos maiores são rejeitados antes da enumeração, com erro de configuração; essa proteção não define a duração usual ou a pontuação de uma competição.
